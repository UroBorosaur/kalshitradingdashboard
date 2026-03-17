import "@/lib/server-only";

import { randomUUID } from "node:crypto";

import { getOptionChainSnapshots, getStockSnapshots } from "@/lib/live/alpaca";
import {
  cancelKalshiDemoOrder,
  getKalshiDemoBalanceUsd,
  getKalshiDemoBalancesUsd,
  kalshiConnectionStatus,
  placeKalshiDemoOrder,
} from "@/lib/prediction/kalshi";
import { ensureClusterOrderGuards } from "@/lib/prediction/order-groups";
import { deriveClusterGuardSpecs } from "@/lib/prediction/order-group-rules";
import type { ClusterGuardResult } from "@/lib/prediction/order-groups";
import {
  getKalshiOpenMarketsStream,
  getKalshiPrivateStateStream,
  getKalshiRecentMarketHistoryStream,
  getKalshiStreamStatus,
} from "@/lib/prediction/kalshi-stream";
import {
  estimateKalshiFeeRounded,
  marketContractStep,
  probabilityToCents,
  snapContractCount,
  snapProbabilityToMarket,
} from "@/lib/prediction/fixed-point";
import { refreshMarkoutTelemetry } from "@/lib/prediction/markouts";
import {
  persistCandidateDecisions,
  persistKalshiBalanceSnapshot,
  persistLearningOutput,
  persistLiquidationDecisions,
  persistMarketScan,
  persistOrderMaintenanceDecisions,
  persistReplacementDecisions,
  persistShadowBaselines,
  persistSignalOverlays,
  persistWatchlistEvents,
} from "@/lib/storage/prediction-store";
import { buildFalseNegativeLearning } from "@/lib/prediction/false-negative-learning";
import { loadExecutionAttributionSummary } from "@/lib/prediction/execution-attribution";
import { evaluateLiquidationDecision } from "@/lib/prediction/liquidation";
import { evaluateOrderMaintenance } from "@/lib/prediction/order-maintenance";
import {
  buildOpenExposureConstraint,
  evaluateReplacementDecision,
  type OpenExposureConstraint as OpenPositionConstraint,
} from "@/lib/prediction/replacement";
import { estimateLeadLagSignal, estimateSilentClockContribution } from "@/lib/prediction/signal-overlays";
import { updateWatchlistLifecycle } from "@/lib/prediction/watchlist";
import {
  entmaxBisect,
  logit,
  sigmoid,
  softmax,
  sparsemax,
  temperatureScaleProbability,
} from "@/lib/prediction/transforms";
import type {
  AutomationControls,
  AutomationMode,
  CandidateGateDiagnostic,
  ExecutionBootstrapMode,
  ExecutionHealthRegime,
  AutomationRunInput,
  AutomationRunSummary,
  CalibrationMethod,
  CandidateVerdict,
  ExecutionPlanRole,
  FalseNegativeLearningOutput,
  LeadLagSignal,
  LiquidationDecision,
  OpportunityType,
  PortfolioRanking,
  PredictionCandidate,
  PredictionCategory,
  PredictionMarketQuote,
  PredictionSide,
  ProbabilityTransform,
  ReplacementDecision,
  ShadowBaselineSummary,
  ShadowBaselineProfile,
  SilentClockContribution,
  StrategicBreakdown,
  StrategyTag,
  WatchlistPromotionDecision,
  WatchlistState,
} from "@/lib/prediction/types";

interface ModeRules {
  maxMarkets: number;
  maxMarketsPerCategory: number;
  perTradeRiskPct: number;
  maxDailyRiskPct: number;
  kellyFractionCap: number;
  cvarPenalty: number;
  entropyPenalty: number;
  timeBudgetFactor: number;
  minEdge: number;
  confidenceFloor: number;
  maxSpread: number;
  minLiquidityScore: number;
  secondaryMinEdge: number | null;
  secondaryConfidenceFloor: number | null;
  secondaryMaxSpread: number | null;
  secondaryMinLiquidityScore: number | null;
  secondaryStakeScale: number;
  highProbTargetShare: number;
  highProbMinModelProb: number;
  highProbMinMarketProb: number;
  highProbMinEdge: number;
  highProbMaxEdge: number;
  highProbMinConfidence: number;
  highProbDailyRiskFloorUsd: number;
}

const MODE_RULES: Record<AutomationMode, ModeRules> = {
  CONSERVATIVE: {
    maxMarkets: 3,
    maxMarketsPerCategory: 1,
    perTradeRiskPct: 0.008,
    maxDailyRiskPct: 0.025,
    kellyFractionCap: 0.12,
    cvarPenalty: 1.45,
    entropyPenalty: 0.18,
    timeBudgetFactor: 0.75,
    minEdge: 0.018,
    confidenceFloor: 0.62,
    maxSpread: 0.09,
    minLiquidityScore: 0.35,
    secondaryMinEdge: null,
    secondaryConfidenceFloor: null,
    secondaryMaxSpread: null,
    secondaryMinLiquidityScore: null,
    secondaryStakeScale: 1,
    highProbTargetShare: 0.82,
    highProbMinModelProb: 0.9,
    highProbMinMarketProb: 0.86,
    highProbMinEdge: 0.0025,
    highProbMaxEdge: 0.009,
    highProbMinConfidence: 0.45,
    highProbDailyRiskFloorUsd: 1.5,
  },
  MIXED: {
    maxMarkets: 7,
    maxMarketsPerCategory: 2,
    perTradeRiskPct: 0.015,
    maxDailyRiskPct: 0.06,
    kellyFractionCap: 0.18,
    cvarPenalty: 1.1,
    entropyPenalty: 0.12,
    timeBudgetFactor: 1,
    minEdge: 0.0105,
    confidenceFloor: 0.53,
    maxSpread: 0.12,
    minLiquidityScore: 0.23,
    secondaryMinEdge: 0.007,
    secondaryConfidenceFloor: 0.52,
    secondaryMaxSpread: 0.09,
    secondaryMinLiquidityScore: 0.28,
    secondaryStakeScale: 0.55,
    highProbTargetShare: 0.68,
    highProbMinModelProb: 0.9,
    highProbMinMarketProb: 0.83,
    highProbMinEdge: 0.0015,
    highProbMaxEdge: 0.012,
    highProbMinConfidence: 0.40,
    highProbDailyRiskFloorUsd: 2.5,
  },
  AGGRESSIVE: {
    maxMarkets: 12,
    maxMarketsPerCategory: 4,
    perTradeRiskPct: 0.03,
    maxDailyRiskPct: 0.13,
    kellyFractionCap: 0.28,
    cvarPenalty: 0.85,
    entropyPenalty: 0.08,
    timeBudgetFactor: 1.2,
    minEdge: 0.0065,
    confidenceFloor: 0.42,
    maxSpread: 0.18,
    minLiquidityScore: 0.13,
    secondaryMinEdge: 0.004,
    secondaryConfidenceFloor: 0.46,
    secondaryMaxSpread: 0.11,
    secondaryMinLiquidityScore: 0.28,
    secondaryStakeScale: 0.5,
    highProbTargetShare: 0.58,
    highProbMinModelProb: 0.9,
    highProbMinMarketProb: 0.8,
    highProbMinEdge: 0.0012,
    highProbMaxEdge: 0.015,
    highProbMinConfidence: 0.38,
    highProbDailyRiskFloorUsd: 5,
  },
  AI: {
    maxMarkets: 12,
    maxMarketsPerCategory: 3,
    perTradeRiskPct: 0.024,
    maxDailyRiskPct: 0.09,
    kellyFractionCap: 0.24,
    cvarPenalty: 0.95,
    entropyPenalty: 0.1,
    timeBudgetFactor: 1.15,
    minEdge: 0.0075,
    confidenceFloor: 0.49,
    maxSpread: 0.16,
    minLiquidityScore: 0.18,
    secondaryMinEdge: 0.0045,
    secondaryConfidenceFloor: 0.47,
    secondaryMaxSpread: 0.1,
    secondaryMinLiquidityScore: 0.28,
    secondaryStakeScale: 0.45,
    highProbTargetShare: 0.7,
    highProbMinModelProb: 0.9,
    highProbMinMarketProb: 0.82,
    highProbMinEdge: 0.0015,
    highProbMaxEdge: 0.014,
    highProbMinConfidence: 0.39,
    highProbDailyRiskFloorUsd: 4,
  },
};

const ALL_SCAN_CATEGORIES: PredictionCategory[] = [
  "BITCOIN",
  "SPORTS",
  "POLITICS",
  "ESPORTS",
  "WEATHER",
  "STOCKS",
  "MACRO",
  "OTHER",
];

const MIN_ACTIONABLE_TARGET_BY_MODE: Record<AutomationMode, number> = {
  CONSERVATIVE: 1,
  MIXED: 3,
  AGGRESSIVE: 5,
  AI: 6,
};
const SCORE_THRESHOLD_BY_MODE: Record<AutomationMode, number> = {
  CONSERVATIVE: 0.012,
  MIXED: 0.006,
  AGGRESSIVE: 0.0035,
  AI: 0.003,
};

const MAX_THROUGHPUT_RELAXATION_STEPS = 2;

const BASE_RATE_BY_CATEGORY: Record<PredictionCategory, number> = {
  BITCOIN: 0.54,
  SPORTS: 0.5,
  POLITICS: 0.5,
  ESPORTS: 0.5,
  WEATHER: 0.5,
  STOCKS: 0.53,
  MACRO: 0.51,
  OTHER: 0.5,
};

const REPRICING_VARIABLES_BY_CATEGORY: Record<PredictionCategory, string[]> = {
  BITCOIN: [
    "ETF net flows and derivatives funding regime shift",
    "Regulatory headline shock and liquidation cascades",
    "Basis and options skew inversion",
  ],
  SPORTS: [
    "Confirmed lineup/injury changes within 60 minutes of event",
    "Travel/rest asymmetry and venue/weather changes",
    "Late steam from high-liquidity books",
  ],
  POLITICS: [
    "High-quality polling update with turnout composition shift",
    "Legal/calendar event that changes candidate set or timeline",
    "Settlement wording ambiguity or rule interpretation update",
  ],
  ESPORTS: [
    "Patch/meta changes affecting map pool and draft equity",
    "Roster substitution or role swap with low practice time",
    "Best-of format sensitivity to side/map selection",
  ],
  WEATHER: [
    "Ensemble model divergence/convergence across major runs",
    "Station-specific reporting quirks near settlement timestamp",
    "Track shift for low-probability tail event",
  ],
  STOCKS: [
    "Implied move versus realized move divergence into catalyst",
    "Guidance or macro sensitivity repricing",
    "Sector-sympathy and dealer positioning shock",
  ],
  MACRO: [
    "Economic print surprise and revision path",
    "Central bank communication regime shift",
    "Cross-asset correlation break affecting settlement variable",
  ],
  OTHER: [
    "Settlement-rule interpretation changes or clarifications",
    "Thin-book liquidity shifts and spread expansion",
    "Cross-market narrative spillover and repricing lag",
  ],
};

const BITCOIN_FOCUS_HORIZON_DAYS = 15 / (24 * 60);
const BITCOIN_MICRO_HORIZON_DAYS = 60 / (24 * 60);
const BITCOIN_MICRO_HIGH_PROB_MODEL_MIN = 0.6;
const BITCOIN_MICRO_HIGH_PROB_MARKET_MIN = 0.6;
const BITCOIN_MICRO_HIGH_PROB_EDGE_MIN = 0.006;
const BITCOIN_MICRO_HIGH_PROB_CONFIDENCE_MIN = 0.44;
const UNCERTAINTY_QUOTE_WIDENING_ALPHA = 0.65;
const TOXICITY_WIDEN_THRESHOLD = 0.55;
const TOXICITY_PASSIVE_SHUTOFF = 0.82;
const STALE_REPRICE_DRIFT_THRESHOLD = 0.018;
const CLUSTER_LIMIT_SHARE_BY_MODE: Record<AutomationMode, number> = {
  CONSERVATIVE: 0.34,
  MIXED: 0.42,
  AGGRESSIVE: 0.52,
  AI: 0.4,
};
const FAVORITE_LONGSHOT_PRICE_MIN = 0.7;
const FAVORITE_LONGSHOT_PRICE_MAX = 0.95;
const FAVORITE_LONGSHOT_EXECUTION_PROB_GAP_MIN = 0.1;
const LONGSHOT_YES_PRICE_MAX = 0.3;
const MIN_HORIZON_DAYS = 5 / (24 * 60);
const BASE_EXECUTION_FEE_RATE = 0.0012;
const SPREAD_IMPACT_FACTOR = 0.08;
const STRUCTURAL_ENTMAX_ALPHA = 1.5;

const TEMPERATURE_BY_CATEGORY: Record<PredictionCategory, number> = {
  BITCOIN: 0.94,
  SPORTS: 1.06,
  POLITICS: 1.08,
  ESPORTS: 1.07,
  WEATHER: 0.97,
  STOCKS: 0.96,
  MACRO: 0.98,
  OTHER: 1.03,
};

const DEFAULT_AUTOMATION_CONTROLS: AutomationControls = {
  edgeMultiplier: 1,
  confidenceShift: 0,
  spreadMultiplier: 1,
  liquidityMultiplier: 1,
  highProbModelMin: 0.9,
  highProbMarketMin: 0.82,
  highProbabilityEnabled: true,
  favoriteLongshotEnabled: true,
  throughputRecoveryEnabled: true,
  exploratoryFallbackEnabled: true,
  replacementEnabled: true,
  replacementMinDelta: 0.02,
  orderMaintenanceEnabled: true,
  cancelReplaceMinImprovement: 0.01,
  watchlistPromotionEnabled: true,
  watchlistPromotionThreshold: 0.035,
  adaptiveLearningEnabled: false,
  liquidationAdvisoryEnabled: true,
};

interface HighProbThresholds {
  modelMin: number;
  marketMin: number;
  edgeMin: number;
  confidenceMin: number;
}

interface RulebookProbabilityEstimate {
  prob: number;
  lower: number;
  upper: number;
  uncertainty: number;
  settlementLagDays: number;
  notes: string[];
}

interface ExecutionAlphaEstimate {
  passivePrice: number;
  fillProb: number;
  valuePerContract: number;
  patienceHours: number;
  expectedExecutionValueUsd: number;
  assumedRole: ExecutionPlanRole;
  feePerContractUsd: number;
  quoteWidening: number;
  staleHazard: number;
  toxicityScore: number;
  inventorySkew: number;
  notes: string[];
}

interface IncentiveEstimate {
  liquidityUsd: number;
  volumeUsd: number;
  totalUsd: number;
  notes: string[];
}

interface CoherenceAdjustment {
  yesFairProb: number | null;
  coherenceEdge: number;
  notes: string[];
}

interface MarketMathContext {
  strikeFairByTicker: Map<string, number>;
  calendarFairByTicker: Map<string, number>;
  comboFairByTicker: Map<string, number>;
  structuralFairByTicker: Map<string, number>;
  structuralTransformByTicker: Map<string, ProbabilityTransform>;
  notesByTicker: Map<string, string[]>;
}

interface ExpertProbability {
  expert: string;
  probability: number;
  score: number;
  rationale?: string;
}

interface ExpertMixtureResult {
  probability: number;
  transform: ProbabilityTransform;
  weights: Array<{
    expert: string;
    probability: number;
    weight: number;
  }>;
  rationale: string[];
}

interface ModelProbabilityEstimate {
  rawModelProb: number;
  modelProb: number;
  overlaylessRawModelProb?: number;
  rawModelProbWithoutSilentClock?: number;
  rawModelProbWithoutLeadLag?: number;
  marketProb: number;
  rationale: string[];
  probabilityTransform: ProbabilityTransform;
  calibrationMethod: CalibrationMethod;
  expertWeights: Array<{
    expert: string;
    probability: number;
    weight: number;
  }>;
  silentClock?: SilentClockContribution | null;
  leadLag?: LeadLagSignal | null;
}

interface SyntheticDigitalBand {
  fairMid: number;
  fairLower: number;
  fairUpper: number;
  strike: number;
  underlying: string;
  mismatchPenalty: number;
  notes: string[];
}

interface OverlayContext {
  syntheticBandsByTicker: Map<string, SyntheticDigitalBand>;
}

interface ExecutionHealthContext {
  markoutPenalty: number;
  scorePenalty: number;
  regime: ExecutionHealthRegime;
  warnings: string[];
}

interface PortfolioSizingOptions {
  disableClusterCap?: boolean;
  toxicityWeightScale?: number;
}

interface ActionableCandidateOptions {
  ignoreToxicityGate?: boolean;
}

interface AdaptiveGateContext {
  toxicityThreshold: number;
  uncertaintyThreshold: number;
  learningActive: boolean;
}

const REQUIRED_PRIVATE_STREAM_CHANNELS = ["user_orders", "fill", "market_positions", "order_group_updates"] as const;

function upsertGateDiagnostic(
  diagnostics: CandidateGateDiagnostic[] | undefined,
  nextDiagnostic: CandidateGateDiagnostic,
): CandidateGateDiagnostic[] {
  const next = [...(diagnostics ?? [])];
  const index = next.findIndex((diagnostic) => diagnostic.gate === nextDiagnostic.gate);
  if (index >= 0) next[index] = nextDiagnostic;
  else next.push(nextDiagnostic);
  return next;
}

function normalizeAutomationControls(input?: Partial<AutomationControls>): AutomationControls {
  return {
    edgeMultiplier: clamp(input?.edgeMultiplier ?? DEFAULT_AUTOMATION_CONTROLS.edgeMultiplier, 0.5, 1.8),
    confidenceShift: clamp(input?.confidenceShift ?? DEFAULT_AUTOMATION_CONTROLS.confidenceShift, -0.15, 0.15),
    spreadMultiplier: clamp(input?.spreadMultiplier ?? DEFAULT_AUTOMATION_CONTROLS.spreadMultiplier, 0.7, 1.6),
    liquidityMultiplier: clamp(input?.liquidityMultiplier ?? DEFAULT_AUTOMATION_CONTROLS.liquidityMultiplier, 0.5, 1.6),
    highProbModelMin: clamp(input?.highProbModelMin ?? DEFAULT_AUTOMATION_CONTROLS.highProbModelMin, 0.5, 0.97),
    highProbMarketMin: clamp(input?.highProbMarketMin ?? DEFAULT_AUTOMATION_CONTROLS.highProbMarketMin, 0.5, 0.97),
    highProbabilityEnabled: input?.highProbabilityEnabled ?? DEFAULT_AUTOMATION_CONTROLS.highProbabilityEnabled,
    favoriteLongshotEnabled: input?.favoriteLongshotEnabled ?? DEFAULT_AUTOMATION_CONTROLS.favoriteLongshotEnabled,
    throughputRecoveryEnabled: input?.throughputRecoveryEnabled ?? DEFAULT_AUTOMATION_CONTROLS.throughputRecoveryEnabled,
    exploratoryFallbackEnabled: input?.exploratoryFallbackEnabled ?? DEFAULT_AUTOMATION_CONTROLS.exploratoryFallbackEnabled,
    replacementEnabled: input?.replacementEnabled ?? DEFAULT_AUTOMATION_CONTROLS.replacementEnabled,
    replacementMinDelta: clamp(input?.replacementMinDelta ?? DEFAULT_AUTOMATION_CONTROLS.replacementMinDelta, 0, 0.15),
    orderMaintenanceEnabled: input?.orderMaintenanceEnabled ?? DEFAULT_AUTOMATION_CONTROLS.orderMaintenanceEnabled,
    cancelReplaceMinImprovement: clamp(
      input?.cancelReplaceMinImprovement ?? DEFAULT_AUTOMATION_CONTROLS.cancelReplaceMinImprovement,
      0,
      0.08,
    ),
    watchlistPromotionEnabled: input?.watchlistPromotionEnabled ?? DEFAULT_AUTOMATION_CONTROLS.watchlistPromotionEnabled,
    watchlistPromotionThreshold: clamp(
      input?.watchlistPromotionThreshold ?? DEFAULT_AUTOMATION_CONTROLS.watchlistPromotionThreshold,
      0,
      0.2,
    ),
    adaptiveLearningEnabled: input?.adaptiveLearningEnabled ?? DEFAULT_AUTOMATION_CONTROLS.adaptiveLearningEnabled,
    liquidationAdvisoryEnabled: input?.liquidationAdvisoryEnabled ?? DEFAULT_AUTOMATION_CONTROLS.liquidationAdvisoryEnabled,
  };
}

function applyAutomationControls(baseRules: ModeRules, controls: AutomationControls): ModeRules {
  return {
    ...baseRules,
    minEdge: Math.max(0.001, baseRules.minEdge * controls.edgeMultiplier),
    confidenceFloor: clamp(baseRules.confidenceFloor + controls.confidenceShift, 0.28, 0.9),
    maxSpread: clamp(baseRules.maxSpread * controls.spreadMultiplier, 0.05, 0.28),
    minLiquidityScore: clamp(baseRules.minLiquidityScore * controls.liquidityMultiplier, 0.05, 0.95),
    secondaryMinEdge:
      baseRules.secondaryMinEdge === null ? null : Math.max(0.001, baseRules.secondaryMinEdge * controls.edgeMultiplier),
    secondaryConfidenceFloor:
      baseRules.secondaryConfidenceFloor === null ? null : clamp(baseRules.secondaryConfidenceFloor + controls.confidenceShift, 0.28, 0.9),
    secondaryMaxSpread:
      baseRules.secondaryMaxSpread === null ? null : clamp(baseRules.secondaryMaxSpread * controls.spreadMultiplier, 0.05, 0.28),
    secondaryMinLiquidityScore:
      baseRules.secondaryMinLiquidityScore === null ? null : clamp(baseRules.secondaryMinLiquidityScore * controls.liquidityMultiplier, 0.05, 0.95),
    highProbTargetShare: controls.highProbabilityEnabled ? baseRules.highProbTargetShare : 0,
    highProbMinModelProb: controls.highProbabilityEnabled ? controls.highProbModelMin : 0.999,
    highProbMinMarketProb: controls.highProbabilityEnabled ? controls.highProbMarketMin : 0.999,
    highProbDailyRiskFloorUsd: controls.highProbabilityEnabled ? baseRules.highProbDailyRiskFloorUsd : 0,
  };
}

function applyExecutionHealthRules(baseRules: ModeRules, health: ExecutionHealthContext): ModeRules {
  if (health.markoutPenalty <= 0) return baseRules;

  const tighten = clamp(health.markoutPenalty / 0.06, 0, 1);
  return {
    ...baseRules,
    perTradeRiskPct: baseRules.perTradeRiskPct * (1 - tighten * 0.28),
    maxDailyRiskPct: baseRules.maxDailyRiskPct * (1 - tighten * 0.24),
    kellyFractionCap: baseRules.kellyFractionCap * (1 - tighten * 0.22),
    minEdge: baseRules.minEdge * (1 + tighten * 0.32),
    confidenceFloor: clamp(baseRules.confidenceFloor + tighten * 0.045, 0.28, 0.92),
    maxSpread: clamp(baseRules.maxSpread * (1 - tighten * 0.18), 0.05, 0.28),
    highProbMinEdge: baseRules.highProbMinEdge * (1 + tighten * 0.25),
    highProbMinConfidence: clamp(baseRules.highProbMinConfidence + tighten * 0.04, 0.3, 0.92),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalCdf(x: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t *
        (-0.3565638 +
          t *
            (1.781478 +
              t * (-1.821256 +
                t *
                  1.330274))));
  return x >= 0 ? 1 - p : p;
}

function firstDefined(...values: Array<number | null | undefined>) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function isBuyVerdict(verdict: CandidateVerdict | undefined): boolean {
  return verdict === "BUY_YES" || verdict === "BUY_NO";
}

function safeUpperToken(text: string) {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function deriveRiskCluster(market: PredictionMarketQuote) {
  if (market.eventTicker?.trim()) return `${market.category}:${market.eventTicker.trim().toUpperCase()}`;

  const titleBase = safeUpperToken(`${market.title} ${market.subtitle ?? ""}`);
  const tickerBase = market.ticker.split("-").slice(0, 2).join("-");
  return `${market.category}:${titleBase || tickerBase || market.ticker}`;
}

function deriveExecutionHealthRegime(markoutPenalty: number, sampleCount: number): ExecutionHealthRegime {
  if (sampleCount >= 8 && markoutPenalty > 0.03) return "DEFENSIVE";
  if (sampleCount >= 4 && markoutPenalty > 0.01) return "TIGHTENED";
  return "NORMAL";
}

function deriveBootstrapMode(): ExecutionBootstrapMode {
  const status = getKalshiStreamStatus();
  if (!status.primedPrivate) return "UNAVAILABLE";

  const ackedChannels = new Set(
    status.subscriptions
      .filter((subscription) => subscription.sid !== null)
      .map((subscription) => subscription.channel),
  );

  const fullyAcked = REQUIRED_PRIVATE_STREAM_CHANNELS.every((channel) => ackedChannels.has(channel));
  return fullyAcked ? "ACKED" : "EVENT_PRIMED";
}

function buildAutomationClientOrderId(runId: string, candidate: Pick<PredictionCandidate, "ticker" | "side">, index: number) {
  const compactRunId = runId.replace(/-/g, "").slice(0, 12);
  const ticker = candidate.ticker.replace(/[^A-Za-z0-9]+/g, "").slice(0, 24);
  const side = candidate.side === "YES" ? "Y" : "N";
  return `auto-${compactRunId}-${index.toString(36)}-${side}-${ticker}`.slice(0, 48);
}

function buildExecutionHealthContext(markoutPenalty: number, sampleCount: number) {
  const boundedPenalty = clamp(markoutPenalty, 0, 0.22);
  const warnings: string[] = [];
  if (sampleCount >= 8 && boundedPenalty > 0.015) {
    warnings.push(
      `Execution health degraded: recent markouts imply a ${(boundedPenalty * 100).toFixed(2)}bp headwind, so thresholds and sizing were tightened.`,
    );
  }

  return {
    markoutPenalty: boundedPenalty,
    scorePenalty: clamp(boundedPenalty * 0.85, 0, 0.18),
    regime: deriveExecutionHealthRegime(boundedPenalty, sampleCount),
    warnings,
  } satisfies ExecutionHealthContext;
}

function defaultAdaptiveGateContext(): AdaptiveGateContext {
  return {
    toxicityThreshold: 0.9,
    uncertaintyThreshold: 0.08,
    learningActive: false,
  };
}

function applyLearningToRules(
  rules: ModeRules,
  recommendations: FalseNegativeLearningOutput["recommendations"] | undefined,
): { rules: ModeRules; gates: AdaptiveGateContext; notes: string[] } {
  if (!recommendations?.length) {
    return { rules, gates: defaultAdaptiveGateContext(), notes: [] };
  }

  const adjusted: ModeRules = { ...rules };
  const gates = defaultAdaptiveGateContext();
  const notes: string[] = [];

  for (const recommendation of recommendations) {
    if (!recommendation.active || recommendation.boundedDelta <= 0) continue;
    if (recommendation.gate === "CONFIDENCE_FLOOR") {
      adjusted.confidenceFloor = clamp(adjusted.confidenceFloor - recommendation.boundedDelta, 0.28, 0.92);
      notes.push(`Adaptive learning lowered confidence floor by ${(recommendation.boundedDelta * 100).toFixed(2)} pts.`);
    }
    if (recommendation.gate === "EXECUTION_EDGE") {
      adjusted.minEdge = Math.max(0.0005, adjusted.minEdge - recommendation.boundedDelta);
      notes.push(`Adaptive learning lowered execution-edge gate by ${(recommendation.boundedDelta * 100).toFixed(2)} pts.`);
    }
    if (recommendation.gate === "TOXICITY") {
      gates.toxicityThreshold = clamp(gates.toxicityThreshold + recommendation.boundedDelta, 0.9, 0.95);
      notes.push(`Adaptive learning widened toxicity gate to ${(gates.toxicityThreshold * 100).toFixed(1)}%.`);
    }
    if (recommendation.gate === "UNCERTAINTY_WIDTH") {
      gates.uncertaintyThreshold = clamp(gates.uncertaintyThreshold + recommendation.boundedDelta, 0.08, 0.12);
      notes.push(`Adaptive learning widened uncertainty gate to ${(gates.uncertaintyThreshold * 100).toFixed(1)}%.`);
    }
  }

  gates.learningActive = notes.length > 0;
  return { rules: adjusted, gates, notes };
}

function applyWatchlistPromotionState(
  candidates: PredictionCandidate[],
  watchlistStates: Map<string, WatchlistState>,
  promotions: Map<string, WatchlistPromotionDecision>,
) {
  return candidates.map((candidate) => {
    const key = candidateKey(candidate);
    const state = watchlistStates.get(key);
    const promotion = promotions.get(key);
    const watchlistState = state
      ? {
          status: promotion?.promoted ? ("PROMOTED" as const) : state.resolved ? ("RESOLVED" as const) : ("ACTIVE" as const),
          ageHours: Number(((new Date(state.lastSeenAt).getTime() - new Date(state.firstSeenAt).getTime()) / 3_600_000).toFixed(4)),
          cyclesObserved: state.cyclesObserved,
          promotionScore: promotion?.promotionScore,
        }
      : candidate.watchlistState;

    if (candidate.verdict === "WATCHLIST" && promotion?.promoted) {
      return {
        ...candidate,
        verdict: candidate.side === "YES" ? ("BUY_YES" as const) : ("BUY_NO" as const),
        opportunityType: "TRADE" as const,
        watchlistState,
        executionMessage: promotion.reason,
        rationale: [...candidate.rationale, promotion.reason],
      };
    }

    return {
      ...candidate,
      watchlistState,
    };
  });
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function calculateLiquidationCVaR(args: {
  market: PredictionMarketQuote;
  spread: number;
  liquidityScore: number;
  timeToCloseDays: number;
  isBtcMicro: boolean;
  positionSizeUsd?: number;
}) {
  const { market, spread, liquidityScore, timeToCloseDays, isBtcMicro, positionSizeUsd = 200 } = args;

  // 1. Base Spread Cost (L1 impact)
  const spreadCost = spread * SPREAD_IMPACT_FACTOR;

  // 2. Depth-Aware Execution Cost (Liquidation Shortfall)
  // Proxying Kalshi's active yes/no bids depth using volume/OI & spread width
  const depthFactor = clamp((market.volume + market.openInterest) / 50000, 0.05, 1);
  const sizeImpact = (positionSizeUsd / 100) * 0.0015 / depthFactor;

  // 3. Depth Decay after Shocks (CVaR Tail)
  const shockEvaporationRisk = isBtcMicro ? 0.04 : market.category === "SPORTS" ? 0.03 : 0.015;
  const tailLiquidationCost = shockEvaporationRisk * (1 - liquidityScore);

  // 4. Time-to-Liquidate (Opportunity/Lockup Cost)
  const horizonCost = timeToCloseDays <= BITCOIN_MICRO_HORIZON_DAYS ? 0.0008 : 0.0004;
  const microBonus = isBtcMicro ? -0.00035 : 0;

  const expectedImpact = Math.max(0.0005, BASE_EXECUTION_FEE_RATE + spreadCost + sizeImpact + horizonCost + microBonus);
  const liquidationCVaR = Math.max(0.0005, expectedImpact + tailLiquidationCost);

  return { expectedImpact, liquidationCVaR };
}

function estimateCandidateMoments(candidate: PredictionCandidate) {
  const price = Math.max(0.01, candidate.limitPriceCents / 100);
  const p = clamp(candidate.rulebookProb ?? candidate.modelProb, 0.02, 0.98);
  const winReturn = (1 - price) / price;
  const loseReturn = -1;
  const mean = p * winReturn + (1 - p) * loseReturn;
  const variance = p * (winReturn - mean) ** 2 + (1 - p) * (loseReturn - mean) ** 2;
  const intervalWidth = Math.max(0.01, (candidate.rulebookProbUpper ?? p) - (candidate.rulebookProbLower ?? p));
  const cvar = clamp((1 - p) + intervalWidth * 1.4 + Math.max(0, (candidate.capitalTimeDays ?? candidate.timeToCloseDays ?? 1) - 1) * 0.08, 0.05, 1.75);
  return { mean, variance, cvar };
}

function candidateContractStep(candidate: Pick<PredictionCandidate, "contractStep">) {
  return candidate.contractStep ?? 1;
}

function candidateUnitStake(candidate: Pick<PredictionCandidate, "limitPriceCents" | "contractStep">) {
  return Math.max(0.01, candidate.limitPriceCents / 100) * candidateContractStep(candidate);
}

function candidateUtilityScore(candidate: PredictionCandidate, rules: ModeRules): number {
  if (candidate.expectedValuePerDollarRisked <= 0) return -1;
  const { mean, variance, cvar } = estimateCandidateMoments(candidate);
  const timePenalty = 1 + Math.max(0, (candidate.capitalTimeDays ?? candidate.timeToCloseDays ?? 1) - rules.timeBudgetFactor) * 0.12;
  const rawKelly = Math.max(0, mean) / Math.max(0.18, variance + rules.cvarPenalty * cvar);
  const boundedKelly = clamp(rawKelly, 0, rules.kellyFractionCap);
  const uncertaintyPenalty = 1 + Math.max(0, candidate.uncertaintyWidth ?? 0) * 2.4;
  const toxicityPenalty = 1 + Math.max(0, candidate.toxicityScore ?? 0) * 1.7;
  const executionLift = 1 + Math.max(-0.2, Math.min(0.35, candidate.executionAdjustedEdge ?? 0));
  return (boundedKelly * executionLift) / (timePenalty * uncertaintyPenalty * toxicityPenalty);
}

function inferStructuralStrategyTags(market: PredictionMarketQuote): StrategyTag[] {
  const tags = new Set<StrategyTag>([
    "SETTLEMENT_SPEC_ARBITRAGE",
    "FEE_ROUTING",
    "CAPITAL_VELOCITY",
    "EXECUTION_ALPHA",
    "QUEUE_REACTIVE_EXECUTION",
    "PORTFOLIO_CVAR",
  ]);

  const text = `${market.title} ${market.subtitle ?? ""} ${market.eventTicker ?? ""}`.toLowerCase();

  if (/(over|under|at least|at most|more than|less than|\b\d+\+|\b\d+\.\d+)/.test(text)) {
    tags.add("STRIKE_LADDER_COHERENCE");
  }
  if (/(today|tonight|tomorrow|this week|this month|this quarter|this year|by |before )/.test(text)) {
    tags.add("CALENDAR_TERM_STRUCTURE");
  }
  if (/(combo|multi|same game|sgp|all of|both |either )/.test(text)) {
    tags.add("CORRELATION_DISPERSION");
    tags.add("COMBO_COPULA");
  }
  if (market.volume > 0 || market.openInterest > 0) {
    tags.add("RETAIL_FLOW_FADE");
  }
  if (market.category !== "BITCOIN" && market.category !== "STOCKS") {
    tags.add("INCENTIVE_FARMING");
  }
  if (market.category === "BITCOIN" || market.category === "STOCKS" || market.category === "MACRO") {
    tags.add("PHYSICAL_MEASURE_BRIDGE");
  }
  if (market.category === "WEATHER") {
    tags.add("WEATHER_EMOS_EVT");
  }
  if (market.category === "SPORTS" || market.category === "POLITICS" || market.category === "ESPORTS" || market.category === "OTHER") {
    tags.add("HAWKES_INFO_FLOW");
    tags.add("SWITCHING_STATE_SPACE");
  }

  return [...tags];
}

function evaluateFavoriteLongshotBias(args: {
  side: PredictionSide;
  marketProb: number;
  modelProb: number;
  edge: number;
}): {
  active: boolean;
  supportsTrade: boolean;
  autoExecute: boolean;
  shouldFadeCheapYes: boolean;
  probabilityGap: number;
} {
  const { side, marketProb, modelProb, edge } = args;
  const probabilityGap = modelProb - marketProb;
  const inFavoriteBand = marketProb >= FAVORITE_LONGSHOT_PRICE_MIN && marketProb <= FAVORITE_LONGSHOT_PRICE_MAX;
  const shouldFadeCheapYes = side === "YES" && marketProb <= LONGSHOT_YES_PRICE_MAX;

  return {
    active: inFavoriteBand,
    supportsTrade: inFavoriteBand && probabilityGap > 0 && edge > 0,
    autoExecute: inFavoriteBand && probabilityGap >= FAVORITE_LONGSHOT_EXECUTION_PROB_GAP_MIN && edge > 0,
    shouldFadeCheapYes,
    probabilityGap,
  };
}

function resolveHighProbThresholds(args: {
  category: PredictionCategory;
  timeToCloseDays: number | null | undefined;
  rules: ModeRules;
}): HighProbThresholds {
  const { category, timeToCloseDays, rules } = args;
  const isBtcMicro = category === "BITCOIN" && (timeToCloseDays ?? 99) <= BITCOIN_MICRO_HORIZON_DAYS;
  if (!isBtcMicro) {
    return {
      modelMin: rules.highProbMinModelProb,
      marketMin: rules.highProbMinMarketProb,
      edgeMin: rules.highProbMinEdge,
      confidenceMin: rules.highProbMinConfidence,
    };
  }

  return {
    modelMin: Math.min(rules.highProbMinModelProb, BITCOIN_MICRO_HIGH_PROB_MODEL_MIN),
    marketMin: Math.min(rules.highProbMinMarketProb, BITCOIN_MICRO_HIGH_PROB_MARKET_MIN),
    edgeMin: Math.max(rules.highProbMinEdge, BITCOIN_MICRO_HIGH_PROB_EDGE_MIN),
    confidenceMin: Math.max(0.34, rules.highProbMinConfidence - 0.04, BITCOIN_MICRO_HIGH_PROB_CONFIDENCE_MIN),
  };
}

function resolveGlobalHighProbThresholds(args: {
  category: PredictionCategory;
  timeToCloseDays: number | null | undefined;
  rules: ModeRules;
}): HighProbThresholds {
  return resolveHighProbThresholds(args);
}

function meetsGlobalHighProbabilityDefinition(args: {
  category: PredictionCategory;
  timeToCloseDays: number | null | undefined;
  rules: ModeRules;
  modelProb: number;
  marketProb: number;
  edge: number;
  confidence: number;
}) {
  const thresholds = resolveGlobalHighProbThresholds(args);
  return {
    thresholds,
    qualified:
      args.modelProb >= thresholds.modelMin &&
      args.marketProb >= thresholds.marketMin &&
      args.edge >= thresholds.edgeMin &&
      args.confidence >= thresholds.confidenceMin,
  };
}

function filterExistingPositionCandidates(
  candidates: PredictionCandidate[],
  constraint: OpenPositionConstraint,
  controls: AutomationControls,
): {
  filtered: PredictionCandidate[];
  blocked: PredictionCandidate[];
  replacementDecisions: ReplacementDecision[];
  skipped: number;
  sameSideSkipped: number;
  orderSkipped: number;
} {
  let skipped = 0;
  let sameSideSkipped = 0;
  let orderSkipped = 0;
  const blocked: PredictionCandidate[] = [];
  const replacementDecisions: ReplacementDecision[] = [];
  const filtered: PredictionCandidate[] = [];

  for (const candidate of candidates) {
    const sameSideKey = `${candidate.ticker}:${candidate.side}`;
    const needsConflictCheck =
      constraint.sameSideKeys.has(sameSideKey) ||
      constraint.tickers.has(candidate.ticker) ||
      constraint.orderSideKeys.has(sameSideKey) ||
      constraint.orderTickers.has(candidate.ticker);

    if (!needsConflictCheck) {
      filtered.push(candidate);
      continue;
    }

    skipped += 1;
    if (constraint.sameSideKeys.has(sameSideKey)) sameSideSkipped += 1;
    if (constraint.orderSideKeys.has(sameSideKey) || constraint.orderTickers.has(candidate.ticker)) orderSkipped += 1;

    const incumbents = constraint.incumbentsByCandidateKey.get(sameSideKey) ?? [];
    const replacement = incumbents.length
      ? evaluateReplacementDecision({
          challenger: candidate,
          incumbents,
          controls: {
            enabled: controls.replacementEnabled,
            minDelta: controls.replacementMinDelta,
          },
        })
      : null;

    if (replacement) replacementDecisions.push(replacement);

    if (replacement?.accepted && replacement.action === "REPLACE_ORDER") {
      filtered.push({
        ...candidate,
        incumbentComparison: replacement,
        replacementScoreDelta: replacement.replacementScoreDelta,
        executionMessage: replacement.reason,
        rationale: [...candidate.rationale, replacement.reason],
      });
      continue;
    }

    const detail =
      replacement?.reason ??
      (constraint.sameSideKeys.has(sameSideKey)
        ? "Same-side open exposure already exists."
        : constraint.orderSideKeys.has(sameSideKey)
          ? "Same-side order is already active or recently executed."
          : constraint.orderTickers.has(candidate.ticker)
            ? "Market already has an active or recent order."
            : "Market already has open exposure on another side.");

    blocked.push({
      ...candidate,
      incumbentComparison: replacement ?? undefined,
      replacementScoreDelta: replacement?.replacementScoreDelta,
      gateDiagnostics: upsertGateDiagnostic(candidate.gateDiagnostics, {
        gate: "POSITION_ORDER_CONFLICT",
        passed: false,
        observed: 1,
        threshold: 0,
        missBy: 1,
        unit: "count",
        detail,
      }),
      executionStatus: "SKIPPED",
      executionMessage:
        replacement?.accepted && replacement.action === "RECOMMEND_POSITION_SWAP"
          ? `${replacement.reason} Live position replacement is advisory-only in Phase 7.`
          : detail,
    });
  }

  return { filtered, blocked, replacementDecisions, skipped, sameSideSkipped, orderSkipped };
}

function marketYesReferenceProb(market: PredictionMarketQuote) {
  return clamp(
    firstDefined(
      market.yesAsk,
      market.lastPrice,
      market.noBid !== null ? 1 - market.noBid : null,
      market.yesBid,
      0.5,
    ) ?? 0.5,
    0.01,
    0.99,
  );
}

function marketWeight(market: PredictionMarketQuote) {
  const depth =
    market.yesBidSize +
    market.yesAskSize +
    market.noBidSize +
    market.noAskSize +
    market.liquidityDollars * 4;
  return 1 + Math.log1p(market.volume + market.openInterest + depth);
}

function isIndexFeeMarket(market: PredictionMarketQuote) {
  const text = `${market.title} ${market.subtitle ?? ""} ${market.eventTicker ?? ""}`.toLowerCase();
  return /(s&p\s*500|spx|sp500|nasdaq-100|ndx|nq100)/.test(text);
}

function isMakerFeeMarket(market: PredictionMarketQuote) {
  const text = `${market.rulesPrimary ?? ""} ${market.rulesSecondary ?? ""}`.toLowerCase();
  return /maker[- ]fee/.test(text);
}

function estimateKalshiTradingFeeUsd(args: {
  market: PredictionMarketQuote;
  contracts: number;
  price: number;
  role: ExecutionPlanRole;
}) {
  const { market, contracts, price, role } = args;
  if (contracts <= 0) {
    return {
      rate: 0,
      totalUsd: 0,
      theoreticalUsd: 0,
      schedule: "NONE" as const,
    };
  }

  if (isIndexFeeMarket(market)) {
    const fee = estimateKalshiFeeRounded({
      contracts,
      price: clamp(price, 0.01, 0.99),
      rate: 0.035,
      schedule: "INDEX",
    });
    return {
      rate: 0.035,
      totalUsd: Number(fee.chargedUsd.toFixed(4)),
      theoreticalUsd: Number(fee.theoreticalUsd.toFixed(4)),
      schedule: "INDEX" as const,
    };
  }

  if (role === "MAKER" && !isMakerFeeMarket(market)) {
    return {
      rate: 0,
      totalUsd: 0,
      theoreticalUsd: 0,
      schedule: "PASSIVE_FREE" as const,
    };
  }

  if (role === "MAKER_FEE" || (role === "MAKER" && isMakerFeeMarket(market))) {
    const fee = estimateKalshiFeeRounded({
      contracts,
      price: clamp(price, 0.01, 0.99),
      rate: 0.0175,
      schedule: "MAKER_FEE",
    });
    return {
      rate: 0.0175,
      totalUsd: Number(fee.chargedUsd.toFixed(4)),
      theoreticalUsd: Number(fee.theoreticalUsd.toFixed(4)),
      schedule: "MAKER_FEE" as const,
    };
  }

  const fee = estimateKalshiFeeRounded({
    contracts,
    price: clamp(price, 0.01, 0.99),
    rate: 0.07,
    schedule: "GENERAL",
  });
  return {
    rate: 0.07,
    totalUsd: Number(fee.chargedUsd.toFixed(4)),
    theoreticalUsd: Number(fee.theoreticalUsd.toFixed(4)),
    schedule: "GENERAL" as const,
  };
}

function isotonicRegression(values: number[], weights: number[], increasing: boolean): number[] {
  if (!values.length) return [];

  const blocks = values.map((value, index) => ({
    start: index,
    end: index,
    weight: Math.max(1e-6, weights[index] ?? 1),
    weightedValue: value * Math.max(1e-6, weights[index] ?? 1),
  }));

  function blockMean(block: { weight: number; weightedValue: number }) {
    return block.weightedValue / block.weight;
  }

  let cursor = 0;
  while (cursor < blocks.length - 1) {
    const left = blockMean(blocks[cursor]);
    const right = blockMean(blocks[cursor + 1]);
    const violation = increasing ? left > right : left < right;

    if (!violation) {
      cursor += 1;
      continue;
    }

    const merged = {
      start: blocks[cursor].start,
      end: blocks[cursor + 1].end,
      weight: blocks[cursor].weight + blocks[cursor + 1].weight,
      weightedValue: blocks[cursor].weightedValue + blocks[cursor + 1].weightedValue,
    };
    blocks.splice(cursor, 2, merged);
    if (cursor > 0) cursor -= 1;
  }

  const out = new Array<number>(values.length).fill(0);
  for (const block of blocks) {
    const mean = clamp(blockMean(block), 0.01, 0.99);
    for (let index = block.start; index <= block.end; index += 1) {
      out[index] = mean;
    }
  }
  return out;
}

function parseThresholdLevel(market: PredictionMarketQuote): number | null {
  if (typeof market.floorStrike === "number" && Number.isFinite(market.floorStrike)) return market.floorStrike;

  const haystack = `${market.title} ${market.subtitle ?? ""} ${market.rulesPrimary ?? ""}`;
  const patterns = [
    /(\d+(?:,\d{3})*(?:\.\d+)?)\s*\+/i,
    /(?:over|under|at least|at most|greater than|less than|above|below)\s+\$?(\d+(?:,\d{3})*(?:\.\d+)?)/i,
    /\$?(\d+(?:,\d{3})*(?:\.\d+)?)/,
  ];

  for (const pattern of patterns) {
    const match = haystack.match(pattern);
    if (!match) continue;
    const value = Number(match[1].replace(/,/g, ""));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function parseThresholdDirection(market: PredictionMarketQuote): "increasing" | "decreasing" | null {
  const haystack = `${market.title} ${market.subtitle ?? ""} ${market.rulesPrimary ?? ""} ${market.strikeType ?? ""}`.toLowerCase();
  if (/(less_or_equal|under|at most|less than|below)/.test(haystack)) return "increasing";
  if (/(greater_or_equal|over|at least|greater than|above|\+)/.test(haystack)) return "decreasing";
  return null;
}

function normalizeCalendarFamily(market: PredictionMarketQuote): string | null {
  const haystack = `${market.title} ${market.rulesPrimary ?? ""}`.toLowerCase();
  const cumulative = /( by |before|this week|this month|this year|at any point|reach|hit|exceed|touch|above|below)/.test(haystack);
  if (!cumulative) return null;

  const normalized = `${market.category}|${market.title.toLowerCase()}|${market.strikeType ?? ""}|${parseThresholdLevel(market) ?? ""}`
    .replace(/\b\d{1,2}:\d{2}\s*(am|pm)?\b/g, " ")
    .replace(/\b\d+\s*(mins?|minutes?|hours?|days?|weeks?|months?|years?)\b/g, " ")
    .replace(/\b(today|tonight|tomorrow|week|month|quarter|year|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || null;
}

function parseComboComponents(market: PredictionMarketQuote): string[] {
  const lower = market.title.toLowerCase();
  const matches = [...lower.matchAll(/\byes\s+([^,]+)/g)].map((match) => match[1].trim());
  if (matches.length >= 2) return [...new Set(matches)];

  if (/(both|all of|either)/.test(lower)) {
    return lower
      .replace(/\b(both|all of|either|yes|no)\b/g, " ")
      .split(/,| and /)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return [];
}

function structuralRulebookScore(market: PredictionMarketQuote) {
  const text = `${market.rulesPrimary ?? ""} ${market.rulesSecondary ?? ""}`.toLowerCase();
  let score = 0;
  if (/(official|final|cf benchmarks|source)/.test(text)) score += 0.06;
  if (/(average|simple average|sixty seconds|60)/.test(text)) score -= 0.04;
  if (/(revis|correction|amend)/.test(text)) score -= 0.05;
  if (/(est|edt|cst|cdt|utc|timezone|time zone)/.test(text)) score -= 0.025;
  return clamp(score, -0.14, 0.12);
}

function projectStateProbabilities(logits: number[], transform: ProbabilityTransform, temperature: number): number[] {
  if (transform === "SPARSEMAX") return sparsemax(logits, temperature);
  if (transform === "ENTMAX15") return entmaxBisect(logits, STRUCTURAL_ENTMAX_ALPHA, temperature);
  return softmax(logits, temperature);
}

function chooseStructuralTransform(args: {
  baseMasses: number[];
  stateFeatures: number[];
  weights: number[];
}): ProbabilityTransform {
  const { baseMasses, stateFeatures, weights } = args;
  const dominantMass = Math.max(...baseMasses);
  const activeStates = baseMasses.filter((mass) => mass >= 0.12).length;
  const meanWeight = average(weights);
  const featureDispersion = average(stateFeatures.map((value) => Math.abs(value)));

  if (activeStates <= 2 && dominantMass >= 0.52 && meanWeight <= 1.15) return "SPARSEMAX";
  if (featureDispersion <= 0.02 && activeStates >= Math.max(3, Math.ceil(baseMasses.length * 0.7))) return "SOFTMAX";
  return "ENTMAX15";
}

function structuralStateProbs(args: {
  baseMasses: number[];
  stateFeatures: number[];
  weights: number[];
  temperature: number;
}): {
  states: number[];
  transform: ProbabilityTransform;
  softmaxBaseline: number[];
} {
  const { baseMasses, stateFeatures, weights, temperature } = args;
  const logits = baseMasses.map((mass, index) => Math.log(Math.max(1e-5, mass)) + (stateFeatures[index] ?? 0));
  const transform = chooseStructuralTransform({ baseMasses, stateFeatures, weights });
  const states = projectStateProbabilities(logits, transform, temperature);
  const softmaxBaseline = softmax(logits, temperature);
  return { states, transform, softmaxBaseline };
}

function buildMarketMathContext(markets: PredictionMarketQuote[]): MarketMathContext {
  const strikeFairByTicker = new Map<string, number>();
  const calendarFairByTicker = new Map<string, number>();
  const comboFairByTicker = new Map<string, number>();
  const structuralFairByTicker = new Map<string, number>();
  const structuralTransformByTicker = new Map<string, ProbabilityTransform>();
  const notesByTicker = new Map<string, string[]>();

  function pushNote(ticker: string, note: string) {
    const next = notesByTicker.get(ticker) ?? [];
    if (!next.includes(note)) next.push(note);
    notesByTicker.set(ticker, next);
  }

  const strikeGroups = new Map<string, Array<{ market: PredictionMarketQuote; strike: number; direction: "increasing" | "decreasing" }>>();
  for (const market of markets) {
    const strike = parseThresholdLevel(market);
    const direction = parseThresholdDirection(market);
    const key = market.eventTicker ?? "";
    if (strike === null || !direction || !key) continue;
    const next = strikeGroups.get(`${key}:${direction}`) ?? [];
    next.push({ market, strike, direction });
    strikeGroups.set(`${key}:${direction}`, next);
  }

  for (const rows of strikeGroups.values()) {
    if (rows.length < 2) continue;
    rows.sort((a, b) => a.strike - b.strike);
    const observed = rows.map(({ market }) => marketYesReferenceProb(market));
    const weights = rows.map(({ market }) => marketWeight(market));
    const fair = isotonicRegression(observed, weights, rows[0].direction === "increasing");
    const normalizedWeights = weights.map((weight) => weight / Math.max(1, average(weights)));
    const stateFeatures = new Array(rows.length + 1).fill(0).map((_, index) => {
      const left = rows[Math.max(0, index - 1)]?.market ?? rows[0].market;
      const right = rows[Math.min(rows.length - 1, index)]?.market ?? rows[rows.length - 1].market;
      const micro = ((normalizedWeights[Math.max(0, index - 1)] ?? normalizedWeights[0]) + (normalizedWeights[Math.min(rows.length - 1, index)] ?? normalizedWeights[rows.length - 1]) - 2) * 0.07;
      const rulebook = (structuralRulebookScore(left) + structuralRulebookScore(right)) * 0.5;
      return micro + rulebook;
    });
    const baseMasses =
      rows[0].direction === "decreasing"
        ? [
            clamp(1 - fair[0], 1e-5, 1),
            ...fair.slice(0, -1).map((value, index) => clamp(value - fair[index + 1], 1e-5, 1)),
            clamp(fair[fair.length - 1], 1e-5, 1),
          ]
        : [
            clamp(fair[0], 1e-5, 1),
            ...fair.slice(1).map((value, index) => clamp(value - fair[index], 1e-5, 1)),
            clamp(1 - fair[fair.length - 1], 1e-5, 1),
          ];
    const structural = structuralStateProbs({
      baseMasses,
      stateFeatures,
      weights,
      temperature: clamp(0.88 + 0.18 / Math.max(1, average(weights)), 0.72, 1.15),
    });
    const structuralFair =
      rows[0].direction === "decreasing"
        ? rows.map((_, index) => clamp(structural.states.slice(index + 1).reduce((sum, value) => sum + value, 0), 0.01, 0.99))
        : rows.map((_, index) => clamp(structural.states.slice(0, index + 1).reduce((sum, value) => sum + value, 0), 0.01, 0.99));
    const softmaxFair =
      rows[0].direction === "decreasing"
        ? rows.map((_, index) => clamp(structural.softmaxBaseline.slice(index + 1).reduce((sum, value) => sum + value, 0), 0.01, 0.99))
        : rows.map((_, index) => clamp(structural.softmaxBaseline.slice(0, index + 1).reduce((sum, value) => sum + value, 0), 0.01, 0.99));

    rows.forEach(({ market }, index) => {
      strikeFairByTicker.set(market.ticker, fair[index]);
      structuralFairByTicker.set(
        market.ticker,
        structuralFairByTicker.has(market.ticker)
          ? average([structuralFairByTicker.get(market.ticker) ?? structuralFair[index], structuralFair[index]])
          : structuralFair[index],
      );
      structuralTransformByTicker.set(market.ticker, structural.transform);
      const residual = fair[index] - observed[index];
      if (Math.abs(residual) >= 0.01) {
        pushNote(market.ticker, `Strike ladder coherence residual ${(residual * 100).toFixed(2)}bp after isotonic projection.`);
      }
      const structuralResidual = structuralFair[index] - fair[index];
      if (Math.abs(structuralResidual) >= 0.005) {
        pushNote(
          market.ticker,
          `${structural.transform} latent-state layer shifted strike fair value ${(structuralResidual * 100).toFixed(2)}bp from isotonic baseline.`,
        );
      }
      const baselineGap = structuralFair[index] - softmaxFair[index];
      if (structural.transform !== "SOFTMAX" && Math.abs(baselineGap) >= 0.004) {
        pushNote(
          market.ticker,
          `${structural.transform} selected over softmax baseline with ${(baselineGap * 100).toFixed(2)}bp fair-value difference.`,
        );
      }
    });
  }

  const calendarGroups = new Map<string, PredictionMarketQuote[]>();
  for (const market of markets) {
    const family = normalizeCalendarFamily(market);
    if (!family || !market.closeTime) continue;
    const next = calendarGroups.get(family) ?? [];
    next.push(market);
    calendarGroups.set(family, next);
  }

  for (const rows of calendarGroups.values()) {
    if (rows.length < 2) continue;
    rows.sort((a, b) => new Date(a.closeTime ?? 0).getTime() - new Date(b.closeTime ?? 0).getTime());
    const observed = rows.map((market) => marketYesReferenceProb(market));
    const weights = rows.map((market) => marketWeight(market));
    const fair = isotonicRegression(observed, weights, true);
    const normalizedWeights = weights.map((weight) => weight / Math.max(1, average(weights)));
    const stateFeatures = new Array(rows.length + 1).fill(0).map((_, index) => {
      const left = rows[Math.max(0, index - 1)] ?? rows[0];
      const right = rows[Math.min(rows.length - 1, index)] ?? rows[rows.length - 1];
      const micro = ((normalizedWeights[Math.max(0, index - 1)] ?? normalizedWeights[0]) + (normalizedWeights[Math.min(rows.length - 1, index)] ?? normalizedWeights[rows.length - 1]) - 2) * 0.06;
      const rulebook = (structuralRulebookScore(left) + structuralRulebookScore(right)) * 0.5;
      return micro + rulebook;
    });
    const baseMasses = [
      clamp(fair[0], 1e-5, 1),
      ...fair.slice(1).map((value, index) => clamp(value - fair[index], 1e-5, 1)),
      clamp(1 - fair[fair.length - 1], 1e-5, 1),
    ];
    const structural = structuralStateProbs({
      baseMasses,
      stateFeatures,
      weights,
      temperature: clamp(0.9 + 0.16 / Math.max(1, average(weights)), 0.74, 1.18),
    });
    const structuralFair = rows.map((_, index) => clamp(structural.states.slice(0, index + 1).reduce((sum, value) => sum + value, 0), 0.01, 0.99));
    const softmaxFair = rows.map((_, index) => clamp(structural.softmaxBaseline.slice(0, index + 1).reduce((sum, value) => sum + value, 0), 0.01, 0.99));

    rows.forEach((market, index) => {
      calendarFairByTicker.set(market.ticker, fair[index]);
      structuralFairByTicker.set(
        market.ticker,
        structuralFairByTicker.has(market.ticker)
          ? average([structuralFairByTicker.get(market.ticker) ?? structuralFair[index], structuralFair[index]])
          : structuralFair[index],
      );
      structuralTransformByTicker.set(market.ticker, structural.transform);
      const residual = fair[index] - observed[index];
      if (Math.abs(residual) >= 0.01) {
        pushNote(market.ticker, `Calendar term-structure residual ${(residual * 100).toFixed(2)}bp versus monotone hazard projection.`);
      }
      const structuralResidual = structuralFair[index] - fair[index];
      if (Math.abs(structuralResidual) >= 0.005) {
        pushNote(
          market.ticker,
          `${structural.transform} latent-state layer shifted calendar fair value ${(structuralResidual * 100).toFixed(2)}bp from isotonic baseline.`,
        );
      }
      const baselineGap = structuralFair[index] - softmaxFair[index];
      if (structural.transform !== "SOFTMAX" && Math.abs(baselineGap) >= 0.004) {
        pushNote(
          market.ticker,
          `${structural.transform} selected over softmax baseline with ${(baselineGap * 100).toFixed(2)}bp fair-value difference.`,
        );
      }
    });
  }

  const comboGroups = new Map<string, Array<{ market: PredictionMarketQuote; count: number }>>();
  for (const market of markets) {
    const components = parseComboComponents(market);
    const key = market.eventTicker ?? "";
    if (components.length < 2 || !key) continue;
    const next = comboGroups.get(key) ?? [];
    next.push({ market, count: components.length });
    comboGroups.set(key, next);
  }

  for (const rows of comboGroups.values()) {
    if (rows.length < 2) continue;
    rows.sort((a, b) => a.count - b.count);
    const observed = rows.map(({ market }) => marketYesReferenceProb(market));
    const weights = rows.map(({ market }) => marketWeight(market));
    const fair = isotonicRegression(observed, weights, false);

    rows.forEach(({ market }, index) => {
      comboFairByTicker.set(market.ticker, fair[index]);
      const residual = fair[index] - observed[index];
      if (Math.abs(residual) >= 0.01) {
        pushNote(market.ticker, `Correlation/dispersion residual ${(residual * 100).toFixed(2)}bp versus combo monotonicity projection.`);
      }
    });
  }

  return {
    strikeFairByTicker,
    calendarFairByTicker,
    comboFairByTicker,
    structuralFairByTicker,
    structuralTransformByTicker,
    notesByTicker,
  };
}

function extractStockMidPrice(snapshot: unknown) {
  const row = (snapshot ?? {}) as Record<string, unknown>;
  const latestTrade = (row.latestTrade ?? {}) as Record<string, unknown>;
  const minuteBar = (row.minuteBar ?? {}) as Record<string, unknown>;
  const dailyBar = (row.dailyBar ?? {}) as Record<string, unknown>;
  const prevDailyBar = (row.prevDailyBar ?? {}) as Record<string, unknown>;
  return firstDefined(
    typeof latestTrade.p === "number" ? latestTrade.p : null,
    typeof minuteBar.c === "number" ? minuteBar.c : null,
    typeof dailyBar.c === "number" ? dailyBar.c : null,
    typeof prevDailyBar.c === "number" ? prevDailyBar.c : null,
  );
}

function inferSyntheticUnderlying(market: PredictionMarketQuote): "SPY" | "QQQ" | null {
  const text = `${market.title} ${market.subtitle ?? ""} ${market.eventTicker ?? ""}`.toLowerCase();
  if (/(spy|s&p\s*500|spx|sp500)/.test(text)) return "SPY";
  if (/(qqq|nasdaq-100|ndx|nasdaq 100)/.test(text)) return "QQQ";
  return null;
}

function inferSyntheticOverlayTarget(
  market: PredictionMarketQuote,
  spotByUnderlying: Map<string, number>,
): { underlying: "SPY" | "QQQ"; strike: number; mismatchPenalty: number } | null {
  const underlying = inferSyntheticUnderlying(market);
  const rawStrike = parseThresholdLevel(market);
  if (!underlying || rawStrike === null) return null;

  const text = `${market.title} ${market.subtitle ?? ""}`.toLowerCase();
  const directEtf = underlying === "SPY" ? /\bspy\b/.test(text) : /\bqqq\b/.test(text);
  const spot = spotByUnderlying.get(underlying) ?? null;
  let strike = rawStrike;
  let mismatchPenalty = directEtf ? 0.006 : 0.018;

  if (spot && rawStrike > spot * 1.75) {
    const scale = spot / rawStrike;
    const plausible =
      (underlying === "SPY" && scale >= 0.07 && scale <= 0.16) ||
      (underlying === "QQQ" && scale >= 0.015 && scale <= 0.08);
    if (!plausible) return null;
    strike = rawStrike * scale;
    mismatchPenalty += Math.min(0.04, Math.abs(1 - scale) * 0.05);
  }

  return {
    underlying,
    strike: Number(strike.toFixed(3)),
    mismatchPenalty: Number(mismatchPenalty.toFixed(4)),
  };
}

function parseOptionContractSymbol(symbol: string) {
  const match = symbol.match(/^[A-Z]+(\d{6})([CP])(\d{8})$/);
  if (!match) return null;
  const [, expiryRaw, type, strikeRaw] = match;
  const year = Number(`20${expiryRaw.slice(0, 2)}`);
  const month = Number(expiryRaw.slice(2, 4));
  const day = Number(expiryRaw.slice(4, 6));
  const expiry = Date.UTC(year, month - 1, day);
  const strike = Number(strikeRaw) / 1000;
  return { expiry, type, strike };
}

function buildSyntheticDigitalBand(args: {
  market: PredictionMarketQuote;
  underlying: string;
  strike: number;
  mismatchPenalty: number;
  chain: Record<string, { latestQuote?: { ap?: number; bp?: number }; latestTrade?: { p?: number }; minuteBar?: { c?: number } }>;
}): SyntheticDigitalBand | null {
  const { market, underlying, strike, mismatchPenalty, chain } = args;
  const targetExpiry = market.closeTime ? new Date(market.closeTime).getTime() : Date.now();
  const calls = Object.entries(chain)
    .map(([symbol, snapshot]) => {
      const parsed = parseOptionContractSymbol(symbol);
      if (!parsed || parsed.type !== "C") return null;
      const ask = typeof snapshot.latestQuote?.ap === "number" ? snapshot.latestQuote.ap : null;
      const bid = typeof snapshot.latestQuote?.bp === "number" ? snapshot.latestQuote.bp : null;
      const mid = firstDefined(
        ask !== null && bid !== null ? (ask + bid) / 2 : null,
        typeof snapshot.latestTrade?.p === "number" ? snapshot.latestTrade.p : null,
        typeof snapshot.minuteBar?.c === "number" ? snapshot.minuteBar.c : null,
      );
      if (mid === null) return null;
      return {
        expiry: parsed.expiry,
        strike: parsed.strike,
        bid: bid ?? Math.max(0, mid - 0.02),
        ask: ask ?? mid + 0.02,
        mid,
      };
    })
    .filter((row): row is { expiry: number; strike: number; bid: number; ask: number; mid: number } => row !== null);

  if (!calls.length) return null;

  const expiries = [...new Set(calls.map((row) => row.expiry))].sort(
    (a, b) => Math.abs(a - targetExpiry) - Math.abs(b - targetExpiry),
  );
  const chosenExpiry = expiries[0];
  const sameExpiry = calls.filter((row) => row.expiry === chosenExpiry).sort((a, b) => a.strike - b.strike);
  const lower = [...sameExpiry].filter((row) => row.strike < strike).sort((a, b) => b.strike - a.strike)[0];
  const upper = sameExpiry.find((row) => row.strike > strike);
  if (!lower || !upper) return null;

  const deltaK = upper.strike - lower.strike;
  if (!(deltaK > 0)) return null;

  const fairMid = clamp((lower.mid - upper.mid) / deltaK, 0.01, 0.99);
  const fairLower = clamp((lower.bid - upper.ask) / deltaK, 0.01, 0.99);
  const fairUpper = clamp((lower.ask - upper.bid) / deltaK, fairLower, 0.99);
  const strikeGapPenalty = Math.min(0.04, Math.abs(((lower.strike + upper.strike) / 2) - strike) / Math.max(1, strike) * 0.8);

  return {
    fairMid,
    fairLower,
    fairUpper,
    strike,
    underlying,
    mismatchPenalty: Number((mismatchPenalty + strikeGapPenalty).toFixed(4)),
    notes: [
      `Synthetic hedge overlay derived from ${underlying} call spread around strike ${strike.toFixed(2)} using executable option quotes.`,
      `Executable digital band ${((fairLower) * 100).toFixed(2)}%-${((fairUpper) * 100).toFixed(2)}% with mismatch penalty ${((mismatchPenalty + strikeGapPenalty) * 100).toFixed(2)}%.`,
    ],
  };
}

async function buildOverlayContext(markets: PredictionMarketQuote[]): Promise<OverlayContext> {
  const underlyings = [...new Set(markets.map((market) => inferSyntheticUnderlying(market)).filter((value): value is "SPY" | "QQQ" => value !== null))];
  if (!underlyings.length) {
    return {
      syntheticBandsByTicker: new Map(),
    };
  }

  try {
    const stockSnapshots = await getStockSnapshots(underlyings);
    const spotByUnderlying = new Map<string, number>();
    for (const underlying of underlyings) {
      const spot = extractStockMidPrice((stockSnapshots as Record<string, unknown>)[underlying]);
      if (typeof spot === "number" && Number.isFinite(spot)) {
        spotByUnderlying.set(underlying, spot);
      }
    }

    const chains = new Map<string, Record<string, { latestQuote?: { ap?: number; bp?: number }; latestTrade?: { p?: number }; minuteBar?: { c?: number } }>>();
    await Promise.all(
      underlyings.map(async (underlying) => {
        try {
          chains.set(underlying, await getOptionChainSnapshots(underlying));
        } catch {
          chains.set(underlying, {});
        }
      }),
    );

    const syntheticBandsByTicker = new Map<string, SyntheticDigitalBand>();
    for (const market of markets) {
      const target = inferSyntheticOverlayTarget(market, spotByUnderlying);
      if (!target) continue;
      const band = buildSyntheticDigitalBand({
        market,
        underlying: target.underlying,
        strike: target.strike,
        mismatchPenalty: target.mismatchPenalty,
        chain: chains.get(target.underlying) ?? {},
      });
      if (band) syntheticBandsByTicker.set(market.ticker, band);
    }

    return { syntheticBandsByTicker };
  } catch {
    return {
      syntheticBandsByTicker: new Map(),
    };
  }
}

function applyCoherenceAdjustment(
  market: PredictionMarketQuote,
  chosenSide: PredictionSide,
  context: MarketMathContext,
): CoherenceAdjustment {
  const notes = context.notesByTicker.get(market.ticker) ?? [];
  const yesObserved = marketYesReferenceProb(market);
  
  const structuralProb = context.structuralFairByTicker.get(market.ticker);
  const calendarProb = context.calendarFairByTicker.get(market.ticker);
  const comboProb = context.comboFairByTicker.get(market.ticker);
  const strikeProb = context.strikeFairByTicker.get(market.ticker);

  const fairCandidates = [structuralProb, calendarProb, comboProb, strikeProb].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );

  if (!fairCandidates.length) {
    return {
      yesFairProb: null,
      coherenceEdge: 0,
      notes,
    };
  }

  // Structural sub-graph arbitrage bounds (exact-bin, calendar limits, combo)
  let maxDeviation = 0;
  let worstType = "";

  if (typeof structuralProb === "number") {
      const dev = structuralProb - yesObserved;
      if (Math.abs(dev) > Math.abs(maxDeviation)) { maxDeviation = dev; worstType = "exact-bin partition"; }
  }
  if (typeof calendarProb === "number") {
      const dev = calendarProb - yesObserved;
      if (Math.abs(dev) > Math.abs(maxDeviation)) { maxDeviation = dev; worstType = "calendar containment"; }
  }
  if (typeof comboProb === "number") {
      const dev = comboProb - yesObserved;
      if (Math.abs(dev) > Math.abs(maxDeviation)) { maxDeviation = dev; worstType = "combo inclusion"; }
  }

  let yesFairProb = clamp(average(fairCandidates), 0.01, 0.99);
  let coherenceEdge = chosenSide === "YES" ? yesFairProb - yesObserved : yesObserved - yesFairProb;

  // Override standard averaging if we detect a massive graph topology violation
  if (Math.abs(maxDeviation) > 0.04) {
      notes.push(`Graph constraint violation detected: node diverges from ${worstType} by ${(maxDeviation * 100).toFixed(1)}%.`);
      
      // We force the fair probability to align with the starkest structural bound
      yesFairProb = clamp(yesObserved + maxDeviation, 0.01, 0.99);
      coherenceEdge = chosenSide === "YES" ? maxDeviation : -maxDeviation;
  }

  return {
    yesFairProb,
    coherenceEdge,
    notes,
  };
}

function estimateRulebookProbability(args: {
  market: PredictionMarketQuote;
  chosenProb: number;
  spread: number;
  liquidityScore: number;
}): RulebookProbabilityEstimate {
  const { market, chosenProb, spread, liquidityScore } = args;
  const rulesText = `${market.rulesPrimary ?? ""} ${market.rulesSecondary ?? ""}`.toLowerCase();
  const notes: string[] = [];

  let uncertainty = 0.014;
  if (/average|simple average|sixty seconds|60/.test(rulesText)) {
    uncertainty += 0.016;
    notes.push("Averaging settlement detected; probability interval widened to reflect transform risk.");
  }
  if (/(official|final|cf benchmarks|source)/.test(rulesText)) {
    uncertainty -= 0.003;
    notes.push("Named source reduces ambiguity relative to headline-only settlement.");
  }
  if (/(revis|correction|amend)/.test(rulesText)) {
    uncertainty += 0.02;
    notes.push("Revision risk detected in settlement wording.");
  }
  if (/(est|edt|cst|cdt|utc|timezone|time zone)/.test(rulesText)) {
    uncertainty += 0.008;
    notes.push("Timezone/timestamp specificity increases settlement-interpretation risk.");
  }
  if (market.settlementTimerSeconds > 0) {
    uncertainty += Math.min(0.01, market.settlementTimerSeconds / 7200);
  }
  uncertainty += spread * 0.08;
  uncertainty -= clamp(liquidityScore - 0.35, 0, 0.4) * 0.02;
  uncertainty = clamp(uncertainty, 0.01, 0.09);

  const prob = clamp(0.5 + (chosenProb - 0.5) * (1 - uncertainty * 1.2), 0.02, 0.98);
  const lower = clamp(prob - uncertainty, 0.02, 0.98);
  const upper = clamp(prob + uncertainty, 0.02, 0.98);

  const expectedLagDays =
    market.expectedExpirationTime && market.closeTime
      ? Math.max(0, (new Date(market.expectedExpirationTime).getTime() - new Date(market.closeTime).getTime()) / 86_400_000)
      : 0;
  const latestLagDays =
    market.latestExpirationTime && market.closeTime
      ? Math.max(0, (new Date(market.latestExpirationTime).getTime() - new Date(market.closeTime).getTime()) / 86_400_000)
      : 0;
  const settlementLagDays = Math.max(1 / 24, expectedLagDays, latestLagDays * 0.5, market.settlementTimerSeconds / 86_400);

  return {
    prob,
    lower,
    upper,
    uncertainty,
    settlementLagDays,
    notes,
  };
}

function estimateExecutionAlpha(args: {
  market: PredictionMarketQuote;
  side: PredictionSide;
  marketProb: number;
  rulebookProb: number;
  rulebookProbLower: number;
  rulebookProbUpper: number;
  timeToCloseDays: number;
  recentMarkoutPenalty: number;
}): ExecutionAlphaEstimate {
  const { market, side, marketProb, rulebookProb, rulebookProbLower, rulebookProbUpper, timeToCloseDays, recentMarkoutPenalty } = args;
  
  const tick = market.tickSize ? market.tickSize / 100 : 0.01;
  const sideBid = side === "YES" ? market.yesBid : market.noBid;
  const sideAsk = side === "YES" ? market.yesAsk : market.noAsk;
  const sideBidSize = side === "YES" ? market.yesBidSize : market.noBidSize;
  const sideAskSize = side === "YES" ? market.yesAskSize : market.noAskSize;
  const spread = clamp(Math.max(tick, (sideAsk ?? marketProb) - (sideBid ?? marketProb)), tick, 0.5);
  const imbalance = (sideBidSize - sideAskSize) / Math.max(1, sideBidSize + sideAskSize);
  const visibleDepth = Math.max(1, sideBidSize + sideAskSize + market.liquidityDollars * 4);
  const sigmaLogOdds = clamp(spread * 3.1 + 0.45 / Math.sqrt(visibleDepth), 0.08, 1.25);
  const horizonScale = clamp((timeToCloseDays * 24) / 6, 0.05, 1.25);
  const gamma = clamp(0.55 + (1 / Math.sqrt(visibleDepth)) * 1.8, 0.45, 1.1);
  const uncertaintyWidth = clamp(rulebookProbUpper - rulebookProbLower, 0, 0.45);
  const newsArrivalIntensity = clamp(
    (market.category === "POLITICS" || market.category === "SPORTS" || market.category === "ESPORTS" ? 0.18 : 0.08) +
      Math.max(0, 0.18 - timeToCloseDays) * 1.4 +
      Math.log1p(market.volume + market.openInterest) / 18,
    0.04,
    0.95,
  );

  const inventorySkew = clamp(Math.sign(rulebookProb - marketProb) * (1 + imbalance), -2, 2);
  const reservationLogOdds = logit(marketProb) - gamma * inventorySkew * sigmaLogOdds * sigmaLogOdds * horizonScale;
  const reservationPrice = clamp(sigmoid(reservationLogOdds), 0.001, 0.999);
  const uncertaintyWidening = clamp(
    Math.max(tick, UNCERTAINTY_QUOTE_WIDENING_ALPHA * uncertaintyWidth + recentMarkoutPenalty * 0.5),
    tick,
    0.08,
  );
  const insidePassive = clamp(
    spread > tick + 1e-6
      ? Math.min(reservationPrice, (sideAsk ?? marketProb) - tick)
      : Math.max(tick, firstDefined(sideBid, reservationPrice - tick, marketProb) ?? marketProb),
    0.001,
    0.999,
  );
  const widenedPassive = clamp(insidePassive - uncertaintyWidening, 0.001, 0.999);
  const deepPassive = clamp(widenedPassive - Math.max(tick, uncertaintyWidening * 0.4), 0.001, 0.999);

  const priceLevels = [...new Set([
    clamp(sideAsk ?? marketProb, 0.001, 0.999),
    deepPassive,
    widenedPassive,
    insidePassive,
    clamp(reservationPrice, 0.001, 0.999),
    clamp(firstDefined(sideBid, reservationPrice - tick, marketProb) ?? marketProb, 0.001, 0.999),
    clamp((firstDefined(sideBid, marketProb) ?? marketProb) - tick, 0.001, 0.999),
  ])];

  const maxPatienceHours = clamp(timeToCloseDays * 24, 0.08, 8);
  const patienceChoices = [0.08, 0.25, 0.75, 1.5, 3].filter((hours) => hours <= maxPatienceHours);
  const oppositeFlow = Math.log1p(
    market.volume +
      market.openInterest +
      market.liquidityDollars * 5 +
      market.yesBidSize +
      market.yesAskSize +
      market.noBidSize +
      market.noAskSize,
  );

  let bestPlan: {
    price: number;
    fillProb: number;
    valuePerContract: number;
    patienceHours: number;
    role: ExecutionPlanRole;
    feePerContractUsd: number;
  } | null = null;

  for (const price of priceLevels) {
    for (const patienceHours of patienceChoices.length ? patienceChoices : [0.08]) {
      const role: ExecutionPlanRole =
        sideAsk !== null && price >= sideAsk - 1e-6
          ? "TAKER"
          : isMakerFeeMarket(market)
            ? "MAKER_FEE"
            : "MAKER";

      const queueAhead =
        role === "TAKER"
          ? 0
          : price > (sideBid ?? marketProb)
            ? 0
            : Math.max(0, sideBidSize + Math.round(((sideBid ?? marketProb) - price) / tick) * Math.max(1, Math.round(sideBidSize * 0.35)));
      const queueDepletion = clamp(
        (Math.max(0, sideAskSize - sideBidSize) + Math.max(0, queueAhead - sideBidSize)) /
          Math.max(1, sideAskSize + sideBidSize + queueAhead),
        0,
        1,
      );
      const staleLambda = clamp(0.35 + newsArrivalIntensity * 1.1 + spread * 3 + uncertaintyWidth * 2.2, 0.2, 2.5);
      const staleHazard = clamp(1 - Math.exp(-staleLambda * patienceHours), 0, 0.995);
      const recentMarkoutProxy = clamp(recentMarkoutPenalty * 12 + Math.max(0, -imbalance) * spread * 4.5, 0, 1);
      const toxicityScore = clamp(
        0.28 * Math.max(0, -imbalance) +
          0.24 * queueDepletion +
          0.24 * recentMarkoutProxy +
          0.24 * newsArrivalIntensity,
        0,
        1,
      );

      if (toxicityScore >= TOXICITY_PASSIVE_SHUTOFF && role !== "TAKER") {
        continue;
      }

      const lambda =
        (oppositeFlow * Math.sqrt(Math.max(0.08, patienceHours)) * (1 + Math.max(0, -imbalance) * 0.35)) /
        (1 + queueAhead * 0.5);
      const effectiveLambda = Math.max(0.001, lambda * (1 - staleHazard * 0.4) * (1 - toxicityScore * 0.35));
      const fillProb = clamp(1 - Math.exp(-effectiveLambda), role === "TAKER" ? 0.88 : 0.04, role === "TAKER" ? 0.995 : 0.97);

      const feePerContractUsd = estimateKalshiTradingFeeUsd({
        market,
        contracts: 1,
        price,
        role,
      }).totalUsd;

      const priceImprovement = Math.max(0, marketProb - price);
      const fadeBonus = clamp(-imbalance * Math.sign(rulebookProb - marketProb) * 0.012, -0.012, 0.012);
      const adverseSelectionRisk =
        role === "TAKER"
          ? 0
          : Math.max(0, (queueAhead / Math.max(1, oppositeFlow)) * 0.015 + toxicityScore * 0.012 + uncertaintyWidth * 0.08);
      const opportunityCost =
        Math.max(0, rulebookProb - marketProb) *
        (1 - fillProb) *
        (0.45 + patienceHours / Math.max(0.25, maxPatienceHours) + staleHazard * 0.5);
      const stalePenalty = staleHazard * (0.0035 + uncertaintyWidth * 0.12);
      const quoteAggressionPenalty = toxicityScore >= TOXICITY_WIDEN_THRESHOLD ? uncertaintyWidening * 0.2 : 0;

      const valuePerContract = clamp(
        fillProb * (rulebookProb - price + priceImprovement * 0.3 + fadeBonus - adverseSelectionRisk) -
          opportunityCost -
          feePerContractUsd -
          stalePenalty -
          quoteAggressionPenalty,
        -0.04,
        0.04,
      );

      if (!bestPlan || valuePerContract > bestPlan.valuePerContract) {
        bestPlan = {
          price,
          fillProb,
          valuePerContract,
          patienceHours,
          role,
          feePerContractUsd,
        };
      }
    }
  }

  const passivePrice = bestPlan?.price ?? insidePassive;
  const fillProb = bestPlan?.fillProb ?? 0.2;
  const valuePerContract = bestPlan?.valuePerContract ?? 0;
  const patienceHours = bestPlan?.patienceHours ?? 0.08;
  const assumedRole = bestPlan?.role ?? "MAKER";
  const feePerContractUsd = bestPlan?.feePerContractUsd ?? 0;
  const staleHazard = clamp(1 - Math.exp(-(0.35 + newsArrivalIntensity * 1.1 + spread * 3 + uncertaintyWidth * 2.2) * patienceHours), 0, 0.995);
  const toxicityScore = clamp(
    0.28 * Math.max(0, -imbalance) +
      0.24 * clamp(Math.max(0, sideAskSize - sideBidSize) / Math.max(1, sideAskSize + sideBidSize), 0, 1) +
      0.24 * clamp(recentMarkoutPenalty * 12 + Math.max(0, -imbalance) * spread * 4.5, 0, 1) +
      0.24 * newsArrivalIntensity,
    0,
    1,
  );

  const notes = [
    `Bounded log-odds A-S execution configured for tick=${tick.toFixed(3)} at ${(passivePrice * 100).toFixed(1)}c (fill probability ${(fillProb * 100).toFixed(1)}% over ${patienceHours.toFixed(2)}h).`,
    `Quote widening ${(uncertaintyWidening * 100).toFixed(2)}bp from robust interval width ${(uncertaintyWidth * 100).toFixed(2)}bp and recent markout headwind ${(recentMarkoutPenalty * 100).toFixed(2)}bp.`,
  ];
  if (Math.abs(imbalance) >= 0.2) {
    notes.push(`Adverse selection & retail-flow fade penalty applied from book imbalance ${(imbalance * 100).toFixed(1)}%.`);
  }
  if (staleHazard >= 0.35) {
    notes.push(`Stale-quote hazard ${(staleHazard * 100).toFixed(1)}%: patience reduced and repricing trigger tightened.`);
  }
  if (toxicityScore >= TOXICITY_WIDEN_THRESHOLD) {
    notes.push(`Short-horizon toxicity ${(toxicityScore * 100).toFixed(1)}% widened passive quotes${toxicityScore >= TOXICITY_PASSIVE_SHUTOFF ? " and disabled passive resting at critical level" : ""}.`);
  }
  if (Math.abs(passivePrice - reservationPrice) >= STALE_REPRICE_DRIFT_THRESHOLD) {
    notes.push(`Reservation/quote drift ${(Math.abs(passivePrice - reservationPrice) * 100).toFixed(2)}bp exceeds stale repricing threshold.`);
  }

  return {
    passivePrice,
    fillProb,
    valuePerContract,
    patienceHours,
    expectedExecutionValueUsd: Number(valuePerContract.toFixed(6)),
    assumedRole,
    feePerContractUsd,
    quoteWidening: Number(uncertaintyWidening.toFixed(6)),
    staleHazard: Number(staleHazard.toFixed(6)),
    toxicityScore: Number(toxicityScore.toFixed(6)),
    inventorySkew: Number(inventorySkew.toFixed(6)),
    notes,
  };
}

function estimateFeeUsd(args: {
  market: PredictionMarketQuote;
  contracts: number;
  executionAlpha: ExecutionAlphaEstimate;
}) {
  const { market, contracts, executionAlpha } = args;
  const fee = estimateKalshiTradingFeeUsd({
    market,
    contracts,
    price: executionAlpha.passivePrice,
    role: executionAlpha.assumedRole,
  });
  const perContract = contracts > 0 ? fee.totalUsd / contracts : 0;
  return {
    perContract: Number(perContract.toFixed(6)),
    totalUsd: Number(fee.totalUsd.toFixed(4)),
    assumedRole: executionAlpha.assumedRole,
    schedule: fee.schedule,
  };
}

function estimateIncentiveUsd(args: {
  market: PredictionMarketQuote;
  contracts: number;
  executionAlpha: ExecutionAlphaEstimate;
}) : IncentiveEstimate {
  const { market, contracts, executionAlpha } = args;
  const quoteDepth = market.yesBidSize + market.yesAskSize + market.noBidSize + market.noAskSize;
  const liquidityShare = clamp(Math.log1p(quoteDepth + market.liquidityDollars * 6) / 10, 0, 1);
  const liquidityUsd = Number((Math.min(contracts * 0.0025, contracts * 0.0012 * liquidityShare * executionAlpha.fillProb)).toFixed(4));
  const volumeUsd = Number((Math.min(contracts * 0.005, contracts * 0.0015 * Math.max(0.25, executionAlpha.fillProb))).toFixed(4));
  const notes = [
    `Incentive estimate uses conservative liquidity-share proxy ${(liquidityShare * 100).toFixed(0)}% and current program caps.`,
  ];

  return {
    liquidityUsd,
    volumeUsd,
    totalUsd: Number((liquidityUsd + volumeUsd).toFixed(4)),
    notes,
  };
}

function estimateCapitalTimeDays(market: PredictionMarketQuote) {
  const closeDays = Math.max(1 / 288, Number(daysUntil(market.closeTime).toFixed(6)));
  const expectedLagDays =
    market.expectedExpirationTime && market.closeTime
      ? Math.max(0, (new Date(market.expectedExpirationTime).getTime() - new Date(market.closeTime).getTime()) / 86_400_000)
      : 0;
  const timerLagDays = Math.max(1 / 48, market.settlementTimerSeconds / 86_400);
  return Number((closeDays + Math.max(expectedLagDays, timerLagDays)).toFixed(6));
}

function isHighProbabilityLowEvCandidate(candidate: PredictionCandidate, rules: ModeRules): boolean {
  const thresholds = resolveHighProbThresholds({
    category: candidate.category,
    timeToCloseDays: candidate.timeToCloseDays,
    rules,
  });
  return (
    candidate.modelProb >= thresholds.modelMin &&
    candidate.marketProb >= thresholds.marketMin &&
    candidate.edge >= thresholds.edgeMin &&
    candidate.edge <= rules.highProbMaxEdge &&
    candidate.confidence >= thresholds.confidenceMin
  );
}

function highProbabilityPreferenceScore(candidate: PredictionCandidate, rules: ModeRules): number {
  const edgeMidpoint = (rules.highProbMinEdge + rules.highProbMaxEdge) / 2;
  const edgeBand = Math.max(0.0015, rules.highProbMaxEdge - rules.highProbMinEdge);
  const edgeDistancePenalty = clamp(Math.abs(candidate.edge - edgeMidpoint) / edgeBand, 0, 1);
  const horizonBonus = 1 / Math.max(0.5, candidate.timeToCloseDays ?? 7);
  const probabilityGap = Math.max(0, candidate.modelProb - candidate.marketProb);

  return (
    candidate.modelProb * 0.9 +
    probabilityGap * 0.45 +
    candidate.confidence * 0.28 +
    (1 - edgeDistancePenalty) * 0.22 +
    horizonBonus * 0.04
  );
}

function bitcoinMainstayScore(candidate: PredictionCandidate): number {
  const horizon = Math.max(MIN_HORIZON_DAYS, candidate.timeToCloseDays ?? 30);
  const microBonus = horizon <= BITCOIN_MICRO_HORIZON_DAYS
    ? clamp((BITCOIN_MICRO_HORIZON_DAYS - horizon) / BITCOIN_MICRO_HORIZON_DAYS, 0, 1) * 0.08
    : 0;
  const focusBonus = clamp((BITCOIN_FOCUS_HORIZON_DAYS / horizon) - 0.4, 0, 1.2) * 0.06;
  return candidateUtilityScore(candidate, MODE_RULES.CONSERVATIVE) + microBonus + focusBonus;
}

function classifyOpportunityType(
  edge: number,
  confidence: number,
  spread: number,
  liquidityScore: number,
  isSecondaryEntry: boolean,
  isHighProbabilityLane: boolean,
  rules: ModeRules,
): OpportunityType {
  if (edge <= 0.0015 || confidence <= 0.38 || spread >= 0.17) return "PASS";
  if (isHighProbabilityLane) {
    const highProbSpreadCap = clamp(Math.max(0.12, rules.maxSpread * 1.1), 0.12, 0.2);
    const highProbConfidenceFloor = Math.max(0.34, rules.highProbMinConfidence - 0.05);
    const highProbLiquidityFloor = Math.max(0.1, rules.minLiquidityScore * 0.6);
    if (confidence >= highProbConfidenceFloor && spread <= highProbSpreadCap && liquidityScore >= highProbLiquidityFloor) {
      return "HEDGE";
    }
    return "WATCHLIST";
  }
  if (isSecondaryEntry || edge < rules.minEdge * 1.2 || liquidityScore < Math.max(0.25, rules.minLiquidityScore)) {
    return "WATCHLIST";
  }
  if (confidence < rules.confidenceFloor + 0.03 || spread > rules.maxSpread * 0.75) return "HEDGE";
  return "TRADE";
}

function verdictFromOpportunity(type: OpportunityType, side: PredictionSide): CandidateVerdict {
  if (type === "PASS") return "PASS";
  if (type === "WATCHLIST") return "WATCHLIST";
  return side === "YES" ? "BUY_YES" : "BUY_NO";
}

function liquidityExecutionQuality(spread: number, liquidityScore: number): "HIGH" | "MEDIUM" | "LOW" {
  if (spread <= 0.04 && liquidityScore >= 0.5) return "HIGH";
  if (spread <= 0.09 && liquidityScore >= 0.3) return "MEDIUM";
  return "LOW";
}

function microEfficiency(spread: number, liquidityScore: number): "EFFICIENT" | "SEMI_EFFICIENT" | "SOFT" {
  if (spread <= 0.035 && liquidityScore >= 0.55) return "EFFICIENT";
  if (spread <= 0.09 && liquidityScore >= 0.3) return "SEMI_EFFICIENT";
  return "SOFT";
}

function manipulationRisk(spread: number, liquidityScore: number): "LOW" | "MEDIUM" | "HIGH" {
  if (spread > 0.11 || liquidityScore < 0.22) return "HIGH";
  if (spread > 0.06 || liquidityScore < 0.35) return "MEDIUM";
  return "LOW";
}

function inferMispricingDrivers(
  market: PredictionMarketQuote,
  spread: number,
  liquidityScore: number,
): string[] {
  const haystack = `${market.title} ${market.subtitle ?? ""}`.toLowerCase();
  const drivers = new Set<string>();

  if (liquidityScore < 0.32 || spread > 0.09) drivers.add("manipulation or thin liquidity");
  if (/(breaking|shock|panic|surge|crash|viral|rumor)/.test(haystack)) drivers.add("emotional narratives");
  if (/(streak|last|recent|again)/.test(haystack)) drivers.add("recency bias");
  if (/(favorite|underdog|popular)/.test(haystack)) drivers.add("public overreaction");

  if (market.category === "SPORTS") {
    drivers.add("misunderstanding of incentives");
    drivers.add("underweighting base rates");
  } else if (market.category === "POLITICS") {
    drivers.add("partisan bias");
    drivers.add("settlement wording risk");
  } else if (market.category === "WEATHER") {
    drivers.add("bad weather/model assumptions");
  } else if (market.category === "ESPORTS") {
    drivers.add("misunderstanding of game format, rules, or settlement criteria");
  } else if (market.category === "BITCOIN" || market.category === "STOCKS" || market.category === "MACRO") {
    drivers.add("stale information");
    drivers.add("bad interpretation of statistics");
  }

  if (!drivers.size) drivers.add("underweighting base rates");
  return [...drivers].slice(0, 4);
}

function domainSpecificAnalysis(
  market: PredictionMarketQuote,
  edge: number,
  confidence: number,
  spread: number,
  liquidityScore: number,
) {
  const generic = [
    `Order-book spread ${(spread * 100).toFixed(1)}% and liquidity score ${(liquidityScore * 100).toFixed(0)} determine execution drag.`,
    `Model edge ${(edge * 100).toFixed(2)}% with confidence ${(confidence * 100).toFixed(0)}%; size should scale with confidence stability, not conviction language.`,
  ];

  switch (market.category) {
    case "SPORTS":
      return [
        ...generic,
        "Check injuries, rest days, travel load, and lineup confirmations before entry; these inputs dominate late repricing.",
        "Adjust for pace/tempo and coaching substitution tendencies; public money often overweights headline talent over style matchup.",
      ];
    case "POLITICS":
      return [
        ...generic,
        "Poll quality, house effects, turnout composition, and legal/calendar risk can dominate late-cycle odds.",
        "Settlement wording and coalition dynamics matter as much as topline polling; avoid contracts with ambiguous adjudication.",
      ];
    case "ESPORTS":
      return [
        ...generic,
        "Patch/meta, map pool geometry, and draft/ban dynamics drive sharp repricing faster than public narrative.",
        "Roster stability and adaptation speed can outweigh raw mechanical skill in short-format series.",
      ];
    case "WEATHER":
      return [
        ...generic,
        "Use ensemble disagreement and timing uncertainty, not a single deterministic run.",
        "Local station/reporting quirks and settlement timestamp edge cases can invalidate otherwise correct directional weather calls.",
      ];
    case "STOCKS":
      return [
        ...generic,
        "Map catalysts (earnings/guidance/macro prints) to implied move versus realized move history; market may price direction but miss magnitude.",
        "Cross-asset positioning and dealer/gamma effects can create reflexive moves unrelated to fundamental narrative.",
      ];
    case "MACRO":
      return [
        ...generic,
        "Macro event contracts are vulnerable to release-time microstructure gaps and revision risk.",
        "Correlation clusters can produce hidden concentration even when contracts appear unrelated.",
      ];
    case "OTHER":
      return [
        ...generic,
        "Treat non-standard contracts as settlement-first: wording and adjudication path can dominate directional signal.",
        "Use smaller initial size and require liquidity confirmation before scaling.",
      ];
    case "BITCOIN":
    default:
      return [
        ...generic,
        "Spot/ETF flows, funding rates, basis, and options skew provide higher signal than social sentiment during volatile windows.",
        "Reflexivity and liquidation cascades can push short-horizon probabilities away from long-run fair value.",
      ];
  }
}

function buildLiveUpdateFramework(category: PredictionCategory): StrategicBreakdown["liveUpdateFramework"] {
  const shared: StrategicBreakdown["liveUpdateFramework"] = [
    {
      trigger: "Line movement of 5+ probability points within 30 minutes",
      impact: "MEDIUM",
      response: "Recompute posterior; cut size by 25% unless edge widens after spread normalization.",
    },
    {
      trigger: "Order-book liquidity drop >40% or spread expansion >4 points",
      impact: "MAJOR",
      response: "Switch to passive scale-in or defer entry; treat slippage as edge decay.",
    },
  ];

  if (category === "SPORTS") {
    shared.push({
      trigger: "Injury/lineup update inside pregame window",
      impact: "MAJOR",
      response: "Apply immediate probability update and suspend stale pre-news assumptions.",
    });
  } else if (category === "POLITICS") {
    shared.push({
      trigger: "High-quality polling release or legal calendar change",
      impact: "MAJOR",
      response: "Reweight priors toward new turnout/legal state before adding exposure.",
    });
  } else if (category === "WEATHER") {
    shared.push({
      trigger: "Ensemble model shift across two consecutive runs",
      impact: "MEDIUM",
      response: "Reprice scenario tree and avoid anchoring to single-run outputs.",
    });
  } else if (category === "ESPORTS") {
    shared.push({
      trigger: "Patch/map-side announcement or roster substitution",
      impact: "MAJOR",
      response: "Reduce stale-model confidence and update matchup priors before execution.",
    });
  } else if (category === "STOCKS" || category === "MACRO") {
    shared.push({
      trigger: "Economic print, guidance release, or regulatory headline",
      impact: "MAJOR",
      response: "Treat as regime transition; recalc edge and switch to defensive sizing if uncertainty rises.",
    });
  } else {
    shared.push({
      trigger: "Funding/basis dislocation and liquidation spikes",
      impact: "MAJOR",
      response: "Prioritize survival: cap notional and avoid chasing narrative momentum.",
    });
  }

  return shared;
}

function buildStrategicBreakdown(input: {
  market: PredictionMarketQuote;
  side: PredictionSide;
  marketProb: number;
  modelProb: number;
  edge: number;
  confidence: number;
  spread: number;
  liquidityScore: number;
  opportunityType: OpportunityType;
  verdict: CandidateVerdict;
  stakeUsd: number;
  maxDailyRiskUsd: number;
  inferredRegime: { label: string; confidence: number };
}): StrategicBreakdown {
  const {
    market,
    side,
    marketProb,
    modelProb,
    edge,
    confidence,
    spread,
    liquidityScore,
    opportunityType,
    verdict,
    stakeUsd,
    maxDailyRiskUsd,
    inferredRegime,
  } = input;

  const timeHorizonDays = Number(daysUntil(market.closeTime).toFixed(2));
  const baseRate = BASE_RATE_BY_CATEGORY[market.category];
  const prior = clamp(0.4 * baseRate + 0.6 * marketProb, 0.02, 0.98);
  const posterior = clamp(modelProb, 0.02, 0.98);

  const bestCase = clamp(posterior + 0.08, 0.02, 0.98);
  const baseCase = posterior;
  const worstCase = clamp(posterior - 0.11, 0.02, 0.98);

  const confidence1to10 = Number(clamp(confidence * 10, 1, 10).toFixed(1));
  const quality = liquidityExecutionQuality(spread, liquidityScore);
  const efficiency = microEfficiency(spread, liquidityScore);
  const marketEfficiencyLabel =
    efficiency === "EFFICIENT" ? "efficient" : efficiency === "SEMI_EFFICIENT" ? "semi-efficient" : "soft";

  const mispricingDrivers = inferMispricingDrivers(market, spread, liquidityScore);
  const categoryAnalysis = domainSpecificAnalysis(market, edge, confidence, spread, liquidityScore);

  const edgePct = (edge * 100).toFixed(2);
  const sideLabel = side === "YES" ? "YES" : "NO";
  const stanceLabel =
    opportunityType === "TRADE"
      ? "trade candidate"
      : opportunityType === "HEDGE"
        ? "hedge candidate"
        : opportunityType === "WATCHLIST"
          ? "watchlist candidate"
          : "pass candidate";

  const scalingAdvice =
    spread <= 0.04
      ? "Single entry acceptable; scale only if line improves by 2+ points."
      : spread <= 0.08
        ? "Scale in 2-3 tranches to reduce slippage and adverse selection."
        : "Wait for tighter market; if entering, use micro-size and passive limits only.";

  const entryTiming =
    spread <= 0.05
      ? "Entry quality currently acceptable."
      : spread <= 0.1
        ? "Patience improves EV; stagger entries around liquidity pulses."
        : "Entry now is expensive; defer unless edge materially widens.";

  const conservativeStake = Number(Math.max(1, stakeUsd * 0.45).toFixed(2));
  const moderateStake = Number(Math.max(1, stakeUsd).toFixed(2));
  const aggressiveStake = Number(Math.max(1, Math.min(stakeUsd * 1.7, maxDailyRiskUsd * 0.55)).toFixed(2));

  const whyMispriced = `Model estimates ${edgePct}% edge vs market, while ${mispricingDrivers.join(", ")} are likely under-adjusted.`;
  const keyRisks = [
    `${market.category} settlement/wording risk and late information shocks.`,
    "Liquidity vacuum expanding spread and negating paper edge.",
    `Regime flip from ${inferredRegime.label} reducing posterior stability.`,
  ];

  return {
    marketSummary: {
      contract: `${market.ticker}: ${market.title}`,
      marketImpliedProbability: Number((marketProb * 100).toFixed(2)),
      estimatedTrueProbability: Number((posterior * 100).toFixed(2)),
      edge: Number(edgePct),
      confidence1to10,
      timeHorizonDays,
      liquidityExecutionQuality: quality,
      classification: opportunityType,
    },
    thesis: {
      coreReason: `${sideLabel} side selected as ${stanceLabel}: posterior ${Math.round(posterior * 100)}% vs market ${Math.round(marketProb * 100)}%.`,
      mispricingDrivers,
      strongestBullCase: `Base-rate plus regime-adjusted evidence keeps true probability above market even after slippage penalty; market is ${marketEfficiencyLabel} not fully efficient.`,
      strongestBearCase:
        "Edge is fragile to one-step information updates and may be fully consumed by spread widening or settlement technicality.",
    },
    domainSpecificAnalysis: categoryAnalysis,
    probabilityEngine: {
      baseRate: Number(baseRate.toFixed(4)),
      prior: Number(prior.toFixed(4)),
      posterior: Number(posterior.toFixed(4)),
      bestCase: { probability: Number(bestCase.toFixed(4)), weight: 0.25 },
      baseCase: { probability: Number(baseCase.toFixed(4)), weight: 0.5 },
      worstCase: { probability: Number(worstCase.toFixed(4)), weight: 0.25 },
      keyRepricingVariables: REPRICING_VARIABLES_BY_CATEGORY[market.category],
    },
    marketMicrostructure: {
      spread: Number(spread.toFixed(4)),
      liquidityScore: Number(liquidityScore.toFixed(4)),
      efficiency,
      entryTiming,
      scalingAdvice,
      manipulationRisk: manipulationRisk(spread, liquidityScore),
    },
    positioningAndRisk: {
      conservativeStakeUsd: conservativeStake,
      moderateStakeUsd: moderateStake,
      aggressiveStakeUsd: aggressiveStake,
      maxLossUsd: Number(stakeUsd.toFixed(2)),
      invalidation: "Invalidate thesis if model-market gap compresses below 0.30% without supportive catalyst.",
      earlyExit: "Exit or reduce by 50% if adverse move exceeds 7 probability points with no confirming data.",
      hedgeIdea:
        market.category === "BITCOIN"
          ? "Pair with opposite-delta BTC threshold contract at farther strike."
          : market.category === "WEATHER"
            ? "Hedge with adjacent threshold contract to capture timing uncertainty."
            : "Pair with negatively correlated category exposure and cap net directional concentration.",
      correlationWarning: "Treat macro/news-driven contracts as correlated even when surface labels differ.",
    },
    liveUpdateFramework: buildLiveUpdateFramework(market.category),
    deceptionFilter: [
      "What is the crowd missing in settlement mechanics or timing?",
      "What is already priced in via recent line movement?",
      "Which single hidden variable can erase the edge fastest?",
      "Could low-volume prints be spoofing sentiment rather than reflecting information?",
      "Where does false numerical precision mask structural uncertainty?",
    ],
    outputFormat: {
      contract: `${market.ticker}: ${market.title}`,
      marketImpliedProbability: Number((marketProb * 100).toFixed(2)),
      estimatedTrueProbability: Number((posterior * 100).toFixed(2)),
      edge: Number(edgePct),
      confidence: Number((confidence * 100).toFixed(1)),
      whyMispriced,
      catalysts: REPRICING_VARIABLES_BY_CATEGORY[market.category],
      keyRisks,
      bestEntryApproach: entryTiming,
      positionSizingSuggestion: `Conservative $${conservativeStake.toFixed(2)} | Moderate $${moderateStake.toFixed(2)} | Aggressive $${aggressiveStake.toFixed(2)}`,
      hedgeIdea:
        market.category === "BITCOIN"
          ? "Offset with lower-delta BTC NO exposure."
          : "Offset with cross-category contract sharing opposite macro sensitivity.",
      finalVerdict: verdict,
    },
  };
}

function buildPortfolioRanking(candidates: PredictionCandidate[]): PortfolioRanking {
  const withVerdict = candidates.map((candidate) => {
    const verdict = candidate.verdict ?? (candidate.side === "YES" ? "BUY_YES" : "BUY_NO");
    return {
      ...candidate,
      verdict,
      timeToCloseDays: Number((candidate.timeToCloseDays ?? 7).toFixed(2)),
      confidenceAdjustedEdge: candidate.edge * candidate.confidence,
    };
  });

  const tradable = withVerdict.filter((candidate) => candidate.verdict === "BUY_YES" || candidate.verdict === "BUY_NO");

  const toRankedSetup = (candidate: (typeof withVerdict)[number]) => ({
    contract: candidate.title,
    ticker: candidate.ticker,
    category: candidate.category,
    edge: Number(candidate.edge.toFixed(4)),
    confidenceAdjustedEdge: Number(candidate.confidenceAdjustedEdge.toFixed(4)),
    confidence: Number(candidate.confidence.toFixed(4)),
    expectedValuePerDollarRisked: Number(candidate.expectedValuePerDollarRisked.toFixed(4)),
    timeToCloseDays: candidate.timeToCloseDays,
    verdict: candidate.verdict,
  });

  const highestEv = [...tradable]
    .sort((a, b) => (b.compositeScore ?? -1) - (a.compositeScore ?? -1))
    .slice(0, 3)
    .map(toRankedSetup);

  const safest = [...tradable]
    .sort(
      (a, b) =>
        b.confidence * 0.7 +
        b.edge * 0.3 +
        (b.compositeScore ?? 0) * 0.8 +
        (1 / Math.max(0.5, b.timeToCloseDays)) * 0.05 -
        (a.confidence * 0.7 + a.edge * 0.3 + (a.compositeScore ?? 0) * 0.8 + (1 / Math.max(0.5, a.timeToCloseDays)) * 0.05),
    )
    .slice(0, 3)
    .map(toRankedSetup);

  const asymmetricLongshots = [...tradable]
    .filter((candidate) => candidate.limitPriceCents <= 40)
    .sort((a, b) => b.confidenceAdjustedEdge - a.confidenceAdjustedEdge)
    .slice(0, 3)
    .map(toRankedSetup);

  const trapsToAvoid = [...withVerdict]
    .sort((a, b) => a.confidenceAdjustedEdge - b.confidenceAdjustedEdge)
    .slice(0, 3)
    .map((candidate) => {
      const reason =
        (candidate.compositeScore ?? -1) <= 0
          ? "All-in score negative after fees, incentives, execution, and capital-time adjustment."
          : candidate.edge <= 0.006
          ? "Edge too thin after expected slippage."
          : candidate.confidence < 0.52
            ? "Low confidence relative to current threshold regime."
            : "Risk/reward asymmetry weak versus alternatives.";
      return {
        contract: candidate.title,
        ticker: candidate.ticker,
        reason,
      };
    });

  return { highestEv, safest, asymmetricLongshots, trapsToAvoid };
}

function detectGlobalRegime(markets: PredictionMarketQuote[]) {
  if (!markets.length) {
    return {
      label: "LOW_LIQUIDITY_TRAP",
      confidence: 0.35,
    };
  }

  const spreads = markets
    .map((market) => {
      const bid = firstDefined(market.yesBid, market.lastPrice);
      const ask = firstDefined(market.yesAsk, market.lastPrice);
      if (bid === null || ask === null) return null;
      return Math.max(0, ask - bid);
    })
    .filter((value): value is number => value !== null);

  const liquidity = markets.map((market) => Math.log1p(market.volume + market.openInterest));
  const skew = markets
    .map((market) => {
      const p = firstDefined(market.lastPrice, market.yesAsk, market.yesBid);
      return p === null ? null : Math.abs(p - 0.5);
    })
    .filter((value): value is number => value !== null);

  const avgSpread = average(spreads);
  const avgLiquidity = average(liquidity);
  const avgSkew = average(skew);

  if (avgSpread > 0.12) {
    return {
      label: "HIGH_VOL_ADVERSARIAL",
      confidence: clamp(0.52 + avgSpread, 0.52, 0.92),
    };
  }

  if (avgLiquidity < 3.2) {
    return {
      label: "LOW_LIQUIDITY_TRAP",
      confidence: clamp(0.45 + (3.2 - avgLiquidity) * 0.1, 0.45, 0.82),
    };
  }

  if (avgSkew > 0.18) {
    return {
      label: "TREND_FOLLOWER",
      confidence: clamp(0.52 + avgSkew * 0.6, 0.52, 0.9),
    };
  }

  return {
    label: "MEAN_REVERSION",
    confidence: 0.58,
  };
}

async function getBitcoinSpotUsd(): Promise<number | null> {
  const override = Number(process.env.BTC_SPOT_OVERRIDE_USD ?? "");
  if (Number.isFinite(override) && override > 1000) return override;

  async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 3500): Promise<T | null> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      return null;
    } finally {
      clearTimeout(id);
    }
  }

  function validUsd(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    if (value < 5_000 || value > 500_000) return null;
    return value;
  }

  // Priority order: CoinGecko -> Coinbase -> Kraken -> Bitstamp.
  const gecko = await fetchJsonWithTimeout<{ bitcoin?: { usd?: number } }>(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
  );
  const geckoPrice = validUsd(gecko?.bitcoin?.usd);
  if (geckoPrice !== null) return geckoPrice;

  const coinbase = await fetchJsonWithTimeout<{ data?: { amount?: string } }>(
    "https://api.coinbase.com/v2/prices/spot?currency=USD",
  );
  const coinbasePrice = validUsd(Number(coinbase?.data?.amount));
  if (coinbasePrice !== null) return coinbasePrice;

  const kraken = await fetchJsonWithTimeout<{ result?: Record<string, { c?: string[] }> }>(
    "https://api.kraken.com/0/public/Ticker?pair=XBTUSD",
  );
  const krakenEntry = kraken?.result ? Object.values(kraken.result)[0] : undefined;
  const krakenPrice = validUsd(Number(krakenEntry?.c?.[0]));
  if (krakenPrice !== null) return krakenPrice;

  const bitstamp = await fetchJsonWithTimeout<{ last?: string }>("https://www.bitstamp.net/api/v2/ticker/btcusd/");
  const bitstampPrice = validUsd(Number(bitstamp?.last));
  if (bitstampPrice !== null) return bitstampPrice;

  return null;
}

function parseUsdLevel(text: string): number | null {
  const lower = text.toLowerCase();

  const dollarMatch = lower.match(/\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/);
  if (dollarMatch?.[1]) return Number(dollarMatch[1].replace(/,/g, ""));

  const kMatch = lower.match(/(\d+(?:\.\d+)?)\s*k\b/);
  if (kMatch?.[1]) return Number(kMatch[1]) * 1000;

  return null;
}

function inferAboveDirection(text: string): boolean | null {
  const lower = text.toLowerCase();
  if (/(above|over|greater than|exceed|higher than)/.test(lower)) return true;
  if (/(below|under|less than|lower than|at or below)/.test(lower)) return false;
  return null;
}

function daysUntil(closeTime: string | null) {
  if (!closeTime) return 7;
  const target = new Date(closeTime).getTime();
  if (!Number.isFinite(target)) return 7;
  const deltaMs = target - Date.now();
  return clamp(deltaMs / (1000 * 60 * 60 * 24), MIN_HORIZON_DAYS, 30);
}

function estimateBitcoinProbability(
  market: PredictionMarketQuote,
  marketProb: number,
  btcSpot: number | null,
): { probability: number; rationale?: string } {
  if (!btcSpot) return { probability: marketProb };

  const text = `${market.title} ${market.subtitle ?? ""}`;
  const strike = parseUsdLevel(text);
  const direction = inferAboveDirection(text);

  if (!strike || direction === null) {
    return {
      probability: marketProb,
      rationale: "No explicit strike/direction detected; defaulting to market-implied probability.",
    };
  }

  const tYears = daysUntil(market.closeTime) / 365;
  const annualVol = 0.72;
  const sigma = Math.max(0.01, annualVol * Math.sqrt(tYears));
  const z = Math.log(strike / btcSpot) / sigma;
  const pAbove = 1 - normalCdf(z);
  const model = direction ? pAbove : 1 - pAbove;

  return {
    probability: clamp(model, 0.02, 0.98),
    rationale: `Spot BTC $${btcSpot.toFixed(0)} vs strike $${strike.toFixed(0)} with vol-adjusted horizon model.`,
  };
}

function estimatePhysicalMeasureBridge(args: {
  market: PredictionMarketQuote;
  implied: number;
  currentProb: number;
  btcSpot: number | null;
  timeToCloseDays: number;
  inferredRegime: { label: string; confidence: number };
  overlayContext: OverlayContext;
  spread: number;
  liquidityScore: number;
}): { probability: number | null; rationale?: string } {
  const { market, implied, currentProb, btcSpot, timeToCloseDays, inferredRegime, overlayContext, spread, liquidityScore } = args;
  if (market.category !== "BITCOIN" && market.category !== "STOCKS" && market.category !== "MACRO") {
    return { probability: null };
  }

  // Fallback heuristic if no synthetic volatility context exists
  const text = `${market.title} ${market.subtitle ?? ""}`;
  const factor = Math.sign(implied - 0.5) * Math.abs(logit(implied)) * 0.2;

  // Use Black-Scholes digital if synthetic band data is available
  const band = overlayContext.syntheticBandsByTicker.get(market.ticker);
  let qDensity: number | null = null;
  let densityConfidence = 0.5;
  let qRationale = "";
  const direction = inferAboveDirection(text);

  if (band && direction !== null) {
      const rawDigital = average([band.fairMid, (band.fairLower + band.fairUpper) / 2]);
      qDensity = direction ? rawDigital : 1 - rawDigital;
      densityConfidence = 1 - band.mismatchPenalty;
      qRationale = `Q-Density mapped from synthetic IV (CDf=${qDensity.toFixed(3)}, penalty=${band.mismatchPenalty.toFixed(2)}).`;
  } else if (market.category === "BITCOIN" && btcSpot && timeToCloseDays > 0 && direction !== null) {
      const strike = parseUsdLevel(text);
      if (strike) {
          const baseVol = inferredRegime.label === "HIGH_VOL_ADVERSARIAL" ? 0.85 : 0.55;
          const t = timeToCloseDays / 365;
          const d2 = (Math.log(btcSpot / strike) - (0.5 * baseVol * baseVol) * t) / (baseVol * Math.sqrt(t));
          const probAbove = normalCdf(d2);
          qDensity = direction ? probAbove : 1 - probAbove;
          densityConfidence = 0.7; // Theoretical B-S is less confident than real synthetic option quotes
          qRationale = `Theoretical Q-Density via B-S at ${Math.round(baseVol * 100)}% IV against spot $${btcSpot.toFixed(0)}.`;
      }
  }

  if (qDensity !== null) {
      // 1. Convert Q-Density (Risk-Neutral) to P-Measure (Physical/Real-World)
      // We apply a rough drift adjustment. Crypto/Equities exhibit positive drift.
      const driftPremium = (timeToCloseDays / 365) * (market.category === "BITCOIN" ? 0.20 : 0.08);
      const riskNeutralLogit = logit(clamp(qDensity, 0.01, 0.99));
      const pMeasureLogit = riskNeutralLogit + (direction ? driftPremium : -driftPremium);
      const pMeasure = sigmoid(pMeasureLogit);

      // 2. Apply Rulebook Adjustment (Settlement Risk)
      const rulebookEval = estimateRulebookProbability({
          market,
          chosenProb: pMeasure,
          spread,
          liquidityScore
      });

      const finalPhysical = clamp(rulebookEval.prob, 0.02, 0.98);
      const bridged = clamp(currentProb * (1 - densityConfidence) + finalPhysical * densityConfidence, 0.02, 0.98);
      
      return {
          probability: bridged,
          rationale: `${qRationale} Translated to P-Measure and rulebook-adjusted to ${(finalPhysical * 100).toFixed(1)}%.`
      };
  }

  const etaBase = market.category === "BITCOIN" ? 0.42 : market.category === "STOCKS" ? 0.26 : 0.18;
  const horizonScale = clamp(1 / (1 + timeToCloseDays / 5), 0.18, 1);
  const regimeScale = inferredRegime.label === "HIGH_VOL_ADVERSARIAL" ? 0.82 : inferredRegime.label === "LOW_LIQUIDITY_TRAP" ? 0.9 : 1;
  const tilt = clamp(etaBase * horizonScale * regimeScale * factor, -0.45, 0.45);
  const bridged = clamp(sigmoid(logit(currentProb) + tilt), 0.02, 0.98);

  return {
    probability: bridged,
    rationale: `Physical-measure bridge applied via exponential logit tilt ${tilt >= 0 ? "+" : ""}${tilt.toFixed(3)} on finance-linked probability.`,
  };
}

function estimateWeatherEmosEvtProbability(args: {
  implied: number;
  spread: number;
  liquidityScore: number;
}): { probability: number; rationale: string } {
  const { implied, spread, liquidityScore } = args;
  const latent = logit(implied);
  const varianceInflation = 1 + 1.6 * spread + 0.7 * (1 - liquidityScore);
  const emos = clamp(sigmoid(latent / varianceInflation), 0.02, 0.98);
  const tailDistance = Math.max(0, Math.abs(emos - 0.5) - 0.18) * 2.6;
  const xi = 0.12 + 0.14 * (1 - liquidityScore);
  const evt = clamp(0.5 + (emos - 0.5) * (1 + xi * tailDistance), 0.02, 0.98);
  const probability = clamp(0.62 * emos + 0.38 * evt, 0.02, 0.98);

  return {
    probability,
    rationale: `Weather EMOS+EVT splice applied with variance inflation ${varianceInflation.toFixed(2)} and tail-shape ${xi.toFixed(2)}.`,
  };
}

function estimateSwitchingStateSpaceProbability(args: {
  market: PredictionMarketQuote;
  baseProb: number;
  spread: number;
  timeToCloseDays: number;
}): { probability: number | null; rationale?: string } {
  const { market, baseProb, spread, timeToCloseDays } = args;
  if (
    market.category !== "SPORTS" &&
    market.category !== "POLITICS" &&
    market.category !== "ESPORTS" &&
    market.category !== "OTHER" &&
    market.category !== "BITCOIN"
  ) {
    return { probability: null };
  }

  const yesImbalance = (market.yesBidSize - market.yesAskSize) / Math.max(1, market.yesBidSize + market.yesAskSize);
  const noImbalance = (market.noBidSize - market.noAskSize) / Math.max(1, market.noBidSize + market.noAskSize);
  const signedPressure = clamp(yesImbalance - noImbalance, -1, 1);
  const flowMass = Math.log1p(
    market.volume +
      market.openInterest +
      market.yesBidSize +
      market.yesAskSize +
      market.noBidSize +
      market.noAskSize,
  );
  const urgency = clamp(1 / Math.max(0.2, timeToCloseDays * 24), 0.2, 4.5);
  const latentRegime =
    market.category === "POLITICS"
      ? 0.03
      : market.category === "SPORTS" || market.category === "ESPORTS"
        ? 0.018
        : market.category === "BITCOIN"
          ? 0.012
          : 0.01;
  const stateDrift = latentRegime - spread * 0.45;
  const featureTerm =
    signedPressure * 0.26 +
    flowMass * 0.012 +
    urgency * 0.022 -
    Math.max(0, spread - 0.05) * 0.4;
  const lambdaPlus = 0.04 + Math.max(0, signedPressure) * 0.22 * urgency + flowMass * 0.012;
  const lambdaMinus = 0.04 + Math.max(0, -signedPressure) * 0.22 * urgency + flowMass * 0.012;
  const hawkesShift = clamp((lambdaPlus - lambdaMinus) * 0.4, -0.25, 0.25);
  const latentState = logit(baseProb) + stateDrift + featureTerm + hawkesShift;
  const probability = clamp(sigmoid(latentState), 0.02, 0.98);

  return {
    probability,
    rationale: `Switching state-space update applied with signed pressure ${(signedPressure * 100).toFixed(1)}%, urgency ${urgency.toFixed(2)}, and Hawkes-style burst adjustment.`,
  };
}

function estimateCategoryExpertProbability(args: {
  market: PredictionMarketQuote;
  mode: AutomationMode;
  baseProb: number;
  implied: number;
  spread: number;
  timeToCloseDays: number;
  btcSpot: number | null;
}): { probability: number | null; rationale?: string } {
  const { market, mode, baseProb, implied, spread, timeToCloseDays, btcSpot } = args;

  if (market.category === "BITCOIN") {
    if (btcSpot) {
      return estimateBitcoinProbability(market, implied, btcSpot);
    }
    const yesBid = firstDefined(market.yesBid, implied - 0.03) ?? implied - 0.03;
    const noBid = firstDefined(market.noBid, (1 - implied) - 0.03) ?? (1 - implied) - 0.03;
    const syntheticNoFromYes = 1 - yesBid;
    const bidImbalance = clamp((yesBid - syntheticNoFromYes) * 1.2, -0.06, 0.06);
    const noBidImbalance = clamp(((1 - noBid) - implied) * 0.8, -0.04, 0.04);
    const reversionPull = clamp((0.5 - implied) * 0.22, -0.05, 0.05);
    const microHorizonBias = timeToCloseDays <= BITCOIN_MICRO_HORIZON_DAYS ? 0.012 : 0;
    return {
      probability: clamp(baseProb + bidImbalance + noBidImbalance + reversionPull + microHorizonBias, 0.02, 0.98),
      rationale: "BTC spot unavailable: order-book imbalance + short-horizon reversion fallback model applied.",
    };
  }

  if (market.category === "WEATHER") {
    return estimateWeatherEmosEvtProbability({
      implied,
      spread,
      liquidityScore: clamp(Math.log1p(market.volume + market.openInterest) / 8, 0.08, 1),
    });
  }

  if (market.category === "SPORTS") {
    const crowdOverreaction = mode === "AGGRESSIVE" ? 0.07 : mode === "MIXED" ? 0.1 : mode === "AI" ? 0.09 : 0.14;
    return {
      probability: clamp(0.5 + (baseProb - 0.5) * (1 - crowdOverreaction), 0.02, 0.98),
      rationale: "Sports market crowd-favorite bias adjustment applied.",
    };
  }

  if (market.category === "POLITICS") {
    const biasShrink = mode === "AI" ? 0.12 : 0.16;
    return {
      probability: clamp(0.5 + (baseProb - 0.5) * (1 - biasShrink), 0.02, 0.98),
      rationale: "Politics bias-control shrinkage applied (polling and narrative uncertainty).",
    };
  }

  if (market.category === "ESPORTS") {
    const patchUncertainty = mode === "AI" ? 0.11 : 0.15;
    return {
      probability: clamp(0.5 + (baseProb - 0.5) * (1 - patchUncertainty), 0.02, 0.98),
      rationale: "Esports patch/meta volatility adjustment applied.",
    };
  }

  if (market.category === "STOCKS" || market.category === "MACRO") {
    const eventRiskShrink = mode === "AI" ? 0.09 : 0.12;
    return {
      probability: clamp(0.5 + (baseProb - 0.5) * (1 - eventRiskShrink), 0.02, 0.98),
      rationale: "Event-driven repricing risk adjustment applied.",
    };
  }

  return { probability: null };
}

function chooseExpertWeightTransform(args: {
  category: PredictionCategory;
  liquidityScore: number;
  timeToCloseDays: number;
  inferredRegime: { label: string; confidence: number };
  expertCount: number;
}): ProbabilityTransform {
  const { category, liquidityScore, timeToCloseDays, inferredRegime, expertCount } = args;
  if (expertCount <= 2) return "SOFTMAX";
  if (inferredRegime.label === "LOW_LIQUIDITY_TRAP" || liquidityScore < 0.22) return "SPARSEMAX";
  if (
    category === "BITCOIN" ||
    category === "SPORTS" ||
    category === "POLITICS" ||
    category === "ESPORTS" ||
    timeToCloseDays <= 2
  ) {
    return "ENTMAX15";
  }
  return "SOFTMAX";
}

function mixExpertProbabilities(args: {
  experts: ExpertProbability[];
  category: PredictionCategory;
  liquidityScore: number;
  spread: number;
  timeToCloseDays: number;
  inferredRegime: { label: string; confidence: number };
}): ExpertMixtureResult {
  const { experts, category, liquidityScore, spread, timeToCloseDays, inferredRegime } = args;

  // 1. Gating by market family
  const gatedExperts = experts.filter((exp) => {
    if (category === "WEATHER" && exp.expert === "event_flow") return false;
    if (category === "SPORTS" && exp.expert === "physical_bridge") return false;
    return true;
  });

  // 2. Regime-dependent expert weights & Performance Decay (Recency)
  const adjustedExperts = gatedExperts.map((exp) => {
    let multiplier = 1.0;
    
    // Regime Adjustments
    if (inferredRegime.label === "HIGH_VOL_ADVERSARIAL") {
        if (exp.expert === "market_anchor") multiplier *= 0.7; // Trust market less
        if (exp.expert === "physical_bridge") multiplier *= 1.4; // Trust structural more
        if (exp.expert === "event_flow") multiplier *= 1.3;
    } else if (inferredRegime.label === "LOW_LIQUIDITY_TRAP") {
        if (exp.expert === "market_anchor") multiplier *= 0.5;
        if (exp.expert.includes("domain")) multiplier *= 1.2;
    }

    // Performance Decay (Recency weighting proxy)
    if (timeToCloseDays < 3) {
       // Domain heuristics decay near expiry vs. Market Anchor
       if (exp.expert.includes("domain")) multiplier *= Math.max(0.3, timeToCloseDays / 3);
       if (exp.expert === "market_anchor") multiplier *= 1.2;
    } else if (timeToCloseDays > 30) {
       if (exp.expert === "event_flow") multiplier *= 0.4; // Info flow is noise far out
    }

    return {
      ...exp,
      score: exp.score * multiplier
    };
  });

  const transform = chooseExpertWeightTransform({
    category,
    liquidityScore,
    timeToCloseDays,
    inferredRegime,
    expertCount: adjustedExperts.length,
  });

  // 3. Dynamic Temperature Scaling
  const baseTemp = 0.95 + spread * 1.5;
  const liquidityAdj = Math.max(0, 0.4 - liquidityScore) * 0.5;
  const regimeAdj = -0.15 * inferredRegime.confidence; 
  const categoryTempBase = category === "POLITICS" ? 0.1 : category === "BITCOIN" ? -0.05 : 0;
  
  const temperature = clamp(baseTemp + liquidityAdj + regimeAdj + categoryTempBase, 0.65, 1.45);

  const weights = projectStateProbabilities(
    adjustedExperts.map((expert) => expert.score),
    transform,
    temperature,
  );
  const rawLogit = adjustedExperts.reduce((sum, expert, index) => {
    return sum + logit(expert.probability) * (weights[index] ?? 0);
  }, 0);
  const probability = clamp(sigmoid(rawLogit), 0.02, 0.98);

  return {
    probability,
    transform,
    weights: adjustedExperts.map((expert, index) => ({
      expert: expert.expert,
      probability: Number(expert.probability.toFixed(4)),
      weight: Number((weights[index] ?? 0).toFixed(4)),
    })),
    rationale: [
      `${transform} expert mixer (Temp: ${temperature.toFixed(2)}) applied across ${adjustedExperts.length} gated experts.`,
      ...adjustedExperts
        .filter((expert) => expert.rationale)
        .map((expert) => `${expert.expert}: ${expert.rationale}`),
    ],
  };
}

function estimateModelProbability(
  market: PredictionMarketQuote,
  mode: AutomationMode,
  inferredRegime: { label: string; confidence: number },
  btcSpot: number | null,
  overlayContext: OverlayContext,
  relatedMarkets: PredictionMarketQuote[],
  historyByTicker: Map<string, Array<{ recordedAt: string; yesBid: number | null; yesAsk: number | null; lastPrice: number | null }>>,
): ModelProbabilityEstimate {
  const marketProb = firstDefined(
    market.yesAsk,
    market.lastPrice,
    market.yesBid,
    market.noAsk !== null ? 1 - market.noAsk : null,
    market.noBid !== null ? 1 - market.noBid : null,
  );

  const implied = clamp(marketProb ?? 0.5, 0.01, 0.99);
  const bid = firstDefined(market.yesBid, implied - 0.05) ?? implied - 0.05;
  const ask = firstDefined(market.yesAsk, implied + 0.05) ?? implied + 0.05;
  const spread = clamp(Math.max(0.01, ask - bid), 0.01, 0.5);
  const timeToCloseDays = daysUntil(market.closeTime);

  const liquidityScore = clamp(Math.log1p(market.volume + market.openInterest) / 8, 0.08, 1);
  const trust = clamp(liquidityScore * (1 - spread * 1.8), 0.15, 0.9);
  const anchorProb = clamp(0.5 + (implied - 0.5) * trust, 0.02, 0.98);

  const rationale = [
    `Market implied probability ${Math.round(implied * 100)}% with spread ${(spread * 100).toFixed(1)} bps-equivalent.`,
  ];
  const experts: ExpertProbability[] = [
    {
      expert: "market_anchor",
      probability: anchorProb,
      score: clamp(0.55 + liquidityScore * 0.9 - spread * 1.35, -1.5, 1.5),
      rationale: "Liquidity-weighted market anchor in logit space.",
    },
  ];

  const categoryExpert = estimateCategoryExpertProbability({
    market,
    mode,
    baseProb: anchorProb,
    implied,
    spread,
    timeToCloseDays,
    btcSpot,
  });
  if (categoryExpert.probability !== null) {
    experts.push({
      expert: `${market.category.toLowerCase()}_domain`,
      probability: categoryExpert.probability,
      score: clamp(
        0.45 +
          (market.category === "BITCOIN" ? 0.22 : market.category === "WEATHER" ? 0.18 : 0.12) +
          liquidityScore * 0.5 -
          spread * 0.8,
        -1.5,
        1.5,
      ),
      rationale: categoryExpert.rationale,
    });
  }

  const physicalBridge = estimatePhysicalMeasureBridge({
    market,
    implied,
    currentProb: anchorProb,
    btcSpot,
    timeToCloseDays,
    inferredRegime,
    overlayContext,
    spread,
    liquidityScore,
  });
  if (physicalBridge.probability !== null) {
    experts.push({
      expert: "physical_bridge",
      probability: physicalBridge.probability,
      score: clamp(0.5 + liquidityScore * 0.42 + (market.category === "BITCOIN" ? 0.18 : 0.08), -1.5, 1.5),
      rationale: physicalBridge.rationale,
    });
  }

  const infoFlow = estimateSwitchingStateSpaceProbability({
    market,
    baseProb: anchorProb,
    spread,
    timeToCloseDays,
  });
  if (infoFlow.probability !== null) {
    experts.push({
      expert: "event_flow",
      probability: infoFlow.probability,
      score: clamp(
        0.34 + Math.min(0.32, 0.7 / Math.max(0.25, timeToCloseDays * 24)) + inferredRegime.confidence * 0.1,
        -1.5,
        1.5,
      ),
      rationale: infoFlow.rationale,
    });
  }

  const silentClock = estimateSilentClockContribution({
    market,
    baseProbability: anchorProb,
  });
  if (silentClock && silentClock.eligible && silentClock.decayPenalty > 0) {
    experts.push({
      expert: "silent_clock",
      probability: silentClock.adjustedProbability,
      score: clamp(0.24 + silentClock.checkpointProgress * 0.55 - spread * 0.3, -1.5, 1.5),
      rationale: silentClock.rationale,
    });
  }

  const leadLag = estimateLeadLagSignal({
    market,
    relatedMarkets,
    historyByTicker,
    baseProbability: anchorProb,
  });
  if (leadLag && Math.abs(leadLag.signalMagnitude) > 0.012) {
    experts.push({
      expert: "lead_lag",
      probability: leadLag.adjustedProbability,
      score: clamp(0.18 + leadLag.confidence * 0.8 - spread * 0.2, -1.5, 1.5),
      rationale: leadLag.rationale,
    });
  }

  if (inferredRegime.label === "HIGH_VOL_ADVERSARIAL" || inferredRegime.label === "LOW_LIQUIDITY_TRAP") {
    const shrink = inferredRegime.label === "HIGH_VOL_ADVERSARIAL" ? 0.86 : 0.8;
    experts.push({
      expert: "regime_guard",
      probability: clamp(0.5 + (anchorProb - 0.5) * shrink, 0.02, 0.98),
      score: clamp(0.26 + inferredRegime.confidence * 0.35, -1.5, 1.5),
      rationale:
        inferredRegime.label === "HIGH_VOL_ADVERSARIAL"
          ? "Adversarial volatility regime: reduced directional conviction."
          : "Low-liquidity regime: extra confidence haircut.",
    });
  }

  const expertMixture = mixExpertProbabilities({
    experts,
    category: market.category,
    liquidityScore,
    spread,
    timeToCloseDays,
    inferredRegime,
  });
  const expertsWithoutOverlays = experts.filter((expert) => expert.expert !== "silent_clock" && expert.expert !== "lead_lag");
  const overlaylessExpertMixture =
    expertsWithoutOverlays.length && expertsWithoutOverlays.length !== experts.length
      ? mixExpertProbabilities({
          experts: expertsWithoutOverlays,
          category: market.category,
          liquidityScore,
          spread,
          timeToCloseDays,
          inferredRegime,
        })
      : expertMixture;
  const withoutSilentClockMixture =
    experts.some((expert) => expert.expert === "silent_clock")
      ? mixExpertProbabilities({
          experts: experts.filter((expert) => expert.expert !== "silent_clock"),
          category: market.category,
          liquidityScore,
          spread,
          timeToCloseDays,
          inferredRegime,
        })
      : null;
  const withoutLeadLagMixture =
    experts.some((expert) => expert.expert === "lead_lag")
      ? mixExpertProbabilities({
          experts: experts.filter((expert) => expert.expert !== "lead_lag"),
          category: market.category,
          liquidityScore,
          spread,
          timeToCloseDays,
          inferredRegime,
        })
      : null;
  rationale.push(...expertMixture.rationale);
  let rawModelProb = expertMixture.probability;

  const extremity = Math.abs(implied - 0.5);
  if (extremity >= 0.34) {
    const certaintyPreservation =
      mode === "AI" ? 0.22 : mode === "CONSERVATIVE" ? 0.18 : mode === "MIXED" ? 0.2 : 0.24;
    const liquiditySupport = clamp((liquidityScore - 0.28) * 0.22, 0, 0.12);
    const spreadPenalty = clamp((spread - 0.055) * 0.9, 0, 0.1);
    const directionalBoost = clamp((extremity - 0.34) * certaintyPreservation + liquiditySupport - spreadPenalty, 0, 0.18);
    rawModelProb = clamp(rawModelProb + Math.sign(implied - 0.5) * directionalBoost, 0.02, 0.98);
    rationale.push("Extreme-implied-probability preservation applied to keep >90% side probabilities when liquidity supports it.");
  }

  const calibrationMethod: CalibrationMethod = "TEMPERATURE";
  const temperature = TEMPERATURE_BY_CATEGORY[market.category] ?? 1;
  const modelProb = clamp(temperatureScaleProbability(rawModelProb, temperature), 0.02, 0.98);
  rationale.push(`Temperature calibration applied with τ=${temperature.toFixed(2)} for ${market.category.toLowerCase()} markets.`);

  return {
    rawModelProb: clamp(rawModelProb, 0.02, 0.98),
    modelProb,
    overlaylessRawModelProb: clamp(overlaylessExpertMixture.probability, 0.02, 0.98),
    rawModelProbWithoutSilentClock: withoutSilentClockMixture
      ? clamp(withoutSilentClockMixture.probability, 0.02, 0.98)
      : undefined,
    rawModelProbWithoutLeadLag: withoutLeadLagMixture ? clamp(withoutLeadLagMixture.probability, 0.02, 0.98) : undefined,
    marketProb: implied,
    rationale,
    probabilityTransform: expertMixture.transform,
    calibrationMethod,
    expertWeights: expertMixture.weights,
    silentClock:
      silentClock && withoutSilentClockMixture
        ? {
            ...silentClock,
            probabilityDelta: Number((rawModelProb - withoutSilentClockMixture.probability).toFixed(6)),
          }
        : silentClock,
    leadLag:
      leadLag && withoutLeadLagMixture
        ? {
            ...leadLag,
            probabilityDelta: Number((rawModelProb - withoutLeadLagMixture.probability).toFixed(6)),
          }
        : leadLag,
  };
}

function candidateFromMarket(
  market: PredictionMarketQuote,
  mode: AutomationMode,
  rules: ModeRules,
  controls: AutomationControls,
  accountBalance: number,
  inferredRegime: { label: string; confidence: number },
  btcSpot: number | null,
  maxDailyRiskUsd: number,
  mathContext: MarketMathContext,
  overlayContext: OverlayContext,
  executionHealth: ExecutionHealthContext,
  allMarkets: PredictionMarketQuote[],
  historyByTicker: Map<string, Array<{ recordedAt: string; yesBid: number | null; yesAsk: number | null; lastPrice: number | null }>>,
  adaptiveGates: AdaptiveGateContext,
): PredictionCandidate | null {
  const relatedMarkets = allMarkets.filter((candidate) => candidate.ticker !== market.ticker && deriveRiskCluster(candidate) === deriveRiskCluster(market));
  const probabilityEstimate = estimateModelProbability(market, mode, inferredRegime, btcSpot, overlayContext, relatedMarkets, historyByTicker);
  const { modelProb, rationale } = probabilityEstimate;

  const yesPrice = firstDefined(
    market.yesAsk,
    market.noBid !== null ? 1 - market.noBid : null,
    market.lastPrice,
    0.5,
  );
  const noPrice = firstDefined(
    market.noAsk,
    market.yesBid !== null ? 1 - market.yesBid : null,
    yesPrice !== null ? 1 - yesPrice : null,
    market.lastPrice !== null ? 1 - market.lastPrice : null,
    0.5,
  );

  if (yesPrice === null || noPrice === null) return null;

  const yesEdge = modelProb - yesPrice;
  const noModelProb = 1 - modelProb;
  const noEdge = noModelProb - noPrice;

  const chosenSide: PredictionSide = yesEdge >= noEdge ? "YES" : "NO";
  const rawEdge = chosenSide === "YES" ? yesEdge : noEdge;
  const price = chosenSide === "YES" ? yesPrice : noPrice;
  const chosenModelProb = chosenSide === "YES" ? modelProb : noModelProb;
  const chosenRawModelProb = chosenSide === "YES" ? probabilityEstimate.rawModelProb : 1 - probabilityEstimate.rawModelProb;
  const chosenMarketProb = chosenSide === "YES" ? yesPrice : noPrice;
  const strategyTags = inferStructuralStrategyTags(market);
  const riskCluster = deriveRiskCluster(market);
  strategyTags.push("MIXTURE_OF_EXPERTS");
  if (probabilityEstimate.calibrationMethod === "TEMPERATURE") strategyTags.push("TEMPERATURE_CALIBRATED");
  if (probabilityEstimate.silentClock?.eligible && (probabilityEstimate.silentClock.decayPenalty ?? 0) > 0) strategyTags.push("SILENT_CLOCK_DECAY");
  if (probabilityEstimate.leadLag) strategyTags.push("LEAD_LAG_OVERLAY");

  const sideAsk = chosenSide === "YES"
    ? firstDefined(market.yesAsk, yesPrice)
    : firstDefined(market.noAsk, noPrice);
  const sideBid = chosenSide === "YES"
    ? firstDefined(market.yesBid, sideAsk !== null ? sideAsk - 0.03 : null, yesPrice)
    : firstDefined(market.noBid, sideAsk !== null ? sideAsk - 0.03 : null, noPrice);
  const spread = clamp(Math.max(0.01, (sideAsk ?? price) - (sideBid ?? price)), 0.01, 0.5);
  const quotedLevels =
    (market.yesAsk !== null ? 1 : 0) +
    (market.noAsk !== null ? 1 : 0) +
    (market.yesBid !== null ? 1 : 0) +
    (market.noBid !== null ? 1 : 0);
  const quotePresence = quotedLevels / 4;
  const twoSidedBook = market.yesAsk !== null && market.noAsk !== null && market.yesBid !== null && market.noBid !== null;
  const bookTightnessBoost = clamp((0.22 - spread) / 0.22, 0, 1) * 0.12;
  const quoteLiquidityBoost = quotePresence * 0.16 + (twoSidedBook ? 0.06 : 0) + bookTightnessBoost;
  const liquidityScore = clamp(Math.log1p(market.volume + market.openInterest) / 8 + quoteLiquidityBoost, 0.08, 1);
  const timeToCloseDays = Number(daysUntil(market.closeTime).toFixed(2));
  const isBtcMicro = market.category === "BITCOIN" && timeToCloseDays <= BITCOIN_MICRO_HORIZON_DAYS;
  const coherenceAdjustment = applyCoherenceAdjustment(market, chosenSide, mathContext);
  const syntheticBand = overlayContext.syntheticBandsByTicker.get(market.ticker) ?? null;
  const overlayFairSideMid = syntheticBand
    ? (chosenSide === "YES" ? syntheticBand.fairMid : 1 - syntheticBand.fairMid)
    : null;
  if (coherenceAdjustment.yesFairProb !== null) {
    strategyTags.push("CONSTRAINED_LATTICE");
    const structuralTransform = mathContext.structuralTransformByTicker.get(market.ticker);
    if (structuralTransform === "SOFTMAX") strategyTags.push("SOFTMAX_STRUCTURAL");
    if (structuralTransform === "SPARSEMAX") strategyTags.push("SPARSEMAX_STRUCTURAL");
    if (structuralTransform === "ENTMAX15") strategyTags.push("ENTMAX_STRUCTURAL");
    if (mathContext.strikeFairByTicker.has(market.ticker)) strategyTags.push("STRIKE_LADDER_COHERENCE");
    if (mathContext.calendarFairByTicker.has(market.ticker)) strategyTags.push("CALENDAR_TERM_STRUCTURE");
    if (mathContext.comboFairByTicker.has(market.ticker)) {
      strategyTags.push("CORRELATION_DISPERSION");
      strategyTags.push("COMBO_COPULA");
    }
  }
  if (syntheticBand) {
    strategyTags.push("SYNTHETIC_HEDGE_RV");
  }
  const highProbThresholds = resolveHighProbThresholds({
    category: market.category,
    timeToCloseDays,
    rules,
  });
  const executionMetrics = calculateLiquidationCVaR({
    market,
    spread,
    liquidityScore,
    timeToCloseDays,
    isBtcMicro,
  });
  const executionPenalty = executionMetrics.expectedImpact;
  const rulebookEstimate = estimateRulebookProbability({
    market,
    chosenProb: clamp(
      chosenModelProb +
        coherenceAdjustment.coherenceEdge * 0.35 +
        (overlayFairSideMid !== null ? (overlayFairSideMid - chosenMarketProb) * 0.28 : 0),
      0.02,
      0.98,
    ),
    spread,
    liquidityScore,
  });
  const probabilityEdge = rulebookEstimate.prob - chosenMarketProb;
  const robustMargin = executionPenalty + spread * 0.12;
  const robustRulebookPass = rulebookEstimate.lower > chosenMarketProb + robustMargin;
  const edge = probabilityEdge - executionPenalty;
  const uncertaintyWidth = clamp(rulebookEstimate.upper - rulebookEstimate.lower, 0, 0.45);
  const confidence = clamp(
    0.18 +
      Math.max(0, edge) * 7 +
      liquidityScore * 0.42 -
      spread * 0.45 -
      rulebookEstimate.uncertainty * 1.2 +
      Math.max(0, coherenceAdjustment.coherenceEdge) * 1.8,
    0.1,
    0.95,
  );
  const favoriteLongshotBias = evaluateFavoriteLongshotBias({
    side: chosenSide,
    marketProb: chosenMarketProb,
    modelProb: rulebookEstimate.prob,
    edge,
  });
  const favoriteLongshotActive = controls.favoriteLongshotEnabled ? favoriteLongshotBias : {
    active: false,
    supportsTrade: false,
    autoExecute: false,
    shouldFadeCheapYes: false,
    probabilityGap: 0,
  };
  if (favoriteLongshotActive.supportsTrade) {
    strategyTags.push("FAVORITE_LONGSHOT_BIAS");
  }

  const globalHighProbability = meetsGlobalHighProbabilityDefinition({
    category: market.category,
    timeToCloseDays,
    rules,
    modelProb: rulebookEstimate.prob,
    marketProb: chosenMarketProb,
    edge,
    confidence,
  });

  const maxSpreadAllowed = isBtcMicro ? Math.min(0.19, rules.maxSpread + 0.035) : rules.maxSpread;
  const minLiquidityRequired = isBtcMicro ? Math.max(0.12, rules.minLiquidityScore * 0.75) : rules.minLiquidityScore;
  const minEdgeRequired = isBtcMicro ? Math.max(0.0045, rules.minEdge * 0.65) : rules.minEdge;
  const confidenceRequired = isBtcMicro ? Math.max(0.4, rules.confidenceFloor - 0.06) : rules.confidenceFloor;

  const secondaryMinEdge = isBtcMicro
    ? Math.max(0.0035, (rules.secondaryMinEdge ?? (minEdgeRequired * 0.85)) * 0.85)
    : (rules.secondaryMinEdge ?? minEdgeRequired * 0.85);
  const secondaryConfidenceFloor = isBtcMicro
    ? Math.max(0.4, (rules.secondaryConfidenceFloor ?? (confidenceRequired + 0.01)) - 0.05)
    : (rules.secondaryConfidenceFloor ?? confidenceRequired + 0.01);
  const secondaryMaxSpread = isBtcMicro
    ? Math.min(0.14, (rules.secondaryMaxSpread ?? maxSpreadAllowed) * 1.22)
    : (rules.secondaryMaxSpread ?? maxSpreadAllowed);
  const secondaryMinLiquidityScore = isBtcMicro
    ? Math.max(0.18, (rules.secondaryMinLiquidityScore ?? minLiquidityRequired) * 0.8)
    : (rules.secondaryMinLiquidityScore ?? minLiquidityRequired);

  const highProbLowEvPass =
    controls.highProbabilityEnabled &&
    rulebookEstimate.prob >= highProbThresholds.modelMin &&
    chosenMarketProb >= highProbThresholds.marketMin &&
    edge >= highProbThresholds.edgeMin &&
    edge <= rules.highProbMaxEdge &&
    confidence >= highProbThresholds.confidenceMin;
  const highProbabilityQualified =
    !controls.highProbabilityEnabled ||
    globalHighProbability.qualified ||
    favoriteLongshotActive.autoExecute;

  if (price <= 0.01 || price >= 0.99) return null;
  if (spread > maxSpreadAllowed || liquidityScore < minLiquidityRequired) return null;
  if (favoriteLongshotActive.shouldFadeCheapYes && coherenceAdjustment.coherenceEdge <= 0.01 && !robustRulebookPass) return null;
  if (!highProbabilityQualified) return null;

  let isSecondaryEntry = false;
  let usedHighProbabilityLane = false;
  let usedFavoriteLongshotBias = false;
  let usedRulebookArbitrage = false;
  let usedSyntheticOverlay = false;
  const primaryPass = highProbabilityQualified && edge >= minEdgeRequired && confidence >= confidenceRequired;
  if (!primaryPass) {
    const secondaryPass =
      edge >= secondaryMinEdge &&
      confidence >= secondaryConfidenceFloor &&
      spread <= secondaryMaxSpread &&
      liquidityScore >= secondaryMinLiquidityScore;

    if (!secondaryPass && !highProbLowEvPass && !favoriteLongshotActive.autoExecute) return null;
    isSecondaryEntry = secondaryPass;
    usedHighProbabilityLane = !secondaryPass && highProbLowEvPass;
    usedFavoriteLongshotBias = !secondaryPass && !highProbLowEvPass && favoriteLongshotActive.autoExecute;
    usedRulebookArbitrage = false;
    usedSyntheticOverlay = false;
  }

  const riskBudget = accountBalance * rules.perTradeRiskPct;
  const confidenceFactor = 0.75 + confidence * 0.7;
  const edgeFactor = 1 + clamp(edge * 22, 0, 0.85);
  const minStakeFloor = Math.max(price, Math.min(maxDailyRiskUsd * 0.12, price * (isBtcMicro ? 3 : 2)));
  const baseStake = Math.max(minStakeFloor, riskBudget * confidenceFactor * edgeFactor);
  const highProbLaneStakeCap = Math.max(price, maxDailyRiskUsd * 0.35);
  const highProbabilityLaneStake = Math.max(
    1,
    Math.min(
      Math.max(price, accountBalance * rules.perTradeRiskPct * 0.42),
      highProbLaneStakeCap,
    ),
  );
  const plannedStake = usedHighProbabilityLane
    ? highProbabilityLaneStake
    : isSecondaryEntry
      ? Math.max(price, baseStake * rules.secondaryStakeScale)
      : baseStake;
  const contractStep = marketContractStep(market);
  const executionAlpha = estimateExecutionAlpha({
    market,
    side: chosenSide,
    marketProb: chosenMarketProb,
    rulebookProb: rulebookEstimate.prob,
    rulebookProbLower: rulebookEstimate.lower,
    rulebookProbUpper: rulebookEstimate.upper,
    timeToCloseDays,
    recentMarkoutPenalty: executionHealth.markoutPenalty,
  });
  const executionPrice = snapProbabilityToMarket(
    executionAlpha.passivePrice,
    market,
    executionAlpha.assumedRole === "TAKER" ? "up" : "down",
  );
  if (!isFiniteNumber(executionPrice) || executionPrice <= 0 || executionPrice >= 1) return null;
  const contracts = snapContractCount(plannedStake / executionPrice, contractStep, "down");
  if (contracts < contractStep) return null;
  if (!isFiniteNumber(edge) || !isFiniteNumber(confidence)) return null;
  if (
    rulebookEstimate.lower <= executionPrice &&
    rulebookEstimate.upper >= executionPrice &&
    uncertaintyWidth >= adaptiveGates.uncertaintyThreshold
  ) {
    return null;
  }
  if (executionAlpha.toxicityScore >= TOXICITY_PASSIVE_SHUTOFF && !robustRulebookPass && !favoriteLongshotActive.autoExecute) return null;
  const feeEstimate = estimateFeeUsd({
    market,
    contracts,
    executionAlpha,
  });
  const incentiveEstimate = estimateIncentiveUsd({
    market,
    contracts,
    executionAlpha,
  });
  const capitalTimeDays = estimateCapitalTimeDays(market) + rulebookEstimate.settlementLagDays;
  const capitalLocked = contracts * executionPrice;
  const temperature = TEMPERATURE_BY_CATEGORY[market.category] ?? 1;
  const overlaylessModelProb =
    probabilityEstimate.overlaylessRawModelProb !== undefined
      ? clamp(temperatureScaleProbability(probabilityEstimate.overlaylessRawModelProb, temperature), 0.02, 0.98)
      : modelProb;
  const silentClockModelProbWithout =
    probabilityEstimate.rawModelProbWithoutSilentClock !== undefined
      ? clamp(temperatureScaleProbability(probabilityEstimate.rawModelProbWithoutSilentClock, temperature), 0.02, 0.98)
      : undefined;
  const leadLagModelProbWithout =
    probabilityEstimate.rawModelProbWithoutLeadLag !== undefined
      ? clamp(temperatureScaleProbability(probabilityEstimate.rawModelProbWithoutLeadLag, temperature), 0.02, 0.98)
      : undefined;
  const selectedSilentContribution =
    silentClockModelProbWithout !== undefined
      ? Number(
          (
            (chosenSide === "YES" ? modelProb - silentClockModelProbWithout : silentClockModelProbWithout - modelProb)
          ).toFixed(6),
        )
      : undefined;
  const selectedLeadLagContribution =
    leadLagModelProbWithout !== undefined
      ? Number(
          (
            (chosenSide === "YES" ? modelProb - leadLagModelProbWithout : leadLagModelProbWithout - modelProb)
          ).toFixed(6),
        )
      : undefined;
  const overlayScoreDenominator = Math.max(0.01, executionPrice * capitalTimeDays);
  const silentClockContribution =
    probabilityEstimate.silentClock && selectedSilentContribution !== undefined
      ? {
          ...probabilityEstimate.silentClock,
          probabilityDelta: selectedSilentContribution,
          scoreContribution: Number((selectedSilentContribution / overlayScoreDenominator).toFixed(6)),
        }
      : probabilityEstimate.silentClock;
  const leadLagContribution =
    probabilityEstimate.leadLag && selectedLeadLagContribution !== undefined
      ? {
          ...probabilityEstimate.leadLag,
          probabilityDelta: selectedLeadLagContribution,
          scoreContribution: Number((selectedLeadLagContribution / overlayScoreDenominator).toFixed(6)),
        }
      : probabilityEstimate.leadLag;
  const chosenFairProb =
    coherenceAdjustment.yesFairProb === null
      ? null
      : chosenSide === "YES"
        ? coherenceAdjustment.yesFairProb
        : 1 - coherenceAdjustment.yesFairProb;
  const structuralEdges = [
    chosenFairProb === null ? null : chosenFairProb - executionPrice,
    overlayFairSideMid === null ? null : overlayFairSideMid - executionPrice - (syntheticBand?.mismatchPenalty ?? 0),
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const coherencePerContract = structuralEdges.length ? average(structuralEdges) : 0;
  const coherenceUsd = contracts * coherencePerContract;
  const executionAlphaUsd = contracts * executionAlpha.valuePerContract;
  const probabilityAlphaUsd = contracts * (rulebookEstimate.prob - executionPrice);
  const robustAlphaUsd = contracts * (rulebookEstimate.lower - executionPrice);
  const executionAdjustedEdge = edge + executionAlpha.valuePerContract - uncertaintyWidth * 0.08 - executionHealth.scorePenalty;
  const netAlphaUsd =
    probabilityAlphaUsd -
    feeEstimate.totalUsd +
    incentiveEstimate.totalUsd +
    coherenceUsd +
    executionAlphaUsd;
  const evAllIn = netAlphaUsd;
  const compositeScore =
    capitalLocked > 0 && capitalTimeDays > 0
      ? ((robustAlphaUsd - feeEstimate.totalUsd + coherenceUsd + executionAlphaUsd + incentiveEstimate.totalUsd) / (capitalLocked * capitalTimeDays)) -
        executionHealth.scorePenalty * 0.08 -
        executionAlpha.toxicityScore * 0.02
      : -1;

  if (isBtcMicro) {
    rationale.push("BTC micro-horizon pathway active (targeting <=60m contracts, favoring 15m windows).");
  }
  rationale.push(
    `Rulebook probability ${(rulebookEstimate.prob * 100).toFixed(2)}% with interval [${(rulebookEstimate.lower * 100).toFixed(2)}%, ${(rulebookEstimate.upper * 100).toFixed(2)}%]. Raw edge ${(rawEdge * 100).toFixed(2)}% -> net edge ${(edge * 100).toFixed(2)}%.`,
  );
  rationale.push(
    `Selected-side probability test: model ${(rulebookEstimate.prob * 100).toFixed(2)}% vs implied ${(chosenMarketProb * 100).toFixed(2)}% -> probability edge ${(probabilityEdge * 100).toFixed(2)}%. High-probability floor ${(
      globalHighProbability.thresholds.modelMin * 100
    ).toFixed(0)}% model / ${(globalHighProbability.thresholds.marketMin * 100).toFixed(0)}% implied.`,
  );
  rationale.push(
    `Execution-adjusted edge ${(executionAdjustedEdge * 100).toFixed(2)}% after toxicity ${(executionAlpha.toxicityScore * 100).toFixed(1)}%, uncertainty width ${(uncertaintyWidth * 100).toFixed(2)}%, and recent markout penalty ${(executionHealth.markoutPenalty * 100).toFixed(2)}%.`,
  );
  rationale.push(
    `Model pipeline: ${probabilityEstimate.probabilityTransform} mixture with ${probabilityEstimate.calibrationMethod.toLowerCase().replace("_", " ")} calibration. Raw ${(chosenRawModelProb * 100).toFixed(2)}% -> calibrated ${(chosenModelProb * 100).toFixed(2)}%.`,
  );
  if (probabilityEstimate.overlaylessRawModelProb !== undefined) {
    const selectedOverlaylessProb = chosenSide === "YES" ? overlaylessModelProb : 1 - overlaylessModelProb;
    rationale.push(
      `Overlay-free selected-side baseline ${(selectedOverlaylessProb * 100).toFixed(2)}%; overlays moved the selected side by ${((chosenModelProb - selectedOverlaylessProb) * 100).toFixed(2)} pts.`,
    );
  }
  if (silentClockContribution?.probabilityDelta) {
    rationale.push(
      `Silent-clock overlay contribution ${(silentClockContribution.probabilityDelta * 100).toFixed(2)} pts to selected-side probability and ${(silentClockContribution.scoreContribution ?? 0).toFixed(5)} to capital-time score.`,
    );
  }
  if (leadLagContribution?.probabilityDelta) {
    rationale.push(
      `Lead-lag overlay contribution ${(leadLagContribution.probabilityDelta * 100).toFixed(2)} pts to selected-side probability and ${(leadLagContribution.scoreContribution ?? 0).toFixed(5)} to capital-time score.`,
    );
  }
  rationale.push(
    `Net alpha $${netAlphaUsd.toFixed(4)} = n(q-p) $${probabilityAlphaUsd.toFixed(4)} - fees $${feeEstimate.totalUsd.toFixed(4)} + incentives $${incentiveEstimate.totalUsd.toFixed(4)} + coherence $${coherenceUsd.toFixed(4)} + execution alpha $${executionAlphaUsd.toFixed(4)}.`,
  );
  rationale.push(
    `Robust score ${(compositeScore).toFixed(5)} per capital-day using q_robust, capital locked $${capitalLocked.toFixed(2)} over ${capitalTimeDays.toFixed(4)} days.`,
  );
  rationale.push(
    `Execution plan uses ${executionAlpha.assumedRole} routing at ${(executionPrice * 100).toFixed(1)}c with patience ${executionAlpha.patienceHours.toFixed(2)}h and fee schedule ${feeEstimate.schedule}.`,
  );
  rationale.push(...rulebookEstimate.notes);
  rationale.push(...coherenceAdjustment.notes);
  if (syntheticBand) rationale.push(...syntheticBand.notes);
  rationale.push(...executionAlpha.notes);
  rationale.push(...incentiveEstimate.notes);

  if (favoriteLongshotActive.supportsTrade) {
    rationale.push(
      `Favorite-longshot bias scan: ${Math.round(rulebookEstimate.prob * 100)}% rulebook-adjusted model vs ${Math.round(chosenMarketProb * 100)}% implied on the selected side.`,
    );
    if (favoriteLongshotActive.autoExecute) {
      rationale.push(
        `Favorite-longshot bias execution override: model exceeds implied by ${(favoriteLongshotActive.probabilityGap * 100).toFixed(2)} percentage points (>=10 required).`,
      );
    }
  }
  if (favoriteLongshotActive.shouldFadeCheapYes) {
    rationale.push("Favorite-longshot bias warning: cheap YES longshot detected; this path is structurally disfavored unless another strategy dominates.");
  }

  if (usedHighProbabilityLane) {
    rationale.push(
      `High-probability lane active: ${(chosenModelProb * 100).toFixed(1)}% model probability with intentionally low edge (${(edge * 100).toFixed(2)}%).`,
    );
    if (isBtcMicro) {
      rationale.push(
        `BTC micro high-prob floor active: executing at >=${(highProbThresholds.modelMin * 100).toFixed(0)}% model probability (reduced from global ${(
          rules.highProbMinModelProb * 100
        ).toFixed(0)}%).`,
      );
    }
  }

  rationale.push(
    usedRulebookArbitrage
      ? "Rulebook/settlement arbitrage entry: robust probability interval stays on one side of market price after fees and slippage."
      : usedSyntheticOverlay
      ? "Synthetic hedge / relative-value overlay entry: executable option-spread band still clears price after mismatch and friction penalties."
      : usedFavoriteLongshotBias
      ? "Favorite-longshot bias entry: high-priced favorite selected because model-implied gap cleared the 10-point execution threshold."
      : usedHighProbabilityLane
      ? "Primary/secondary edge thresholds not met; allowed under high-probability low-EV policy."
      : isSecondaryEntry
      ? "Secondary entry: reduced stake because edge/confidence passed fallback gates only."
      : "Primary entry: edge and confidence both passed primary thresholds.",
  );

  const expectedValuePerContract = evAllIn / contracts;
  const expectedValuePerDollarRisked = capitalLocked > 0 ? evAllIn / capitalLocked : -1;

  const derivedOpportunityType = classifyOpportunityType(
    edge,
    confidence,
    spread,
    liquidityScore,
    isSecondaryEntry,
    usedHighProbabilityLane,
    rules,
  );
  const opportunityType: OpportunityType =
    (usedFavoriteLongshotBias || usedRulebookArbitrage || usedSyntheticOverlay) && derivedOpportunityType !== "PASS" ? "TRADE" : derivedOpportunityType;
  const watchlistExecutionEligible =
    opportunityType === "WATCHLIST" &&
    edge > 0 &&
    compositeScore > SCORE_THRESHOLD_BY_MODE[mode] &&
    confidence >= Math.max(0.34, rules.highProbMinConfidence - 0.06) &&
    (
      isSecondaryEntry ||
      usedHighProbabilityLane ||
      usedRulebookArbitrage ||
      usedSyntheticOverlay ||
      (primaryPass && spread <= maxSpreadAllowed && liquidityScore >= minLiquidityRequired)
    );

  const verdict: CandidateVerdict = watchlistExecutionEligible
    ? (chosenSide === "YES" ? "BUY_YES" : "BUY_NO")
    : verdictFromOpportunity(opportunityType, chosenSide);

  if (watchlistExecutionEligible) {
    rationale.push("Watchlist promoted to execution: positive-EV candidate passed adaptive execution promotion rules.");
  }
  const strategicBreakdown =
    mode === "AI"
      ? buildStrategicBreakdown({
          market,
          side: chosenSide,
          marketProb: chosenMarketProb,
          modelProb: rulebookEstimate.prob,
          edge,
          confidence,
          spread,
          liquidityScore,
          opportunityType,
          verdict,
          stakeUsd: contracts * executionPrice,
          maxDailyRiskUsd,
          inferredRegime,
        })
      : undefined;

  const gateDiagnostics: CandidateGateDiagnostic[] = [
    {
      gate: "CONFIDENCE_FLOOR",
      passed: confidence >= confidenceRequired,
      observed: Number(confidence.toFixed(6)),
      threshold: Number(confidenceRequired.toFixed(6)),
      missBy: Number(Math.max(0, confidenceRequired - confidence).toFixed(6)),
      unit: "probability",
      detail: isBtcMicro ? "BTC micro confidence floor" : "Primary confidence floor",
    },
    {
      gate: "EXECUTION_EDGE",
      passed: executionAdjustedEdge > 0,
      observed: Number(executionAdjustedEdge.toFixed(6)),
      threshold: 0,
      missBy: Number(Math.max(0, -executionAdjustedEdge).toFixed(6)),
      unit: "probability",
      detail: "Execution-adjusted edge must remain positive after toxicity and uncertainty penalties.",
    },
    {
      gate: "TOXICITY",
      passed: executionAlpha.toxicityScore < adaptiveGates.toxicityThreshold,
      observed: Number(executionAlpha.toxicityScore.toFixed(6)),
      threshold: Number(adaptiveGates.toxicityThreshold.toFixed(6)),
      missBy: Number(Math.max(0, executionAlpha.toxicityScore - adaptiveGates.toxicityThreshold).toFixed(6)),
      unit: "probability",
      detail: `Actionable queue requires toxicity below ${(adaptiveGates.toxicityThreshold * 100).toFixed(1)}%.`,
    },
    {
      gate: "UNCERTAINTY_WIDTH",
      passed: !(
        rulebookEstimate.lower <= executionPrice &&
        rulebookEstimate.upper >= executionPrice &&
        uncertaintyWidth >= adaptiveGates.uncertaintyThreshold
      ),
      observed: Number(uncertaintyWidth.toFixed(6)),
      threshold: Number(adaptiveGates.uncertaintyThreshold.toFixed(6)),
      missBy: Number(
        (
          rulebookEstimate.lower <= executionPrice && rulebookEstimate.upper >= executionPrice
            ? Math.max(0, uncertaintyWidth - adaptiveGates.uncertaintyThreshold)
            : 0
        ).toFixed(6),
      ),
      unit: "probability",
      detail:
        rulebookEstimate.lower <= executionPrice && rulebookEstimate.upper >= executionPrice
          ? "Robust fair-value interval straddles execution price."
          : "Rulebook interval does not straddle execution price.",
    },
    {
      gate: "BOOTSTRAP_HEALTH",
      passed: executionHealth.regime === "NORMAL",
      observed:
        executionHealth.regime === "DEFENSIVE" ? 2 : executionHealth.regime === "TIGHTENED" ? 1 : 0,
      threshold: 0,
      missBy:
        executionHealth.regime === "DEFENSIVE" ? 2 : executionHealth.regime === "TIGHTENED" ? 1 : 0,
      unit: "severity",
      detail: `Execution-health regime ${executionHealth.regime}.`,
    },
  ];

  return {
    ticker: market.ticker,
    title: market.title,
    category: market.category,
    side: chosenSide,
    marketProb: Number(chosenMarketProb.toFixed(4)),
    rawModelProb: Number(chosenRawModelProb.toFixed(4)),
    modelProb: Number(rulebookEstimate.prob.toFixed(4)),
    edge: Number(edge.toFixed(4)),
    executionAdjustedEdge: Number(executionAdjustedEdge.toFixed(4)),
    expectedValuePerContract: Number(expectedValuePerContract.toFixed(4)),
    expectedValuePerDollarRisked: Number(expectedValuePerDollarRisked.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
    recommendedStakeUsd: Number((contracts * executionPrice).toFixed(4)),
    recommendedContracts: contracts,
    contractStep,
    limitPriceCents: probabilityToCents(executionPrice),
    rulebookProb: Number(rulebookEstimate.prob.toFixed(4)),
    rulebookProbLower: Number(rulebookEstimate.lower.toFixed(4)),
    rulebookProbUpper: Number(rulebookEstimate.upper.toFixed(4)),
    coherentFairProb: chosenFairProb !== null ? Number(chosenFairProb.toFixed(4)) : undefined,
    feeEstimateUsd: Number(feeEstimate.totalUsd.toFixed(4)),
    incentiveRewardUsd: Number(incentiveEstimate.totalUsd.toFixed(4)),
    coherenceEdge: Number(coherencePerContract.toFixed(4)),
    executionAlphaUsd: Number(executionAlphaUsd.toFixed(4)),
    netAlphaUsd: Number(netAlphaUsd.toFixed(4)),
    capitalTimeDays: Number(capitalTimeDays.toFixed(6)),
    compositeScore: Number(compositeScore.toFixed(6)),
    portfolioWeight: 0,
    liquidationCVaR: Number(executionMetrics.liquidationCVaR.toFixed(6)),
    uncertaintyWidth: Number(uncertaintyWidth.toFixed(6)),
    toxicityScore: Number(executionAlpha.toxicityScore.toFixed(6)),
    riskCluster,
    silentClock: silentClockContribution ?? undefined,
    leadLag: leadLagContribution ?? undefined,
    executionPlan: {
      limitPriceCents: probabilityToCents(executionPrice),
      patienceHours: Number(executionAlpha.patienceHours.toFixed(2)),
      fillProbability: Number(executionAlpha.fillProb.toFixed(4)),
      expectedExecutionValueUsd: Number((executionAlpha.valuePerContract * contracts).toFixed(4)),
      feeUsd: Number(feeEstimate.totalUsd.toFixed(4)),
      role: executionAlpha.assumedRole,
      quoteWidening: Number(executionAlpha.quoteWidening.toFixed(6)),
      staleHazard: Number(executionAlpha.staleHazard.toFixed(6)),
      inventorySkew: Number(executionAlpha.inventorySkew.toFixed(6)),
    },
    gateDiagnostics,
    rationale,
    probabilityTransform: probabilityEstimate.probabilityTransform,
    calibrationMethod: probabilityEstimate.calibrationMethod,
    expertWeights: probabilityEstimate.expertWeights.map((row) => ({
      expert: row.expert,
      weight: row.weight,
      probability: Number((chosenSide === "YES" ? row.probability : 1 - row.probability).toFixed(4)),
    })),
    strategyTags: [...new Set(strategyTags)],
    opportunityType,
    verdict,
    timeToCloseDays,
    strategicBreakdown,
    simulated: true,
    executionHealthRegime: executionHealth.regime,
    executionHealthPenalty: Number(executionHealth.markoutPenalty.toFixed(6)),
    executionStatus: "SKIPPED",
    executionMessage: usedRulebookArbitrage
      ? "Rulebook arbitrage candidate: robust interval cleared price after cost margin."
      : usedSyntheticOverlay
      ? "Synthetic hedge / relative-value candidate: options band supports executable overlay after mismatch penalty."
      : usedFavoriteLongshotBias
      ? "Favorite-longshot bias execution candidate: model-implied gap cleared the 10-point trigger."
      : usedHighProbabilityLane
      ? watchlistExecutionEligible
        ? "High-probability lane promoted from watchlist to live-eligible execution."
        : "High-probability lane entry: low-edge, high-likelihood setup with constrained stake sizing."
      : isSecondaryEntry
      ? watchlistExecutionEligible
        ? "Secondary entry promoted from watchlist: positive-EV near-threshold setup."
        : "Secondary entry (micro-size): near-threshold edge with tight spread/liquidity requirements."
      : watchlistExecutionEligible
      ? "Primary candidate promoted from watchlist: positive-EV profile with acceptable confidence/liquidity."
      : "Primary entry: full threshold pass.",
  };
}

function selectDiversifiedCandidates(
  all: PredictionCandidate[],
  categories: PredictionCategory[],
  rules: ModeRules,
): PredictionCandidate[] {
  const selected: PredictionCandidate[] = [];
  const softTarget = Math.max(rules.maxMarkets, Math.min(all.length, Math.ceil(Math.sqrt(Math.max(1, all.length)) * 2.2)));
  const targetHighProbCount = clamp(
    Math.round(softTarget * rules.highProbTargetShare),
    1,
    Math.max(1, softTarget),
  );

  const sorted = [...all].sort((a, b) => {
    const aActionable = isBuyVerdict(a.verdict) ? 1 : 0;
    const bActionable = isBuyVerdict(b.verdict) ? 1 : 0;
    if (aActionable !== bActionable) return bActionable - aActionable;
    return candidateUtilityScore(b, rules) - candidateUtilityScore(a, rules);
  });
  const highProbSorted = [...all]
    .filter((candidate) => isHighProbabilityLowEvCandidate(candidate, rules))
    .filter((candidate) => isBuyVerdict(candidate.verdict))
    .sort((a, b) => highProbabilityPreferenceScore(b, rules) - highProbabilityPreferenceScore(a, rules));

  const seen = new Set<string>();
  function addCandidate(candidate: PredictionCandidate) {
    const key = candidateKey(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    selected.push(candidate);
  }

  for (const candidate of highProbSorted) {
    if (selected.filter((row) => isHighProbabilityLowEvCandidate(row, rules)).length >= targetHighProbCount) break;
    addCandidate(candidate);
  }

  for (const category of categories) {
    if (selected.some((candidate) => candidate.category === category)) continue;
    const topForCategory = sorted.find((candidate) => candidate.category === category);
    if (!topForCategory) continue;
    addCandidate(topForCategory);
  }

  for (const candidate of sorted) {
    addCandidate(candidate);
  }

  if (categories.includes("BITCOIN")) {
    const btcCandidates = sorted.filter((candidate) => candidate.category === "BITCOIN");
    const btcMicro = btcCandidates.filter((candidate) => (candidate.timeToCloseDays ?? 99) <= BITCOIN_MICRO_HORIZON_DAYS);
    const preferredPool = btcMicro.length ? btcMicro : btcCandidates;
    const preferredBtc = preferredPool.length
      ? [...preferredPool].sort((a, b) => bitcoinMainstayScore(b) - bitcoinMainstayScore(a))[0]
      : null;

    if (preferredBtc) {
      addCandidate(preferredBtc);
    }
  }

  return selected;
}

function candidateKey(candidate: PredictionCandidate) {
  return `${candidate.ticker}:${candidate.side}`;
}

function mergeCandidateUniverse(
  primary: PredictionCandidate[],
  secondary: PredictionCandidate[],
): PredictionCandidate[] {
  const merged = new Map<string, PredictionCandidate>();

  for (const candidate of [...primary, ...secondary]) {
    const key = candidateKey(candidate);
    const existing = merged.get(key);
    if (!existing || candidateUtilityScore(candidate, MODE_RULES.CONSERVATIVE) > candidateUtilityScore(existing, MODE_RULES.CONSERVATIVE)) {
      merged.set(key, candidate);
    }
  }

  return [...merged.values()];
}

function relaxModeRules(rules: ModeRules, step: number): ModeRules {
  const boundedStep = clamp(step, 1, MAX_THROUGHPUT_RELAXATION_STEPS);
  const edgeScale = boundedStep === 1 ? 0.82 : 0.68;
  const confidenceShift = boundedStep === 1 ? 0.045 : 0.085;
  const spreadScale = boundedStep === 1 ? 1.14 : 1.28;
  const liquidityScale = boundedStep === 1 ? 0.82 : 0.68;

  return {
    ...rules,
    minEdge: Math.max(0.0012, rules.minEdge * edgeScale),
    confidenceFloor: Math.max(0.34, rules.confidenceFloor - confidenceShift),
    maxSpread: clamp(rules.maxSpread * spreadScale, 0.09, 0.24),
    minLiquidityScore: Math.max(0.08, rules.minLiquidityScore * liquidityScale),
    secondaryMinEdge:
      rules.secondaryMinEdge === null
        ? Math.max(0.001, rules.minEdge * edgeScale * 0.9)
        : Math.max(0.001, rules.secondaryMinEdge * edgeScale),
    secondaryConfidenceFloor: Math.max(
      0.34,
      (rules.secondaryConfidenceFloor ?? rules.confidenceFloor) - confidenceShift,
    ),
    secondaryMaxSpread: clamp((rules.secondaryMaxSpread ?? rules.maxSpread) * spreadScale, 0.09, 0.24),
    secondaryMinLiquidityScore: Math.max(
      0.08,
      (rules.secondaryMinLiquidityScore ?? rules.minLiquidityScore) * liquidityScale,
    ),
    highProbMinEdge: Math.max(0.0008, rules.highProbMinEdge * 0.8),
    highProbMaxEdge: clamp(rules.highProbMaxEdge * (1 + 0.25 * boundedStep), 0.006, 0.02),
    highProbMinConfidence: Math.max(0.34, rules.highProbMinConfidence - confidenceShift * 0.6),
  };
}

function candidateRiskBucket(category: PredictionCategory) {
  if (category === "BITCOIN" || category === "STOCKS" || category === "MACRO") return "RISK_ASSET";
  if (category === "POLITICS" || category === "SPORTS" || category === "ESPORTS") return "LIVE_EVENT";
  if (category === "WEATHER") return "WEATHER";
  return "OTHER";
}

function normalizeShadowBaselineCandidate(
  candidate: PredictionCandidate,
  profile: ShadowBaselineProfile,
): PredictionCandidate {
  if (profile !== "SMART_TAKER") return candidate;

  const currentFillProbability = candidate.executionPlan?.fillProbability ?? 0.55;
  const currentFeeUsd = candidate.executionPlan?.feeUsd ?? candidate.feeEstimateUsd ?? 0;
  const takerPenaltyPerContract =
    0.003 +
    Math.max(0, candidate.toxicityScore ?? 0) * 0.004 +
    Math.max(0, candidate.uncertaintyWidth ?? 0) * 0.025 +
    Math.max(0, 1 - currentFillProbability) * 0.002;
  const contracts = Math.max(candidateContractStep(candidate), candidate.recommendedContracts);
  const price = Math.max(0.01, candidate.limitPriceCents / 100);
  const adjustedExecutionEdge = (candidate.edge ?? 0) - takerPenaltyPerContract;
  const adjustedPerDollar = (candidate.expectedValuePerDollarRisked ?? 0) - takerPenaltyPerContract / Math.max(price, 0.01);
  const adjustedNetAlpha =
    (candidate.netAlphaUsd ?? candidate.expectedValuePerContract * contracts) -
    Math.max(0, candidate.executionAlphaUsd ?? 0) -
    takerPenaltyPerContract * contracts -
    currentFeeUsd * 0.15;

  return {
    ...candidate,
    executionAdjustedEdge: Number(adjustedExecutionEdge.toFixed(6)),
    expectedValuePerDollarRisked: Number(adjustedPerDollar.toFixed(6)),
    netAlphaUsd: Number(adjustedNetAlpha.toFixed(4)),
    executionAlphaUsd: Number((-takerPenaltyPerContract * contracts).toFixed(4)),
    executionPlan: candidate.executionPlan
      ? {
          ...candidate.executionPlan,
          role: "TAKER",
          fillProbability: 0.995,
          patienceHours: 0.01,
          expectedExecutionValueUsd: Number((-takerPenaltyPerContract * contracts).toFixed(4)),
          feeUsd: Number((currentFeeUsd * 1.15).toFixed(4)),
          quoteWidening: 0,
          staleHazard: 0,
        }
      : {
          limitPriceCents: candidate.limitPriceCents,
          patienceHours: 0.01,
          fillProbability: 0.995,
          expectedExecutionValueUsd: Number((-takerPenaltyPerContract * contracts).toFixed(4)),
          feeUsd: Number((currentFeeUsd * 1.15).toFixed(4)),
          role: "TAKER",
          quoteWidening: 0,
          staleHazard: 0,
          inventorySkew: 0,
        },
  };
}

function summarizeShadowBaseline(
  profile: ShadowBaselineProfile,
  description: string,
  candidates: PredictionCandidate[],
  actionable: PredictionCandidate[],
): ShadowBaselineSummary {
  const fillRates = actionable
    .map((candidate) => candidate.executionPlan?.fillProbability)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const executionAdjustedEdges = actionable
    .map((candidate) => candidate.executionAdjustedEdge ?? candidate.edge)
    .filter((value): value is number => Number.isFinite(value));
  const expectedNetAlpha = actionable
    .map((candidate) => candidate.netAlphaUsd ?? candidate.expectedValuePerContract * candidate.recommendedContracts)
    .filter((value): value is number => Number.isFinite(value));
  const netMarkoutAfterFees = actionable
    .map((candidate) => (candidate.executionAlphaUsd ?? candidate.executionPlan?.expectedExecutionValueUsd ?? 0) - (candidate.executionPlan?.feeUsd ?? candidate.feeEstimateUsd ?? 0))
    .filter((value): value is number => Number.isFinite(value));
  const adverseSelectionRates = actionable
    .map((candidate) => {
      const toxicity = Math.max(0, candidate.toxicityScore ?? 0);
      const rolePenalty = candidate.executionPlan?.role === "TAKER" ? 0.08 : 0;
      return clamp(toxicity + rolePenalty, 0, 1);
    })
    .filter((value): value is number => Number.isFinite(value));
  const labelByProfile: Record<ShadowBaselineProfile, string> = {
    CURRENT_MAKER: "Current Maker",
    SMART_TAKER: "Old Smart Taker",
    MAKER_NO_TOXICITY: "Maker w/o Toxicity Gate",
    MAKER_NO_CLUSTER_CAP: "Maker w/o Cluster Caps",
  };

  return {
    profile,
    label: labelByProfile[profile],
    description,
    candidateCount: candidates.length,
    actionables: actionable.length,
    plannedStakeUsd: Number(actionable.reduce((sum, candidate) => sum + candidate.recommendedStakeUsd, 0).toFixed(4)),
    avgExecutionAdjustedEdge: executionAdjustedEdges.length ? Number(average(executionAdjustedEdges).toFixed(6)) : null,
    expectedNetAlphaUsd: expectedNetAlpha.length ? Number(expectedNetAlpha.reduce((sum, value) => sum + value, 0).toFixed(4)) : null,
    expectedNetMarkoutAfterFeesUsd: netMarkoutAfterFees.length ? Number(netMarkoutAfterFees.reduce((sum, value) => sum + value, 0).toFixed(4)) : null,
    expectedExpiryPnlUsd: expectedNetAlpha.length ? Number(expectedNetAlpha.reduce((sum, value) => sum + value, 0).toFixed(4)) : null,
    fillRateEstimate: fillRates.length ? Number(average(fillRates).toFixed(6)) : null,
    cancellationRateEstimate: fillRates.length ? Number(average(fillRates.map((value) => 1 - value)).toFixed(6)) : null,
    adverseSelectionRate: adverseSelectionRates.length ? Number(average(adverseSelectionRates).toFixed(6)) : null,
    topTickers: actionable
      .slice()
      .sort((a, b) => (b.executionAdjustedEdge ?? b.edge) - (a.executionAdjustedEdge ?? a.edge))
      .slice(0, 4)
      .map((candidate) => candidate.ticker),
    notes: [
      `Compared on the same diversified candidate universe (${candidates.length} candidates).`,
      `Actionable set size ${actionable.length} with planned stake $${actionable.reduce((sum, candidate) => sum + candidate.recommendedStakeUsd, 0).toFixed(2)}.`,
    ],
  };
}

function buildShadowBaselineSummaries(args: {
  mode: AutomationMode;
  selected: PredictionCandidate[];
  planned: PredictionCandidate[];
  actionable: PredictionCandidate[];
  maxDailyRiskUsd: number;
}): ShadowBaselineSummary[] {
  const { mode, selected, planned, actionable, maxDailyRiskUsd } = args;
  const currentMaker = summarizeShadowBaseline(
    "CURRENT_MAKER",
    "Current bounded log-odds maker with toxicity and cluster controls active.",
    planned,
    actionable,
  );
  const smartTakerCandidates = selected.map((candidate) => normalizeShadowBaselineCandidate(candidate, "SMART_TAKER"));
  const smartTakerPlanned = applyPortfolioSizing(smartTakerCandidates, maxDailyRiskUsd, mode, {
    disableClusterCap: false,
    toxicityWeightScale: 0.65,
  });
  const smartTaker = summarizeShadowBaseline(
    "SMART_TAKER",
    "Legacy-style taker profile with immediate fills and weaker queue discipline.",
    smartTakerPlanned,
    actionableCandidates(smartTakerPlanned, mode, { ignoreToxicityGate: true }),
  );
  const makerNoToxicityPlanned = applyPortfolioSizing(selected, maxDailyRiskUsd, mode, {
    disableClusterCap: false,
    toxicityWeightScale: 0,
  });
  const makerNoToxicity = summarizeShadowBaseline(
    "MAKER_NO_TOXICITY",
    "Current maker profile with toxicity penalty removed from sizing and gating.",
    makerNoToxicityPlanned,
    actionableCandidates(makerNoToxicityPlanned, mode, { ignoreToxicityGate: true }),
  );
  const makerNoClusterCapPlanned = applyPortfolioSizing(selected, maxDailyRiskUsd, mode, {
    disableClusterCap: true,
    toxicityWeightScale: 1,
  });
  const makerNoClusterCap = summarizeShadowBaseline(
    "MAKER_NO_CLUSTER_CAP",
    "Current maker profile with cluster concentration caps disabled.",
    makerNoClusterCapPlanned,
    actionableCandidates(makerNoClusterCapPlanned, mode),
  );

  return [currentMaker, smartTaker, makerNoToxicity, makerNoClusterCap];
}

// `estimateCandidateMoments` moved to the top of the file for visibility in `candidateUtilityScore`.

function applyPortfolioSizing(
  candidates: PredictionCandidate[],
  maxDailyRiskUsd: number,
  mode: AutomationMode,
  options?: PortfolioSizingOptions,
): PredictionCandidate[] {
  const rules = MODE_RULES[mode];
  const clusterStakeLimitUsd = maxDailyRiskUsd * CLUSTER_LIMIT_SHARE_BY_MODE[mode];
  const toxicityWeightScale = options?.toxicityWeightScale ?? 1;
  const buyPriority = [...candidates]
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => {
      const aActionable = isBuyVerdict(a.candidate.verdict) ? 1 : 0;
      const bActionable = isBuyVerdict(b.candidate.verdict) ? 1 : 0;
      if (aActionable !== bActionable) return bActionable - aActionable;
      return candidateUtilityScore(b.candidate, rules) - candidateUtilityScore(a.candidate, rules);
    });
  const tradable = buyPriority.filter(
    ({ candidate }) =>
      isBuyVerdict(candidate.verdict) &&
      candidate.expectedValuePerDollarRisked > 0 &&
      (candidate.compositeScore ?? -1) > 0,
  );
  const out = new Array<PredictionCandidate>(candidates.length);

  if (!tradable.length) {
    for (const { candidate, index } of buyPriority) {
      out[index] = {
        ...candidate,
        recommendedContracts: 0,
        recommendedStakeUsd: 0,
        portfolioWeight: 0,
        netAlphaUsd: 0,
      };
    }
    return out;
  }

  const bucketCounts = new Map<string, number>();
  for (const { candidate } of tradable) {
    const bucket = candidateRiskBucket(candidate.category);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
  }

  const rawWeightByKey = new Map<string, number>();
  let rawWeightSum = 0;
  for (const { candidate } of tradable) {
    const { mean, variance, cvar } = estimateCandidateMoments(candidate);
    const bucket = candidateRiskBucket(candidate.category);
    const concentrationPenalty = 1 + Math.max(0, (bucketCounts.get(bucket) ?? 1) - 1) * rules.entropyPenalty;
    
    // Lock-up tracking (Temporal impact of trapped capital)
    const timePenalty = 1 + Math.max(0, (candidate.capitalTimeDays ?? candidate.timeToCloseDays ?? 1) - rules.timeBudgetFactor) * 0.12;

    // Blend standard Market CVaR with Depth-aware Liquidation CVaR
    const liquidationTailRisk = candidate.liquidationCVaR ?? 0.05;
    const combinedCvar = cvar + liquidationTailRisk * 2.5; 

    const rawKelly = Math.max(0, mean) / Math.max(0.18, variance + rules.cvarPenalty * combinedCvar);
    const boundedKelly = clamp(rawKelly, 0, rules.kellyFractionCap);
    
    const rawWeight = Math.max(0, boundedKelly / (concentrationPenalty * timePenalty));
    rawWeightByKey.set(candidateKey(candidate), rawWeight);
    rawWeightSum += rawWeight;
  }

  const targetStakeByKey = new Map<string, number>();
  const clusterCapMissByKey = new Map<string, number>();
  for (const { candidate } of tradable) {
    const key = candidateKey(candidate);
    const weight = rawWeightSum > 0 ? (rawWeightByKey.get(key) ?? 0) / rawWeightSum : 0;
    const targetStake = weight * maxDailyRiskUsd;
    targetStakeByKey.set(key, targetStake);
  }

  const allocatedContracts = new Map<string, number>();
  const allocatedStakeByCluster = new Map<string, number>();
  let riskRemaining = maxDailyRiskUsd;
  const tradableOrdered = [...tradable].sort((a, b) => {
    const aKey = candidateKey(a.candidate);
    const bKey = candidateKey(b.candidate);
    return (rawWeightByKey.get(bKey) ?? 0) - (rawWeightByKey.get(aKey) ?? 0);
  });

  for (const { candidate } of tradableOrdered) {
    const contractStep = candidateContractStep(candidate);
    const unitStake = candidateUnitStake(candidate);
    const clusterKey = candidate.riskCluster ?? candidate.category;
    const clusterStake = allocatedStakeByCluster.get(clusterKey) ?? 0;
    if (unitStake > riskRemaining) continue;
    if (!options?.disableClusterCap && clusterStake + unitStake > clusterStakeLimitUsd) {
      clusterCapMissByKey.set(
        candidateKey(candidate),
        Math.max(clusterCapMissByKey.get(candidateKey(candidate)) ?? 0, clusterStake + unitStake - clusterStakeLimitUsd),
      );
      continue;
    }
    const targetStake = targetStakeByKey.get(candidateKey(candidate)) ?? 0;
    const strongSignal =
      (candidate.compositeScore ?? 0) > SCORE_THRESHOLD_BY_MODE[mode] * 1.35 ||
      (candidate.executionPlan?.fillProbability ?? 0) >= 0.62 ||
      ((candidate.executionAlphaUsd ?? 0) > (candidate.feeEstimateUsd ?? 0) && (candidate.toxicityScore ?? 0) < 0.72);
    if (targetStake >= unitStake * 0.55 || strongSignal) {
      allocatedContracts.set(candidateKey(candidate), contractStep);
      allocatedStakeByCluster.set(clusterKey, clusterStake + unitStake);
      riskRemaining = Number((riskRemaining - unitStake).toFixed(4));
    }
  }

  if (![...allocatedContracts.values()].some((value) => value > 0)) {
    const top = tradableOrdered[0]?.candidate;
    if (top) {
      const contractStep = candidateContractStep(top);
      const unitStake = candidateUnitStake(top);
      const clusterKey = top.riskCluster ?? top.category;
      const clusterStake = allocatedStakeByCluster.get(clusterKey) ?? 0;
      if (unitStake <= riskRemaining) {
        allocatedContracts.set(candidateKey(top), contractStep);
        allocatedStakeByCluster.set(clusterKey, clusterStake + unitStake);
        riskRemaining = Number((riskRemaining - unitStake).toFixed(4));
      }
    }
  }

  const minPrice = Math.min(
    ...tradableOrdered.map(({ candidate }) => {
      return candidateUnitStake(candidate);
    }),
  );
  let guard = 0;
  while (riskRemaining >= minPrice && guard < 4000) {
    guard += 1;
    let bestCandidate: PredictionCandidate | null = null;
    let bestMarginal = 0;

    for (const { candidate } of tradableOrdered) {
      const key = candidateKey(candidate);
      const price = Math.max(0.01, candidate.limitPriceCents / 100);
      const contractStep = candidateContractStep(candidate);
      const unitStake = candidateUnitStake(candidate);
      const clusterKey = candidate.riskCluster ?? candidate.category;
      const clusterStake = allocatedStakeByCluster.get(clusterKey) ?? 0;
      if (unitStake > riskRemaining) continue;
      if (!options?.disableClusterCap && clusterStake + unitStake > clusterStakeLimitUsd) {
        clusterCapMissByKey.set(
          candidateKey(candidate),
          Math.max(clusterCapMissByKey.get(key) ?? 0, clusterStake + unitStake - clusterStakeLimitUsd),
        );
        continue;
      }

      const currentContracts = allocatedContracts.get(key) ?? 0;
      const currentStake = currentContracts * price;
      const targetStake = targetStakeByKey.get(key) ?? 0;
      const gapBoost = currentStake < targetStake ? 1.25 : 0.55;
      const diminishing = Math.sqrt(1 + currentContracts);
      const executionBaseContracts = Math.max(contractStep, candidate.recommendedContracts);
      const marginal =
        (
          (candidate.compositeScore ?? 0) * 0.9 +
          candidate.expectedValuePerDollarRisked * 0.55 +
          ((candidate.executionAlphaUsd ?? 0) / executionBaseContracts) * 0.4 +
          (candidate.executionAdjustedEdge ?? 0) * 0.35
        ) *
        gapBoost /
        (diminishing * (1 + Math.max(0, candidate.toxicityScore ?? 0) * 0.9 * toxicityWeightScale));

      if (marginal > bestMarginal) {
        bestMarginal = marginal;
        bestCandidate = candidate;
      }
    }

    if (!bestCandidate || bestMarginal <= 0) break;

    const bestKey = candidateKey(bestCandidate);
    const bestPrice = Math.max(0.01, bestCandidate.limitPriceCents / 100);
    const bestStep = candidateContractStep(bestCandidate);
    const bestClusterKey = bestCandidate.riskCluster ?? bestCandidate.category;
    allocatedContracts.set(bestKey, Number(((allocatedContracts.get(bestKey) ?? 0) + bestStep).toFixed(6)));
    allocatedStakeByCluster.set(bestClusterKey, (allocatedStakeByCluster.get(bestClusterKey) ?? 0) + bestPrice * bestStep);
    riskRemaining = Number((riskRemaining - bestPrice * bestStep).toFixed(4));
  }

  for (const { candidate, index } of buyPriority) {
    if (!isBuyVerdict(candidate.verdict)) {
      out[index] = {
        ...candidate,
        recommendedContracts: 0,
        recommendedStakeUsd: 0,
        portfolioWeight: 0,
        netAlphaUsd: 0,
      };
      continue;
    }

    const price = Math.max(0.01, candidate.limitPriceCents / 100);
    const contracts = allocatedContracts.get(candidateKey(candidate)) ?? 0;
    const finalStake = Number((contracts * price).toFixed(4));
    const targetWeight = maxDailyRiskUsd > 0 ? finalStake / maxDailyRiskUsd : 0;
    const executionBaseContracts = Math.max(candidateContractStep(candidate), candidate.recommendedContracts);

    out[index] = {
      ...candidate,
      recommendedContracts: contracts,
      recommendedStakeUsd: Number(finalStake.toFixed(4)),
      portfolioWeight: Number(targetWeight.toFixed(6)),
      netAlphaUsd: Number((candidate.expectedValuePerContract * contracts).toFixed(4)),
      executionPlan: candidate.executionPlan
        ? {
            ...candidate.executionPlan,
            expectedExecutionValueUsd: Number(
              (((candidate.executionPlan.expectedExecutionValueUsd / executionBaseContracts) || 0) * contracts).toFixed(4),
            ),
            feeUsd: Number((((candidate.executionPlan.feeUsd / executionBaseContracts) || 0) * contracts).toFixed(4)),
          }
        : undefined,
      gateDiagnostics:
        contracts <= 0 && clusterCapMissByKey.has(candidateKey(candidate))
          ? upsertGateDiagnostic(candidate.gateDiagnostics, {
              gate: "CLUSTER_CAP",
              passed: false,
              observed: Number(((clusterCapMissByKey.get(candidateKey(candidate)) ?? 0) + clusterStakeLimitUsd).toFixed(6)),
              threshold: Number(clusterStakeLimitUsd.toFixed(6)),
              missBy: Number((clusterCapMissByKey.get(candidateKey(candidate)) ?? 0).toFixed(6)),
              unit: "usd",
              detail: `Cluster stake cap blocked additional allocation in ${candidate.riskCluster ?? candidate.category}.`,
            })
          : candidate.gateDiagnostics,
    };
  }

  return out;
}

function actionableCandidates(
  planned: PredictionCandidate[],
  mode: AutomationMode,
  options?: ActionableCandidateOptions,
): PredictionCandidate[] {
  return planned.filter(
    (candidate) =>
      candidate.recommendedContracts > 0 &&
      candidate.recommendedStakeUsd > 0 &&
      candidate.expectedValuePerDollarRisked > 0 &&
      (candidate.executionAdjustedEdge ?? candidate.edge) > 0 &&
      (options?.ignoreToxicityGate || (candidate.toxicityScore ?? 0) < 0.9) &&
      (candidate.compositeScore ?? -1) > SCORE_THRESHOLD_BY_MODE[mode] &&
      isBuyVerdict(candidate.verdict),
  );
}

function deriveActionableTarget(selected: PredictionCandidate[], maxDailyRiskUsd: number, mode: AutomationMode) {
  const priced = selected
    .filter((candidate) => isBuyVerdict(candidate.verdict))
    .map((candidate) => candidateUnitStake(candidate))
    .sort((a, b) => a - b);
  if (!priced.length) return MIN_ACTIONABLE_TARGET_BY_MODE[mode];
  const medianPrice = priced[Math.floor(priced.length / 2)] ?? priced[0];
  const budgetCapacity = Math.max(1, Math.floor(maxDailyRiskUsd / Math.max(0.05, medianPrice)));
  return Math.max(MIN_ACTIONABLE_TARGET_BY_MODE[mode], Math.min(priced.length, budgetCapacity));
}

function buildExploratoryCandidates(
  markets: PredictionMarketQuote[],
  categories: PredictionCategory[],
  accountBalanceUsd: number,
  mode: AutomationMode,
  controls: AutomationControls,
  inferredRegime: { label: string; confidence: number },
  maxDailyRiskUsd: number,
): PredictionCandidate[] {
  const rules = MODE_RULES[mode];
  const out: PredictionCandidate[] = [];

  for (const category of categories) {
    const pool = markets
      .filter((market) => market.category === category)
      .map((market) => {
        const yesPrice = firstDefined(market.yesAsk, market.lastPrice);
        const noPrice = firstDefined(market.noAsk, yesPrice !== null ? 1 - yesPrice : null);
        const minPrice = category === "BITCOIN" ? 0.02 : 0.05;
        const maxPrice = category === "BITCOIN" ? 0.98 : 0.95;

        const priceOptions: Array<{ side: PredictionSide; price: number }> = [];
        if (yesPrice !== null && yesPrice >= minPrice && yesPrice <= maxPrice) priceOptions.push({ side: "YES", price: yesPrice });
        if (noPrice !== null && noPrice >= minPrice && noPrice <= maxPrice) priceOptions.push({ side: "NO", price: noPrice });
        if (!priceOptions.length) return null;

        const timeToCloseDays = Number(daysUntil(market.closeTime).toFixed(4));
        const exploratoryHighProbThresholds = resolveHighProbThresholds({
          category,
          timeToCloseDays,
          rules,
        });
        const highProbOption = [...priceOptions]
          .filter((option) => option.price >= exploratoryHighProbThresholds.marketMin)
          .sort((a, b) => b.price - a.price)[0];
        const preferred = highProbOption ?? [...priceOptions].sort((a, b) => a.price - b.price)[0];
        const microDistance = Math.abs(timeToCloseDays - BITCOIN_FOCUS_HORIZON_DAYS);
        return {
          market,
          preferred,
          hasHighProbOption: Boolean(highProbOption),
          liquidity: market.volume + market.openInterest,
          timeToCloseDays,
          microDistance,
        };
      })
      .filter(
        (
          row,
        ): row is {
          market: PredictionMarketQuote;
          preferred: { side: PredictionSide; price: number };
          hasHighProbOption: boolean;
          liquidity: number;
          timeToCloseDays: number;
          microDistance: number;
        } =>
          row !== null,
      )
      .sort((a, b) => {
        if (category === "BITCOIN") {
          const horizonCmp = a.microDistance - b.microDistance;
          if (Math.abs(horizonCmp) > 0.002) return horizonCmp;
        }
        return b.liquidity - a.liquidity;
      });

    if (!pool.length) continue;

    const exploratoryPerCategory = mode === "AI" || mode === "AGGRESSIVE" ? 2 : 1;
    const picks = pool.slice(0, exploratoryPerCategory);

    for (const picked of picks) {
      const exploratoryRisk =
        category === "BITCOIN"
          ? Math.max(2, Math.min(accountBalanceUsd * rules.perTradeRiskPct * 1.35, 4.5))
          : Math.max(1, Math.min(accountBalanceUsd * rules.perTradeRiskPct, 2));
      const contractStep = marketContractStep(picked.market);
      const executionPrice = snapProbabilityToMarket(picked.preferred.price, picked.market, "down");
      const contracts = snapContractCount(exploratoryRisk / executionPrice, contractStep, "down");
      if (contracts < contractStep) continue;
      const stake = Number((contracts * executionPrice).toFixed(4));
      const opportunityType: OpportunityType = "WATCHLIST";
      const timeToCloseDays = Number(daysUntil(picked.market.closeTime).toFixed(2));
      const spread = Math.max(
        0.01,
        (picked.market.yesAsk ?? picked.preferred.price) - (picked.market.yesBid ?? picked.preferred.price),
      );
      const liquidityScore = clamp(Math.log1p(picked.market.volume + picked.market.openInterest) / 8, 0.08, 1);
      const exploratoryModelProb = picked.hasHighProbOption
        ? clamp(executionPrice + 0.004, executionPrice, 0.98)
        : 0.5;
      const exploratoryEdge = Number((exploratoryModelProb - executionPrice).toFixed(4));
      const exploratoryConfidence = picked.hasHighProbOption ? 0.42 : 0.35;
      const capitalTimeDays = estimateCapitalTimeDays(picked.market);
      const exploratoryNetAlpha = Number((exploratoryEdge * contracts).toFixed(4));
      const exploratoryScore =
        stake > 0 && capitalTimeDays > 0 ? exploratoryNetAlpha / (stake * capitalTimeDays) : -1;
      const exploratoryThresholds = resolveHighProbThresholds({
        category: picked.market.category,
        timeToCloseDays,
        rules,
      });
      const strategyTags = inferStructuralStrategyTags(picked.market);
      const favoriteLongshotBias = evaluateFavoriteLongshotBias({
        side: picked.preferred.side,
        marketProb: picked.preferred.price,
        modelProb: exploratoryModelProb,
        edge: exploratoryEdge,
      });
      const favoriteLongshotActive = controls.favoriteLongshotEnabled ? favoriteLongshotBias : {
        active: false,
        supportsTrade: false,
        autoExecute: false,
        shouldFadeCheapYes: false,
        probabilityGap: 0,
      };
      if (favoriteLongshotActive.supportsTrade) {
        strategyTags.push("FAVORITE_LONGSHOT_BIAS");
      }
      const exploratoryExecutable =
        ((controls.highProbabilityEnabled && picked.hasHighProbOption) || favoriteLongshotActive.autoExecute) &&
        exploratoryEdge > 0 &&
        exploratoryConfidence >= Math.max(0.38, exploratoryThresholds.confidenceMin);
      const verdict: CandidateVerdict = exploratoryExecutable
        ? (picked.preferred.side === "YES" ? "BUY_YES" : "BUY_NO")
        : "WATCHLIST";
      const strategicBreakdown =
        mode === "AI"
          ? buildStrategicBreakdown({
              market: picked.market,
              side: picked.preferred.side,
              marketProb: executionPrice,
              modelProb: exploratoryModelProb,
              edge: exploratoryEdge,
              confidence: exploratoryConfidence,
              spread,
              liquidityScore,
              opportunityType,
              verdict,
              stakeUsd: stake,
              maxDailyRiskUsd,
              inferredRegime,
            })
          : undefined;

      out.push({
        ticker: picked.market.ticker,
        title: picked.market.title,
        category: picked.market.category,
        side: picked.preferred.side,
        marketProb: Number(executionPrice.toFixed(4)),
        modelProb: Number(exploratoryModelProb.toFixed(4)),
        edge: exploratoryEdge,
        expectedValuePerContract: exploratoryEdge,
        expectedValuePerDollarRisked: Number((exploratoryEdge / Math.max(0.01, executionPrice)).toFixed(4)),
        confidence: exploratoryConfidence,
        recommendedStakeUsd: stake,
        recommendedContracts: contracts,
        contractStep,
        limitPriceCents: probabilityToCents(executionPrice),
        netAlphaUsd: exploratoryNetAlpha,
        capitalTimeDays: Number(capitalTimeDays.toFixed(6)),
        compositeScore: Number(exploratoryScore.toFixed(6)),
        portfolioWeight: 0,
        executionPlan: {
          limitPriceCents: probabilityToCents(executionPrice),
          patienceHours: 0.08,
          fillProbability: picked.hasHighProbOption ? 0.68 : 0.42,
          expectedExecutionValueUsd: exploratoryNetAlpha,
          feeUsd: 0,
          role: "MAKER",
        },
        rationale: [
          "Exploratory execution: no high-edge setup available under current thresholds.",
          picked.hasHighProbOption
            ? `High-probability fallback selected (>=${(exploratoryThresholds.marketMin * 100).toFixed(0)}% market probability) with intentionally low edge.`
            : "High-probability fallback unavailable in this category at current prices.",
          exploratoryExecutable
            ? "Exploratory candidate promoted to BUY due positive EV and high-probability support."
            : "Exploratory candidate kept as watchlist due limited evidence.",
          category === "BITCOIN"
            ? "BTC mainstay fallback: selected near-15-minute contract with best available liquidity."
            : "Selected highest-liquidity contract in category with bounded risk size.",
          `Exploratory score ${exploratoryScore.toFixed(5)} per capital-day.`,
        ],
        strategyTags,
        opportunityType,
        verdict,
        timeToCloseDays,
        strategicBreakdown,
        simulated: true,
        executionStatus: "SKIPPED",
        executionMessage: "Planned only",
      });
    }
  }

  return out;
}

async function resolveAccountBalance() {
  const kalshiBalance = await getKalshiDemoBalanceUsd();
  if (typeof kalshiBalance === "number" && Number.isFinite(kalshiBalance) && kalshiBalance >= 0) {
    return {
      balanceUsd: kalshiBalance,
      fromBroker: true,
    };
  }

  return {
    balanceUsd: 100,
    fromBroker: false,
  };
}

export async function runPredictionAutomation(input: AutomationRunInput): Promise<AutomationRunSummary> {
  const defaultCategories: PredictionCategory[] = [...ALL_SCAN_CATEGORIES];
  const categories = input.categories.length ? input.categories : defaultCategories;
  const mode = input.mode;
  const runId = randomUUID();
  const controls = normalizeAutomationControls(input.controls);
  let rules = applyAutomationControls(MODE_RULES[mode], controls);
  const scanCategories = [...ALL_SCAN_CATEGORIES];
  const marketScanLimit = 1200;

  const [markets, account, btcSpot, livePrivateState] = await Promise.all([
    getKalshiOpenMarketsStream(scanCategories, marketScanLimit),
    resolveAccountBalance(),
    getBitcoinSpotUsd(),
    getKalshiPrivateStateStream().catch(() => ({
      orders: [],
      fills: [],
      positions: [],
      quotes: {},
    })),
  ]);
  const existingPositions = livePrivateState.positions;
  const existingOrders = livePrivateState.orders;
  const recentFills = livePrivateState.fills;
  const accountBalanceUsd = account.balanceUsd;
  const bootstrapMode = deriveBootstrapMode();
  const marketsByTicker = new Map(markets.map((market) => [market.ticker.toUpperCase(), market] as const));
  const riskClusterByTicker = new Map(markets.map((market) => [market.ticker.toUpperCase(), deriveRiskCluster(market)] as const));
  const historyByTicker = getKalshiRecentMarketHistoryStream(markets.map((market) => market.ticker));
  const openPositionConstraint = buildOpenExposureConstraint(existingPositions, existingOrders, marketsByTicker, riskClusterByTicker);

  const initialBalances = await getKalshiDemoBalancesUsd().catch(() => ({ cashUsd: null, portfolioUsd: null }));
  await persistKalshiBalanceSnapshot({
    balanceUsd: initialBalances.cashUsd ?? initialBalances.portfolioUsd ?? null,
    cashUsd: initialBalances.cashUsd ?? initialBalances.portfolioUsd ?? null,
    portfolioUsd: initialBalances.portfolioUsd ?? initialBalances.cashUsd ?? null,
    source: "automation/pre-run-balance",
  }).catch(() => undefined);

  const warnings: string[] = [];
  if (!btcSpot) warnings.push("BTC spot feed unavailable; using order-book fallback model for bitcoin contracts.");
  if (!account.fromBroker) warnings.push("Kalshi balance unavailable; using conservative placeholder balance for planning.");
  if (input.execute && bootstrapMode === "EVENT_PRIMED") {
    warnings.push("Private stream bootstrap is event-primed rather than fully acked; execution attribution will flag this run.");
  }

  const priorAttribution = await loadExecutionAttributionSummary({ lookbackHours: 72, recentTradeLimit: 12, bucketLimit: 6 }).catch(() => null);
  const learningOutput = priorAttribution
    ? buildFalseNegativeLearning({
        attribution: priorAttribution,
        lookbackHours: 72,
        active: controls.adaptiveLearningEnabled,
      })
    : null;
  if (learningOutput) {
    await persistLearningOutput({
      output: learningOutput,
      runId,
      mode,
      source: "automation/false-negative-learning",
    }).catch(() => undefined);
  }
  const learningApplied = applyLearningToRules(rules, learningOutput?.recommendations);
  rules = learningApplied.rules;
  warnings.push(...learningApplied.notes);
  const adaptiveGates = learningApplied.gates;

  const inferredRegime = detectGlobalRegime(markets);
  const mathContext = buildMarketMathContext(markets);
  const overlayContext = await buildOverlayContext(markets);
  await persistMarketScan({
    markets,
    source: "automation/market-scan",
  }).catch(() => {
    warnings.push("Storage warning: failed to persist market scan snapshot.");
  });
  const liquidationDecisions: LiquidationDecision[] = controls.liquidationAdvisoryEnabled
    ? existingPositions
        .map((position) => {
          const market = marketsByTicker.get(position.ticker.toUpperCase());
          if (!market) return null;
          return evaluateLiquidationDecision({
            position,
            market,
            riskCluster: riskClusterByTicker.get(position.ticker.toUpperCase()),
          });
        })
        .filter((decision): decision is LiquidationDecision => decision !== null)
    : [];
  if (liquidationDecisions.length) {
    await persistLiquidationDecisions({
      runId,
      mode,
      decisions: liquidationDecisions,
      source: "automation/liquidation-decisions",
    }).catch(() => {
      warnings.push("Storage warning: failed to persist liquidation decisions.");
    });
  }
  const markoutDiagnostics = await refreshMarkoutTelemetry(recentFills, markets).catch(() => null);
  const markoutPenalty = markoutDiagnostics
    ? Math.max(
        0,
        -(markoutDiagnostics.horizons["30s"].averageMarkout * 0.45 + markoutDiagnostics.horizons["2m"].averageMarkout * 0.55),
      )
    : 0;
  const markoutSamples = markoutDiagnostics
    ? markoutDiagnostics.horizons["30s"].count + markoutDiagnostics.horizons["2m"].count
    : 0;
  const executionHealth = buildExecutionHealthContext(markoutPenalty, markoutSamples);
  rules = applyExecutionHealthRules(rules, executionHealth);
  warnings.push(...executionHealth.warnings);

  const baseDailyRiskUsd = accountBalanceUsd * rules.maxDailyRiskPct;
  const highProbFloorUsd = Math.min(accountBalanceUsd, rules.highProbDailyRiskFloorUsd);
  const maxDailyRiskUsd = Number(Math.max(baseDailyRiskUsd, highProbFloorUsd).toFixed(2));
  if (maxDailyRiskUsd > baseDailyRiskUsd + 0.01) {
    warnings.push(
      `High-probability sizing floor active: daily risk raised from $${baseDailyRiskUsd.toFixed(2)} to $${maxDailyRiskUsd.toFixed(2)}.`,
    );
  }

  const generatedRaw = markets
    .map((market) =>
      candidateFromMarket(
        market,
        mode,
        rules,
        controls,
        accountBalanceUsd,
        inferredRegime,
        btcSpot,
        maxDailyRiskUsd,
        mathContext,
        overlayContext,
        executionHealth,
        markets,
        historyByTicker,
        adaptiveGates,
      ),
    )
    .filter((candidate): candidate is PredictionCandidate => candidate !== null);
  const generatedFilter = filterExistingPositionCandidates(generatedRaw, openPositionConstraint, controls);
  const generated = generatedFilter.filtered;
  if (generatedFilter.replacementDecisions.length) {
    await persistReplacementDecisions({
      runId,
      mode,
      decisions: generatedFilter.replacementDecisions,
      source: "automation/replacement-decisions",
    }).catch(() => {
      warnings.push("Storage warning: failed to persist replacement decisions.");
    });
  }
  if (generatedFilter.blocked.length) {
    await persistCandidateDecisions({
      runId,
      mode,
      executeRequested: input.execute,
      candidates: generatedFilter.blocked,
      source: "automation/conflict-blocked-candidates",
    }).catch(() => {
      warnings.push("Storage warning: failed to persist conflict-blocked candidate decisions.");
    });
  }
  await persistCandidateDecisions({
    runId,
    mode,
    executeRequested: input.execute,
    candidates: generated,
    source: "automation/generated-candidates",
  }).catch(() => {
    warnings.push("Storage warning: failed to persist generated candidate decisions.");
  });
  const availableBitcoinMarkets = markets.filter((market) => market.category === "BITCOIN").length;
  const availableBitcoinMicroMarkets = markets.filter(
    (market) => market.category === "BITCOIN" && daysUntil(market.closeTime) <= BITCOIN_MICRO_HORIZON_DAYS,
  ).length;

  if (!generated.length) {
    warnings.push("No candidates passed edge/confidence thresholds for this mode.");
  }
  if (generatedFilter.skipped > 0) {
    warnings.push(
      `Skipped ${generatedFilter.skipped} candidate${generatedFilter.skipped === 1 ? "" : "s"} because the market already has exposure or pending execution${generatedFilter.sameSideSkipped > 0 ? ` (${generatedFilter.sameSideSkipped} on the same side)` : ""}${generatedFilter.orderSkipped > 0 ? `, ${generatedFilter.orderSkipped} blocked by existing orders` : ""}.`,
    );
  }

  let candidateUniverse = generated;
  let selected = selectDiversifiedCandidates(candidateUniverse, categories, rules);
  if (!selected.length && controls.exploratoryFallbackEnabled) {
    const exploratoryRaw = buildExploratoryCandidates(
      markets,
      categories,
      accountBalanceUsd,
      mode,
      controls,
      inferredRegime,
      maxDailyRiskUsd,
    );
    const exploratoryFilter = filterExistingPositionCandidates(exploratoryRaw, openPositionConstraint, controls);
    if (exploratoryFilter.replacementDecisions.length) {
      await persistReplacementDecisions({
        runId,
        mode,
        decisions: exploratoryFilter.replacementDecisions,
        source: "automation/exploratory-replacements",
      }).catch(() => undefined);
    }
    const exploratory = exploratoryFilter.filtered;
    if (exploratory.length) {
      selected = exploratory;
      candidateUniverse = mergeCandidateUniverse(candidateUniverse, selected);
      warnings.push("Using exploratory micro-size orders due lack of high-confidence edge.");
    }
  }

  let planned = applyPortfolioSizing(selected, maxDailyRiskUsd, mode);
  await persistCandidateDecisions({
    runId,
    mode,
    executeRequested: input.execute,
    candidates: planned,
    source: "automation/planned-candidates",
  }).catch(() => {
    warnings.push("Storage warning: failed to persist planned candidate decisions.");
  });
  const watchlistLifecycle = await updateWatchlistLifecycle({
    runId,
    candidates: planned,
    promotionThreshold: controls.watchlistPromotionThreshold,
    enabled: controls.watchlistPromotionEnabled,
  }).catch(() => null);
  if (watchlistLifecycle) {
    planned = applyWatchlistPromotionState(planned, watchlistLifecycle.states, watchlistLifecycle.promotions);
    await persistWatchlistEvents({
      events: watchlistLifecycle.events,
      runId,
      mode,
      source: "automation/watchlist-lifecycle",
    }).catch(() => {
      warnings.push("Storage warning: failed to persist watchlist lifecycle events.");
    });
    const promotedCount = [...watchlistLifecycle.promotions.values()].filter((decision) => decision.promoted).length;
    if (promotedCount > 0) {
      warnings.push(`Watchlist promotion activated for ${promotedCount} candidate${promotedCount === 1 ? "" : "s"}.`);
    }
  }
  let actionable = actionableCandidates(planned, mode);

  const targetActionable = deriveActionableTarget(selected, maxDailyRiskUsd, mode);
  if (controls.throughputRecoveryEnabled && actionable.length < targetActionable) {
    for (let step = 1; step <= MAX_THROUGHPUT_RELAXATION_STEPS; step += 1) {
      const relaxedRules = relaxModeRules(rules, step);
      const relaxedGenerated = markets
        .map((market) =>
          candidateFromMarket(
            market,
            mode,
            relaxedRules,
            controls,
            accountBalanceUsd,
            inferredRegime,
            btcSpot,
          maxDailyRiskUsd,
          mathContext,
          overlayContext,
          executionHealth,
          markets,
          historyByTicker,
          adaptiveGates,
        ),
      )
        .filter((candidate): candidate is PredictionCandidate => candidate !== null)
        .map((candidate) => ({
          ...candidate,
          rationale: [
            `Throughput recovery step ${step}: adaptive threshold relaxation engaged while preserving positive EV execution filter.`,
            ...candidate.rationale,
          ],
        }));
      const relaxedFilter = filterExistingPositionCandidates(relaxedGenerated, openPositionConstraint, controls);
      if (relaxedFilter.replacementDecisions.length) {
        await persistReplacementDecisions({
          runId,
          mode,
          decisions: relaxedFilter.replacementDecisions,
          source: `automation/throughput-recovery-replacements-${step}`,
        }).catch(() => undefined);
      }
      const relaxedGeneratedFiltered = relaxedFilter.filtered;

      if (!relaxedGeneratedFiltered.length) continue;

      candidateUniverse = mergeCandidateUniverse(candidateUniverse, relaxedGeneratedFiltered);
      selected = selectDiversifiedCandidates(candidateUniverse, categories, rules);
      if (!selected.length) continue;

      planned = applyPortfolioSizing(selected, maxDailyRiskUsd, mode);
      await persistCandidateDecisions({
        runId,
        mode,
        executeRequested: input.execute,
        candidates: planned,
        source: `automation/throughput-recovery-step-${step}`,
      }).catch(() => {
        warnings.push(`Storage warning: failed to persist throughput recovery step ${step}.`);
      });
      actionable = actionableCandidates(planned, mode);
      warnings.push(
        `Throughput recovery step ${step} applied: expanded candidate pool with relaxed thresholds to increase trade volume.`,
      );

      if (actionable.length >= targetActionable) break;
    }

    if (actionable.length < targetActionable) {
      warnings.push(
        `Actionable trades remained below throughput target (${actionable.length}/${targetActionable}) after relaxation passes.`,
      );
    }
  }

  if (controls.exploratoryFallbackEnabled && actionable.length < targetActionable) {
    const exploratoryBoostRaw = buildExploratoryCandidates(
      markets,
      categories,
      accountBalanceUsd,
      mode,
      controls,
      inferredRegime,
      maxDailyRiskUsd,
    ).filter((candidate) => isBuyVerdict(candidate.verdict) && candidate.expectedValuePerDollarRisked > 0);
    const exploratoryBoostFilter = filterExistingPositionCandidates(exploratoryBoostRaw, openPositionConstraint, controls);
    if (exploratoryBoostFilter.replacementDecisions.length) {
      await persistReplacementDecisions({
        runId,
        mode,
        decisions: exploratoryBoostFilter.replacementDecisions,
        source: "automation/exploratory-boost-replacements",
      }).catch(() => undefined);
    }
    const exploratoryBoost = exploratoryBoostFilter.filtered;

    if (exploratoryBoost.length) {
      candidateUniverse = mergeCandidateUniverse(candidateUniverse, exploratoryBoost);
      selected = selectDiversifiedCandidates(candidateUniverse, categories, rules);
      planned = applyPortfolioSizing(selected, maxDailyRiskUsd, mode);
      await persistCandidateDecisions({
        runId,
        mode,
        executeRequested: input.execute,
        candidates: planned,
        source: "automation/exploratory-boost",
      }).catch(() => {
        warnings.push("Storage warning: failed to persist exploratory boost decisions.");
      });
      actionable = actionableCandidates(planned, mode);
      warnings.push(
        `Exploratory BUY boost applied: added ${exploratoryBoost.length} positive-EV fallback candidates to improve execution throughput.`,
      );
    }
  }

  const queueByKey = new Map<string, PredictionCandidate>();
  for (const candidate of planned) {
    queueByKey.set(candidateKey(candidate), candidate);
  }

  if (!actionable.length) {
    const oneContractFallback = [...planned]
      .filter((candidate) => isBuyVerdict(candidate.verdict) && candidate.expectedValuePerDollarRisked > 0)
      .sort((a, b) => candidateUtilityScore(b, rules) - candidateUtilityScore(a, rules))[0];

    if (oneContractFallback) {
      const fallbackContracts = candidateContractStep(oneContractFallback);
      const oneContractStake = Number(candidateUnitStake(oneContractFallback).toFixed(4));
      const emergencyReserve = Number(Math.max(0.2, accountBalanceUsd * 0.2).toFixed(2));
      if (oneContractStake > 0 && oneContractStake <= accountBalanceUsd && oneContractStake <= emergencyReserve) {
        const fallbackCandidate = {
          ...oneContractFallback,
          recommendedContracts: fallbackContracts,
          recommendedStakeUsd: oneContractStake,
          executionMessage:
            "Minimum-step fallback: allocated the smallest valid contract size because risk-cap rounding removed all BUY candidates.",
        };
        queueByKey.set(candidateKey(fallbackCandidate), fallbackCandidate);
        actionable = [fallbackCandidate];
        warnings.push("Minimum-step fallback activated to preserve signal continuity under tight risk-cap conditions.");
      }
    }
  }

  if (categories.includes("BITCOIN") && !actionable.some((candidate) => candidate.category === "BITCOIN")) {
    const btcCandidates = selected.filter(
      (candidate) =>
        candidate.category === "BITCOIN" &&
        isBuyVerdict(candidate.verdict) &&
        candidate.expectedValuePerDollarRisked > 0,
    );
    const btcMainstay = btcCandidates.length
      ? [...btcCandidates].sort((a, b) => bitcoinMainstayScore(b) - bitcoinMainstayScore(a))[0]
      : null;

    if (btcMainstay) {
      const fallbackContracts = candidateContractStep(btcMainstay);
      const oneContractStake = Number(candidateUnitStake(btcMainstay).toFixed(4));
      const mainstayReserve = Number(Math.max(0.35, accountBalanceUsd * 0.35).toFixed(2));

      if (oneContractStake > 0 && oneContractStake <= accountBalanceUsd && oneContractStake <= mainstayReserve) {
        const overrideCandidate = {
          ...btcMainstay,
          recommendedContracts: fallbackContracts,
          recommendedStakeUsd: oneContractStake,
          executionMessage:
            "BTC mainstay override: minimum valid BTC contract step allocated because risk-cap rounding produced zero BTC exposure.",
        };
        queueByKey.set(candidateKey(overrideCandidate), overrideCandidate);
        actionable = [...actionable, overrideCandidate];
        warnings.push(
          "BTC mainstay override activated: allocated the minimum valid BTC contract step despite tight risk-cap rounding.",
        );
      }
    }
  }

  if (categories.includes("BITCOIN") && availableBitcoinMarkets === 0) {
    warnings.push("No open bitcoin contracts were discovered in the current market scan window.");
  }
  if (categories.includes("BITCOIN") && availableBitcoinMarkets > 0 && availableBitcoinMicroMarkets === 0) {
    warnings.push("No <=60m bitcoin contracts found; fallback selected nearest-horizon BTC market.");
  }
  if (categories.includes("BITCOIN") && !actionable.some((candidate) => candidate.category === "BITCOIN")) {
    warnings.push("No BTC candidate survived current execution gates this cycle.");
  }
  if (!actionable.length) {
    warnings.push("No execution-eligible BUY candidates after verdict and risk-cap filters; no orders will be placed.");
  }

  let executedStake = 0;
  const kalshi = kalshiConnectionStatus();
  // Allow live execution even when balance endpoint is temporarily unavailable.
  // Sizing will use fallback balance in that case.
  const canExecuteLive = input.execute && kalshi.connected && accountBalanceUsd > 0;
  const exchangeClusterStakeLimitUsd = maxDailyRiskUsd * CLUSTER_LIMIT_SHARE_BY_MODE[mode];
  let clusterGuards = new Map<string, ClusterGuardResult>();

  if (canExecuteLive && actionable.length) {
    try {
      const guardSpecs = deriveClusterGuardSpecs({
        actionable,
        clusterStakeLimitUsd: exchangeClusterStakeLimitUsd,
        executionHealthPenalty: executionHealth.markoutPenalty,
      });
      clusterGuards = await ensureClusterOrderGuards(guardSpecs);
      for (const guard of clusterGuards.values()) {
        warnings.push(...guard.warnings);
        if (guard.triggered) {
          warnings.push(
            `Exchange hard-brake active for cluster ${guard.clusterKey}: order group ${guard.orderGroupId ?? "unassigned"} is blocking new orders this cycle.`,
          );
        }
      }
    } catch (error) {
      warnings.push(`Order-group guard setup failed: ${(error as Error).message}`);
    }
  }

  const executedCandidates: PredictionCandidate[] = [];
  const actionableKeys = new Set(actionable.map((candidate) => candidateKey(candidate)));
  const executionQueue = [...queueByKey.values()];
  const executionMetadata = {
    bootstrapMode,
    executionHealthRegime: executionHealth.regime,
    executionHealthPenalty: Number(executionHealth.markoutPenalty.toFixed(6)),
  };
  const shadowBaselines = buildShadowBaselineSummaries({
    mode,
    selected,
    planned: executionQueue,
    actionable,
    maxDailyRiskUsd,
  });
  await persistShadowBaselines({
    runId,
    mode,
    baselines: shadowBaselines,
    source: "automation/shadow-baselines",
  }).catch(() => {
    warnings.push("Storage warning: failed to persist shadow baseline comparisons.");
  });
  const candidateByKey = new Map(executionQueue.map((candidate) => [candidateKey(candidate), candidate] as const));
  const orderMaintenanceDecisions = controls.orderMaintenanceEnabled
    ? existingOrders
        .filter((order) => {
          const status = order.status.trim().toLowerCase();
          return ["resting", "open", "pending", "partially_filled"].includes(status);
        })
        .map((order) =>
          evaluateOrderMaintenance({
            order,
            market: marketsByTicker.get(order.ticker.toUpperCase()),
            challenger: candidateByKey.get(`${order.ticker.toUpperCase()}:${order.side === "yes" ? "YES" : "NO"}`),
            minImprovement: controls.cancelReplaceMinImprovement,
            clusterTriggered: Boolean(
              (candidateByKey.get(`${order.ticker.toUpperCase()}:${order.side === "yes" ? "YES" : "NO"}`)?.riskCluster ?? null) &&
                clusterGuards.get(
                  candidateByKey.get(`${order.ticker.toUpperCase()}:${order.side === "yes" ? "YES" : "NO"}`)?.riskCluster ??
                    "",
                )?.triggered,
            ),
          }),
        )
    : [];
  if (orderMaintenanceDecisions.length) {
    await persistOrderMaintenanceDecisions({
      runId,
      mode,
      decisions: orderMaintenanceDecisions,
      source: "automation/order-maintenance",
    }).catch(() => {
      warnings.push("Storage warning: failed to persist order maintenance decisions.");
    });
  }
  const orderMaintenanceHandledKeys = new Set<string>();
  if (canExecuteLive && controls.orderMaintenanceEnabled) {
    for (const decision of orderMaintenanceDecisions) {
      if (decision.action === "KEEP") continue;
      try {
        await cancelKalshiDemoOrder(decision.orderId);
        if (decision.action === "REPRICE" && decision.suggestedPriceCents !== null) {
          const incumbentOrder = existingOrders.find((order) => order.order_id === decision.orderId);
          if (incumbentOrder) {
            const side: PredictionSide = incumbentOrder.side === "yes" ? "YES" : "NO";
            const count = incumbentOrder.remaining_count ?? incumbentOrder.count;
            await placeKalshiDemoOrder({
              ticker: incumbentOrder.ticker,
              side,
              count,
              limitPriceCents: decision.suggestedPriceCents,
              contractStep: Math.max(0.01, count < 1 ? 0.01 : 1),
              orderGroupId: incumbentOrder.order_group_id,
              clientOrderId: buildAutomationClientOrderId(runId, { ticker: incumbentOrder.ticker, side }, 9000 + orderMaintenanceHandledKeys.size),
            });
            orderMaintenanceHandledKeys.add(`${incumbentOrder.ticker}:${side}`);
          }
        }
      } catch (error) {
        warnings.push(`Order maintenance ${decision.action.toLowerCase()} failed for ${decision.ticker}: ${(error as Error).message}`);
      }
    }
  }

  function withRuntimeGateDiagnostics(candidate: PredictionCandidate): CandidateGateDiagnostic[] {
    return upsertGateDiagnostic(candidate.gateDiagnostics, {
      gate: "BOOTSTRAP_HEALTH",
      passed: bootstrapMode === "ACKED" && executionHealth.regime === "NORMAL",
      observed:
        bootstrapMode === "UNAVAILABLE"
          ? 2
          : bootstrapMode === "EVENT_PRIMED" || executionHealth.regime !== "NORMAL"
            ? 1
            : 0,
      threshold: 0,
      missBy:
        bootstrapMode === "UNAVAILABLE"
          ? 2
          : bootstrapMode === "EVENT_PRIMED" || executionHealth.regime !== "NORMAL"
            ? 1
            : 0,
      unit: "severity",
      detail: `Bootstrap ${bootstrapMode}; execution-health regime ${executionHealth.regime}.`,
    });
  }

  for (const [index, candidate] of executionQueue.entries()) {
    const key = candidateKey(candidate);
    const isActionable = actionableKeys.has(key);
    if (orderMaintenanceHandledKeys.has(key)) {
      executedCandidates.push({
        ...candidate,
        gateDiagnostics: withRuntimeGateDiagnostics(candidate),
        ...executionMetadata,
        simulated: !canExecuteLive,
        executionStatus: "SKIPPED",
        executionMessage: "Handled by stale-order maintenance reprice path.",
      });
      continue;
    }
    if (!isActionable) {
      const minExecutableContracts = candidateContractStep(candidate);
      const nonActionReason =
        !isBuyVerdict(candidate.verdict)
          ? `Non-actionable verdict (${candidate.verdict ?? "WATCHLIST"}): analysis only.`
          : candidate.recommendedContracts < minExecutableContracts || candidate.recommendedStakeUsd <= 0
            ? "Risk-cap rounding left less than the minimum valid contract step."
            : isBuyVerdict(candidate.verdict)
            ? "Filtered out by execution queue constraints."
            : "Non-actionable candidate.";
      executedCandidates.push({
        ...candidate,
        gateDiagnostics: withRuntimeGateDiagnostics(candidate),
        ...executionMetadata,
        simulated: true,
        executionStatus: "SKIPPED",
        executionMessage: nonActionReason,
      });
      continue;
    }

    if (!canExecuteLive) {
      executedCandidates.push({
        ...candidate,
        gateDiagnostics: withRuntimeGateDiagnostics(candidate),
        ...executionMetadata,
        simulated: true,
        executionStatus: "SKIPPED",
        executionMessage: input.execute
          ? "Live execution unavailable (check Kalshi credentials and funded demo balance); ran in simulation."
          : "Simulation mode selected.",
      });
      continue;
    }

    const clusterKey = candidate.riskCluster ?? candidate.category;
    const clusterGuard = clusterGuards.get(clusterKey);
    if (!clusterGuard) {
      executedCandidates.push({
        ...candidate,
        gateDiagnostics: upsertGateDiagnostic(withRuntimeGateDiagnostics(candidate), {
          gate: "ORDER_GROUP_BRAKE",
          passed: false,
          observed: 1,
          threshold: 0,
          missBy: 1,
          unit: "count",
          detail: `Missing exchange hard-brake guard for cluster ${clusterKey}.`,
        }),
        ...executionMetadata,
        simulated: true,
        executionStatus: "SKIPPED",
        executionMessage: `Missing exchange hard-brake guard for cluster ${clusterKey}; live order blocked.`,
      });
      continue;
    }
    if (clusterGuard.triggered) {
      executedCandidates.push({
        ...candidate,
        gateDiagnostics: upsertGateDiagnostic(withRuntimeGateDiagnostics(candidate), {
          gate: "ORDER_GROUP_BRAKE",
          passed: false,
          observed: 1,
          threshold: 0,
          missBy: 1,
          unit: "count",
          detail: `Order group ${clusterGuard.orderGroupId ?? "unassigned"} is triggered for cluster ${clusterKey}.`,
        }),
        ...executionMetadata,
        simulated: true,
        executionStatus: "SKIPPED",
        executionMessage: `Exchange hard-brake active for cluster ${clusterKey} via order group ${clusterGuard.orderGroupId ?? "unassigned"}.`,
      });
      continue;
    }
    if (!clusterGuard.orderGroupId) {
      executedCandidates.push({
        ...candidate,
        gateDiagnostics: upsertGateDiagnostic(withRuntimeGateDiagnostics(candidate), {
          gate: "ORDER_GROUP_BRAKE",
          passed: false,
          observed: 1,
          threshold: 0,
          missBy: 1,
          unit: "count",
          detail: `Cluster ${clusterKey} did not receive an order_group_id.`,
        }),
        ...executionMetadata,
        simulated: true,
        executionStatus: "SKIPPED",
        executionMessage: `Cluster ${clusterKey} did not receive an order_group_id; live order blocked.`,
      });
      continue;
    }

    try {
      if (candidate.incumbentComparison?.accepted && candidate.incumbentComparison.action === "REPLACE_ORDER" && candidate.incumbentComparison.incumbentOrderId) {
        await cancelKalshiDemoOrder(candidate.incumbentComparison.incumbentOrderId);
      }
      const clientOrderId = buildAutomationClientOrderId(runId, candidate, index);
      const placement = await placeKalshiDemoOrder({
        ticker: candidate.ticker,
        side: candidate.side,
        count: candidate.recommendedContracts,
        limitPriceCents: candidate.limitPriceCents,
        contractStep: candidate.contractStep,
        orderGroupId: clusterGuard.orderGroupId,
        clientOrderId,
      });
      const placementRecord =
        placement && typeof placement === "object" && "order" in placement && placement.order && typeof placement.order === "object"
          ? (placement.order as Record<string, unknown>)
          : (placement as Record<string, unknown>);
      const executionOrderId = String(placementRecord.order_id ?? placementRecord.id ?? "").trim() || undefined;
      const executionClientOrderId =
        String(placementRecord.client_order_id ?? clientOrderId ?? "").trim() || clientOrderId;

      executedStake += candidate.recommendedStakeUsd;

      executedCandidates.push({
        ...candidate,
        gateDiagnostics: withRuntimeGateDiagnostics(candidate),
        ...executionMetadata,
        simulated: false,
        executionStatus: "PLACED",
        executionOrderId,
        executionClientOrderId,
        executionMessage: `Order placed on Kalshi demo (${candidate.recommendedContracts} contracts, group ${clusterGuard.orderGroupId}).`,
      });
    } catch (error) {
      const clientOrderId = buildAutomationClientOrderId(runId, candidate, index);
      executedCandidates.push({
        ...candidate,
        gateDiagnostics: withRuntimeGateDiagnostics(candidate),
        ...executionMetadata,
        simulated: true,
        executionStatus: "FAILED",
        executionClientOrderId: clientOrderId,
        executionMessage: (error as Error).message,
      });
    }
  }

  await persistCandidateDecisions({
    runId,
    mode,
    executeRequested: input.execute,
    candidates: executedCandidates,
    source: "automation/executed-candidates",
  }).catch(() => {
    warnings.push("Storage warning: failed to persist executed candidate decisions.");
  });
  const signalOverlays = executedCandidates
    .filter((candidate) => candidate.silentClock || candidate.leadLag)
    .map((candidate) => ({
      ticker: candidate.ticker,
      side: candidate.side,
      silentClock: candidate.silentClock,
      leadLag: candidate.leadLag,
    }));
  if (signalOverlays.length) {
    await persistSignalOverlays({
      runId,
      mode,
      overlays: signalOverlays,
      source: "automation/signal-overlays",
    }).catch(() => {
      warnings.push("Storage warning: failed to persist signal overlays.");
    });
  }

  const finalBalances = await getKalshiDemoBalancesUsd().catch(() => ({ cashUsd: null, portfolioUsd: null }));
  await persistKalshiBalanceSnapshot({
    balanceUsd: finalBalances.cashUsd ?? finalBalances.portfolioUsd ?? null,
    cashUsd: finalBalances.cashUsd ?? finalBalances.portfolioUsd ?? null,
    portfolioUsd: finalBalances.portfolioUsd ?? finalBalances.cashUsd ?? null,
    source: "automation/post-run-balance",
  }).catch(() => {
    warnings.push("Storage warning: failed to persist post-run balance snapshot.");
  });

  if (input.execute && !kalshi.connected) {
    warnings.push("Execute requested, but Kalshi trading credentials are missing; actions were simulated only.");
  }
  if (input.execute && kalshi.connected && !account.fromBroker) {
    warnings.push("Kalshi balance read failed; using fallback balance sizing while still attempting live execution.");
  }
  if (input.execute && kalshi.connected && accountBalanceUsd <= 0) {
    warnings.push("Execute requested, but Kalshi demo balance is zero; fund demo account to place orders.");
  }

  if (actionable.length < categories.length) {
    warnings.push("Could not find high-confidence opportunities in every requested category this cycle.");
  }

  const rankingUniverse = actionable.length ? actionable : [];
  const portfolioRanking = mode === "AI" ? buildPortfolioRanking(rankingUniverse) : undefined;

  return {
    mode,
    executed: canExecuteLive,
    simulated: !canExecuteLive,
    provider: canExecuteLive ? "KALSHI_DEMO" : "SIMULATED",
    accountBalanceUsd: Number(accountBalanceUsd.toFixed(2)),
    maxDailyRiskUsd,
    totalStakePlannedUsd: Number(actionable.reduce((sum, item) => sum + item.recommendedStakeUsd, 0).toFixed(2)),
    totalStakePlacedUsd: Number(executedStake.toFixed(2)),
    candidates: executedCandidates,
    portfolioRanking,
    shadowBaselines,
    warnings,
    inferredRegime,
    controls,
    generatedAt: new Date().toISOString(),
  };
}
