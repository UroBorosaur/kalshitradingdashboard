import type {
  AutomationMode,
  CandidateVerdict,
  CandidateGateDiagnostic,
  CalibrationMethod,
  ExecutionBootstrapMode,
  ExecutionHealthRegime,
  ExecutionPlanRole,
  FalseNegativeLearningOutput,
  BitcoinMicroLongshotSetup,
  LeadLagSignal,
  LiquidationDecision,
  OrderMaintenanceDecision,
  OpportunityType,
  PredictionCandidate,
  PredictionCategory,
  ProbabilityTransform,
  ReplacementDecision,
  ShadowBaselineProfile,
  SilentClockContribution,
  SportsUnderdogLongshotSetup,
  WatchlistEvent,
} from "@/lib/prediction/types";

export type PredictionStorageLayer = "raw" | "derived";
export type PredictionStorageStream =
  | "stream_events"
  | "fills"
  | "orders"
  | "balances"
  | "positions"
  | "quotes"
  | "orderbook_events"
  | "candidate_decisions"
  | "shadow_baselines"
  | "replacement_decisions"
  | "order_actions"
  | "watchlist_events"
  | "learning_outputs"
  | "liquidation_decisions"
  | "signal_overlays"
  | "resolutions"
  | "markouts";

export interface PredictionStorageEnvelope<TPayload> {
  id: string;
  stream: PredictionStorageStream;
  layer: PredictionStorageLayer;
  schemaVersion: number;
  recordedAt: string;
  source: string;
  entityKey: string;
  payload: TPayload;
}

export interface StoredKalshiFillEvent {
  fillId: string;
  orderId: string;
  ticker: string;
  side: "yes" | "no";
  action: string;
  count: number;
  yesPriceCents?: number;
  noPriceCents?: number;
  createdTime?: string;
}

export interface StoredKalshiStreamEvent {
  eventType: string;
  channel?: string;
  sid?: number;
  seq?: number;
  marketTicker?: string;
  marketTickers?: string[];
  controlFrame?: "ping" | "pong";
  raw: unknown;
}

export interface StoredKalshiOrderEvent {
  orderId: string;
  clientOrderId?: string;
  orderGroupId?: string;
  ticker: string;
  title?: string;
  marketStatus?: string;
  side: "yes" | "no";
  action: string;
  status: string;
  type?: string;
  count: number;
  remainingCount?: number;
  yesPriceCents?: number;
  noPriceCents?: number;
  createdTime?: string;
  expirationTime?: string;
  lastUpdateTime?: string;
}

export interface StoredKalshiBalanceEvent {
  balanceUsd?: number | null;
  cashUsd?: number | null;
  portfolioUsd?: number | null;
}

export interface StoredKalshiPositionEvent {
  ticker: string;
  positionFp: string;
  marketExposureDollars?: string;
  totalTradedDollars?: string;
  realizedPnlDollars?: string;
  feesPaidDollars?: string;
  lastUpdatedTs?: string;
  restingOrdersCount?: number;
}

export interface StoredKalshiQuoteEvent {
  ticker: string;
  title?: string;
  marketStatus?: string;
  category?: PredictionCategory;
  eventTicker?: string;
  closeTime?: string | null;
  expectedExpirationTime?: string | null;
  latestExpirationTime?: string | null;
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  lastPrice: number | null;
  volume?: number;
  openInterest?: number;
  liquidityDollars?: number;
  tickSize?: number;
  settlementResult?: "yes" | "no";
  settlementPrice?: number | null;
}

export interface StoredOrderbookEvent {
  ticker: string;
  title?: string;
  category: PredictionCategory;
  eventTicker?: string;
  eventType: "snapshot" | "delta";
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  yesBidSize: number;
  yesAskSize: number;
  noBidSize: number;
  noAskSize: number;
  lastPrice: number | null;
  volume: number;
  openInterest: number;
  liquidityDollars: number;
  tickSize: number;
  status: string;
}

export interface StoredCandidateDecisionEvent {
  runId: string;
  mode: AutomationMode;
  executeRequested: boolean;
  ticker: string;
  title: string;
  category: PredictionCategory;
  side: "YES" | "NO";
  verdict?: CandidateVerdict;
  opportunityType?: OpportunityType;
  marketProb: number;
  rawModelProb?: number;
  modelProb: number;
  rulebookProb?: number;
  rulebookProbLower?: number;
  rulebookProbUpper?: number;
  coherentFairProb?: number;
  edge: number;
  executionAdjustedEdge?: number;
  confidence: number;
  recommendedStakeUsd: number;
  recommendedContracts: number;
  limitPriceCents: number;
  probabilityTransform?: ProbabilityTransform;
  calibrationMethod?: CalibrationMethod;
  expertWeights?: Array<{
    expert: string;
    weight: number;
    probability: number;
  }>;
  compositeScore?: number;
  portfolioWeight?: number;
  netAlphaUsd?: number;
  feeEstimateUsd?: number;
  incentiveRewardUsd?: number;
  executionAlphaUsd?: number;
  uncertaintyWidth?: number;
  toxicityScore?: number;
  riskCluster?: string;
  incumbentComparison?: ReplacementDecision;
  replacementScoreDelta?: number;
  watchlistState?: PredictionCandidate["watchlistState"];
  silentClock?: SilentClockContribution;
  leadLag?: LeadLagSignal;
  liquidationRecommendation?: LiquidationDecision;
  orderMaintenance?: OrderMaintenanceDecision;
  btcMicroLongshot?: BitcoinMicroLongshotSetup;
  sportsUnderdogLongshot?: SportsUnderdogLongshotSetup;
  executionStatus?: "PLACED" | "SKIPPED" | "FAILED";
  executionMessage?: string;
  executionOrderId?: string;
  executionClientOrderId?: string;
  bootstrapMode?: ExecutionBootstrapMode;
  executionHealthRegime?: ExecutionHealthRegime;
  executionHealthPenalty?: number;
  strategyPerformanceBoost?: number;
  strategyPerformanceReasons?: string[];
  strategyTags?: string[];
  executionPlan?: {
    limitPriceCents: number;
    patienceHours: number;
    fillProbability: number;
    expectedExecutionValueUsd: number;
    feeUsd: number;
    role: ExecutionPlanRole;
    quoteWidening?: number;
    staleHazard?: number;
    inventorySkew?: number;
  };
  gateDiagnostics?: CandidateGateDiagnostic[];
  rationale: string[];
}

export interface StoredResolutionEvent {
  ticker: string;
  title?: string;
  status: string;
  settlementResult?: "yes" | "no";
  settlementPrice?: number | null;
  resolvedAt?: string;
}

export interface StoredShadowBaselineEvent {
  runId: string;
  mode: AutomationMode;
  profile: ShadowBaselineProfile;
  label: string;
  description: string;
  candidateCount: number;
  actionables: number;
  plannedStakeUsd: number;
  avgExecutionAdjustedEdge: number | null;
  expectedNetAlphaUsd: number | null;
  expectedNetMarkoutAfterFeesUsd: number | null;
  expectedExpiryPnlUsd: number | null;
  fillRateEstimate: number | null;
  cancellationRateEstimate: number | null;
  adverseSelectionRate: number | null;
  topTickers: string[];
  notes: string[];
}

export interface StoredReplacementDecisionEvent extends ReplacementDecision {
  runId: string;
  mode: AutomationMode;
}

export interface StoredOrderMaintenanceEvent extends OrderMaintenanceDecision {
  runId: string;
  mode: AutomationMode;
}

export interface StoredWatchlistEvent extends WatchlistEvent {
  runId?: string;
  mode?: AutomationMode;
}

export interface StoredLearningOutputEvent extends FalseNegativeLearningOutput {
  runId?: string;
  mode?: AutomationMode;
}

export interface StoredLiquidationDecisionEvent extends LiquidationDecision {
  runId: string;
  mode: AutomationMode;
}

export interface StoredSignalOverlayEvent {
  runId: string;
  mode: AutomationMode;
  ticker: string;
  side: "YES" | "NO";
  silentClock?: SilentClockContribution;
  leadLag?: LeadLagSignal;
}

export type MarkoutHorizonKey = "5s" | "30s" | "2m" | "10m" | "expiry";

export interface StoredMarkoutEvent {
  fillId: string;
  ticker: string;
  side: "yes" | "no";
  fillPrice: number;
  fillTs: number;
  horizon: MarkoutHorizonKey;
  targetTs: number;
  observedTs: number;
  mark: number;
  markout: number;
}

export interface PredictionReplayDay {
  streamEvents: Array<PredictionStorageEnvelope<StoredKalshiStreamEvent>>;
  fills: Array<PredictionStorageEnvelope<StoredKalshiFillEvent>>;
  orders: Array<PredictionStorageEnvelope<StoredKalshiOrderEvent>>;
  balances: Array<PredictionStorageEnvelope<StoredKalshiBalanceEvent>>;
  positions: Array<PredictionStorageEnvelope<StoredKalshiPositionEvent>>;
  quotes: Array<PredictionStorageEnvelope<StoredKalshiQuoteEvent>>;
  orderbookEvents: Array<PredictionStorageEnvelope<StoredOrderbookEvent>>;
  candidateDecisions: Array<PredictionStorageEnvelope<StoredCandidateDecisionEvent>>;
  shadowBaselines: Array<PredictionStorageEnvelope<StoredShadowBaselineEvent>>;
  replacementDecisions: Array<PredictionStorageEnvelope<StoredReplacementDecisionEvent>>;
  orderActions: Array<PredictionStorageEnvelope<StoredOrderMaintenanceEvent>>;
  watchlistEvents: Array<PredictionStorageEnvelope<StoredWatchlistEvent>>;
  learningOutputs: Array<PredictionStorageEnvelope<StoredLearningOutputEvent>>;
  liquidationDecisions: Array<PredictionStorageEnvelope<StoredLiquidationDecisionEvent>>;
  signalOverlays: Array<PredictionStorageEnvelope<StoredSignalOverlayEvent>>;
  resolutions: Array<PredictionStorageEnvelope<StoredResolutionEvent>>;
  markouts: Array<PredictionStorageEnvelope<StoredMarkoutEvent>>;
}

export type PredictionReplayEvent =
  | PredictionStorageEnvelope<StoredKalshiStreamEvent>
  | PredictionStorageEnvelope<StoredKalshiFillEvent>
  | PredictionStorageEnvelope<StoredKalshiOrderEvent>
  | PredictionStorageEnvelope<StoredKalshiBalanceEvent>
  | PredictionStorageEnvelope<StoredKalshiPositionEvent>
  | PredictionStorageEnvelope<StoredKalshiQuoteEvent>
  | PredictionStorageEnvelope<StoredOrderbookEvent>
  | PredictionStorageEnvelope<StoredCandidateDecisionEvent>
  | PredictionStorageEnvelope<StoredShadowBaselineEvent>
  | PredictionStorageEnvelope<StoredReplacementDecisionEvent>
  | PredictionStorageEnvelope<StoredOrderMaintenanceEvent>
  | PredictionStorageEnvelope<StoredWatchlistEvent>
  | PredictionStorageEnvelope<StoredLearningOutputEvent>
  | PredictionStorageEnvelope<StoredLiquidationDecisionEvent>
  | PredictionStorageEnvelope<StoredSignalOverlayEvent>
  | PredictionStorageEnvelope<StoredResolutionEvent>
  | PredictionStorageEnvelope<StoredMarkoutEvent>;

export function toStoredCandidateDecisionPayload(
  runId: string,
  mode: AutomationMode,
  executeRequested: boolean,
  candidate: PredictionCandidate,
): StoredCandidateDecisionEvent {
  return {
    runId,
    mode,
    executeRequested,
    ticker: candidate.ticker,
    title: candidate.title,
    category: candidate.category,
    side: candidate.side,
    verdict: candidate.verdict,
    opportunityType: candidate.opportunityType,
    marketProb: candidate.marketProb,
    rawModelProb: candidate.rawModelProb,
    modelProb: candidate.modelProb,
    rulebookProb: candidate.rulebookProb,
    rulebookProbLower: candidate.rulebookProbLower,
    rulebookProbUpper: candidate.rulebookProbUpper,
    coherentFairProb: candidate.coherentFairProb,
    edge: candidate.edge,
    executionAdjustedEdge: candidate.executionAdjustedEdge,
    confidence: candidate.confidence,
    recommendedStakeUsd: candidate.recommendedStakeUsd,
    recommendedContracts: candidate.recommendedContracts,
    limitPriceCents: candidate.limitPriceCents,
    probabilityTransform: candidate.probabilityTransform,
    calibrationMethod: candidate.calibrationMethod,
    expertWeights: candidate.expertWeights?.map((row) => ({
      expert: row.expert,
      weight: row.weight,
      probability: row.probability,
    })),
    compositeScore: candidate.compositeScore,
    portfolioWeight: candidate.portfolioWeight,
    netAlphaUsd: candidate.netAlphaUsd,
    feeEstimateUsd: candidate.feeEstimateUsd,
    incentiveRewardUsd: candidate.incentiveRewardUsd,
    executionAlphaUsd: candidate.executionAlphaUsd,
    uncertaintyWidth: candidate.uncertaintyWidth,
    toxicityScore: candidate.toxicityScore,
    riskCluster: candidate.riskCluster,
    incumbentComparison: candidate.incumbentComparison,
    replacementScoreDelta: candidate.replacementScoreDelta,
    watchlistState: candidate.watchlistState,
    silentClock: candidate.silentClock,
    leadLag: candidate.leadLag,
    liquidationRecommendation: candidate.liquidationRecommendation,
    orderMaintenance: candidate.orderMaintenance,
    btcMicroLongshot: candidate.btcMicroLongshot,
    sportsUnderdogLongshot: candidate.sportsUnderdogLongshot,
    executionStatus: candidate.executionStatus,
    executionMessage: candidate.executionMessage,
    executionOrderId: candidate.executionOrderId,
    executionClientOrderId: candidate.executionClientOrderId,
    bootstrapMode: candidate.bootstrapMode,
    executionHealthRegime: candidate.executionHealthRegime,
    executionHealthPenalty: candidate.executionHealthPenalty,
    strategyPerformanceBoost: candidate.strategyPerformanceBoost,
    strategyPerformanceReasons: candidate.strategyPerformanceReasons,
    strategyTags: candidate.strategyTags,
    executionPlan: candidate.executionPlan
      ? {
          limitPriceCents: candidate.executionPlan.limitPriceCents,
          patienceHours: candidate.executionPlan.patienceHours,
          fillProbability: candidate.executionPlan.fillProbability,
          expectedExecutionValueUsd: candidate.executionPlan.expectedExecutionValueUsd,
          feeUsd: candidate.executionPlan.feeUsd,
          role: candidate.executionPlan.role,
          quoteWidening: candidate.executionPlan.quoteWidening,
          staleHazard: candidate.executionPlan.staleHazard,
          inventorySkew: candidate.executionPlan.inventorySkew,
        }
        : undefined,
    gateDiagnostics: candidate.gateDiagnostics?.map((diagnostic) => ({
      gate: diagnostic.gate,
      passed: diagnostic.passed,
      observed: diagnostic.observed,
      threshold: diagnostic.threshold,
      missBy: diagnostic.missBy,
      unit: diagnostic.unit,
      detail: diagnostic.detail,
    })),
    rationale: candidate.rationale,
  };
}
