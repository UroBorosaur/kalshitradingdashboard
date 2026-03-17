export type AutomationMode = "CONSERVATIVE" | "MIXED" | "AGGRESSIVE" | "AI";

export type PredictionCategory = "BITCOIN" | "SPORTS" | "POLITICS" | "ESPORTS" | "WEATHER" | "STOCKS" | "MACRO" | "OTHER";

export type PredictionSide = "YES" | "NO";
export type OpportunityType = "TRADE" | "WATCHLIST" | "HEDGE" | "PASS";
export type CandidateVerdict = "BUY_YES" | "BUY_NO" | "WATCHLIST" | "PASS";
export type ExecutionPlanRole = "TAKER" | "MAKER" | "MAKER_FEE";
export type ProbabilityTransform = "SIGMOID" | "SOFTMAX" | "SPARSEMAX" | "ENTMAX15";
export type CalibrationMethod = "NONE" | "TEMPERATURE" | "ISOTONIC_STRUCTURAL";
export type ExecutionBootstrapMode = "ACKED" | "EVENT_PRIMED" | "UNAVAILABLE";
export type ExecutionHealthRegime = "NORMAL" | "TIGHTENED" | "DEFENSIVE";
export type CandidateGateKey =
  | "CONFIDENCE_FLOOR"
  | "EXECUTION_EDGE"
  | "TOXICITY"
  | "UNCERTAINTY_WIDTH"
  | "CLUSTER_CAP"
  | "ORDER_GROUP_BRAKE"
  | "POSITION_ORDER_CONFLICT"
  | "BOOTSTRAP_HEALTH";
export type StrategyTag =
  | "FAVORITE_LONGSHOT_BIAS"
  | "SETTLEMENT_SPEC_ARBITRAGE"
  | "STRIKE_LADDER_COHERENCE"
  | "CALENDAR_TERM_STRUCTURE"
  | "CORRELATION_DISPERSION"
  | "RETAIL_FLOW_FADE"
  | "FEE_ROUTING"
  | "INCENTIVE_FARMING"
  | "CAPITAL_VELOCITY"
  | "EXECUTION_ALPHA"
  | "PHYSICAL_MEASURE_BRIDGE"
  | "CONSTRAINED_LATTICE"
  | "WEATHER_EMOS_EVT"
  | "HAWKES_INFO_FLOW"
  | "QUEUE_REACTIVE_EXECUTION"
  | "PORTFOLIO_CVAR"
  | "COMBO_COPULA"
  | "SYNTHETIC_HEDGE_RV"
  | "CROSS_PLATFORM_BASIS"
  | "SWITCHING_STATE_SPACE"
  | "SOFTMAX_STRUCTURAL"
  | "SPARSEMAX_STRUCTURAL"
  | "ENTMAX_STRUCTURAL"
  | "MIXTURE_OF_EXPERTS"
  | "TEMPERATURE_CALIBRATED"
  | "SILENT_CLOCK_DECAY"
  | "LEAD_LAG_OVERLAY";

export type ReplacementDecisionAction = "KEEP_INCUMBENT" | "REPLACE_ORDER" | "RECOMMEND_POSITION_SWAP";
export type OrderMaintenanceAction = "KEEP" | "REPRICE" | "CANCEL";
export type WatchlistEventType = "ADDED" | "UPDATED" | "PROMOTED" | "RESOLVED" | "EXPIRED";
export type LiquidationAction = "HOLD" | "TRIM" | "FLATTEN";

export interface ReplacementDecision {
  candidateKey: string;
  ticker: string;
  title: string;
  category: PredictionCategory;
  side: PredictionSide;
  incumbentSource: "ORDER" | "POSITION";
  incumbentConflictType: "SAME_SIDE_ORDER" | "MARKET_ORDER" | "SAME_SIDE_POSITION" | "MARKET_POSITION";
  incumbentTicker: string;
  incumbentSide: PredictionSide;
  incumbentOrderId?: string;
  incumbentUtility: number;
  challengerUtility: number;
  replacementCost: number;
  queueResetPenalty: number;
  additionalClusterRiskPenalty: number;
  replacementScoreDelta: number;
  threshold: number;
  accepted: boolean;
  action: ReplacementDecisionAction;
  reason: string;
  clusterKey?: string;
}

export interface OrderMaintenanceDecision {
  orderId: string;
  ticker: string;
  title?: string;
  category?: PredictionCategory;
  side: PredictionSide;
  orderGroupId?: string;
  action: OrderMaintenanceAction;
  currentPriceCents: number | null;
  suggestedPriceCents: number | null;
  evKeep: number;
  evReprice: number;
  evCancel: number;
  expectedImprovement: number;
  threshold: number;
  staleHazard: number;
  toxicityScore: number;
  reservationDrift: number;
  queueResetPenalty: number;
  challengerOpportunityUsd: number;
  reason: string;
  riskCluster?: string;
}

export interface WatchlistState {
  key: string;
  ticker: string;
  title: string;
  category: PredictionCategory;
  side: PredictionSide;
  firstSeenAt: string;
  lastSeenAt: string;
  cyclesObserved: number;
  bestEdge: number;
  bestExecutionAdjustedEdge: number;
  bestConfidence: number;
  bestCompositeScore: number | null;
  lastMarketProb: number;
  lastQuoteDrift: number | null;
  lastToxicity: number | null;
  lastUncertainty: number | null;
  blockingReasons: string[];
  failedGates: CandidateGateDiagnostic[];
  promotedCount: number;
  lastPromotionAt?: string;
  resolved: boolean;
}

export interface WatchlistEvent {
  key: string;
  ticker: string;
  title: string;
  category: PredictionCategory;
  side: PredictionSide;
  type: WatchlistEventType;
  promotionScore?: number;
  avgWatchlistHours?: number;
  quoteDrift?: number | null;
  edge?: number;
  executionAdjustedEdge?: number | null;
  confidence?: number;
  toxicityScore?: number | null;
  uncertaintyWidth?: number | null;
  failedGates?: CandidateGateDiagnostic[];
  blockingReasons?: string[];
  reason: string;
}

export interface WatchlistPromotionDecision {
  key: string;
  ticker: string;
  side: PredictionSide;
  promotionScore: number;
  threshold: number;
  promoted: boolean;
  reason: string;
  avgWatchlistHours: number;
}

export interface GateLearningRecommendation {
  gate: CandidateGateKey;
  label: string;
  unit: "probability" | "usd" | "count" | "severity";
  sampleCount: number;
  hitRate: number | null;
  profitableRate: number | null;
  avgCounterfactualPnlUsd: number | null;
  avgExpiryDrift: number | null;
  proposedDelta: number;
  boundedDelta: number;
  reason: string;
  active: boolean;
}

export interface FalseNegativeLearningOutput {
  generatedAt: string;
  lookbackHours: number;
  active: boolean;
  recommendations: GateLearningRecommendation[];
}

export interface LiquidationDecision {
  ticker: string;
  title: string;
  category: PredictionCategory;
  side: PredictionSide;
  contracts: number;
  riskCluster?: string;
  canCloseEarly: boolean;
  timeToResolutionDays: number;
  valueHoldToResolutionUsd: number;
  valueExitNowUsd: number;
  liquidationCostUsd: number;
  expectedMarkToResolution: number;
  spread: number;
  liquidityScore: number;
  liquidationCVaR: number;
  action: LiquidationAction;
  reason: string;
}

export interface SilentClockContribution {
  eligible: boolean;
  checkpointProgress: number;
  decayPenalty: number;
  adjustedProbability: number;
  probabilityDelta?: number;
  scoreContribution?: number | null;
  rationale: string;
}

export interface LeadLagSignal {
  leadTicker: string;
  lagTicker: string;
  horizonSeconds: number;
  signalMagnitude: number;
  confidence: number;
  direction: "UP" | "DOWN";
  adjustedProbability: number;
  probabilityDelta?: number;
  scoreContribution?: number | null;
  rationale: string;
}

export interface OverlayPerformanceSlice {
  decisions: number;
  placed: number;
  fillRate: number | null;
  avgProbabilityContribution: number | null;
  avgScoreContribution: number | null;
  avgExecutionAdjustedEdge: number | null;
  avgMarkout30s: number | null;
  avgMarkoutExpiry: number | null;
  avgExpiryPnlUsd: number | null;
  toxicityOverlapRate: number | null;
  clusterStressOverlapRate: number | null;
}

export interface CandidateGateDiagnostic {
  gate: CandidateGateKey;
  passed: boolean;
  observed: number | null;
  threshold: number | null;
  missBy: number;
  unit: "probability" | "usd" | "count" | "severity";
  detail?: string;
}

export interface PredictionMarketQuote {
  ticker: string;
  title: string;
  subtitle?: string;
  eventTicker?: string;
  category: PredictionCategory;
  closeTime: string | null;
  expectedExpirationTime?: string | null;
  latestExpirationTime?: string | null;
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
  priceLevelStructure?: string;
  priceRanges?: Array<{
    minProbability: number;
    maxProbability: number;
    tickSizeCents: number;
  }>;
  fractionalTradingEnabled?: boolean;
  settlementTimerSeconds: number;
  rulesPrimary?: string;
  rulesSecondary?: string;
  strikeType?: string;
  floorStrike?: number | null;
  notionalValue?: number;
  canCloseEarly: boolean;
  status: string;
}

export interface PredictionCandidate {
  ticker: string;
  title: string;
  category: PredictionCategory;
  side: PredictionSide;
  marketProb: number;
  rawModelProb?: number;
  modelProb: number;
  edge: number;
  executionAdjustedEdge?: number;
  expectedValuePerContract: number;
  expectedValuePerDollarRisked: number;
  confidence: number;
  recommendedStakeUsd: number;
  recommendedContracts: number;
  contractStep?: number;
  limitPriceCents: number;
  rulebookProb?: number;
  rulebookProbLower?: number;
  rulebookProbUpper?: number;
  coherentFairProb?: number;
  feeEstimateUsd?: number;
  incentiveRewardUsd?: number;
  coherenceEdge?: number;
  executionAlphaUsd?: number;
  netAlphaUsd?: number;
  capitalTimeDays?: number;
  compositeScore?: number;
  portfolioWeight?: number;
  liquidationCVaR?: number;
  uncertaintyWidth?: number;
  toxicityScore?: number;
  riskCluster?: string;
  incumbentComparison?: ReplacementDecision;
  replacementScoreDelta?: number;
  watchlistState?: {
    status: "ACTIVE" | "PROMOTED" | "RESOLVED";
    ageHours: number;
    cyclesObserved: number;
    promotionScore?: number;
  };
  silentClock?: SilentClockContribution;
  leadLag?: LeadLagSignal;
  liquidationRecommendation?: LiquidationDecision;
  orderMaintenance?: OrderMaintenanceDecision;
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
  probabilityTransform?: ProbabilityTransform;
  calibrationMethod?: CalibrationMethod;
  expertWeights?: Array<{
    expert: string;
    weight: number;
    probability: number;
  }>;
  strategyTags?: StrategyTag[];
  opportunityType?: OpportunityType;
  verdict?: CandidateVerdict;
  timeToCloseDays?: number;
  strategicBreakdown?: StrategicBreakdown;
  simulated: boolean;
  executionStatus?: "PLACED" | "SKIPPED" | "FAILED";
  executionMessage?: string;
  executionOrderId?: string;
  executionClientOrderId?: string;
  bootstrapMode?: ExecutionBootstrapMode;
  executionHealthRegime?: ExecutionHealthRegime;
  executionHealthPenalty?: number;
}

export interface StrategicBreakdown {
  marketSummary: {
    contract: string;
    marketImpliedProbability: number;
    estimatedTrueProbability: number;
    edge: number;
    confidence1to10: number;
    timeHorizonDays: number;
    liquidityExecutionQuality: "HIGH" | "MEDIUM" | "LOW";
    classification: OpportunityType;
  };
  thesis: {
    coreReason: string;
    mispricingDrivers: string[];
    strongestBullCase: string;
    strongestBearCase: string;
  };
  domainSpecificAnalysis: string[];
  probabilityEngine: {
    baseRate: number;
    prior: number;
    posterior: number;
    bestCase: { probability: number; weight: number };
    baseCase: { probability: number; weight: number };
    worstCase: { probability: number; weight: number };
    keyRepricingVariables: string[];
  };
  marketMicrostructure: {
    spread: number;
    liquidityScore: number;
    efficiency: "EFFICIENT" | "SEMI_EFFICIENT" | "SOFT";
    entryTiming: string;
    scalingAdvice: string;
    manipulationRisk: "LOW" | "MEDIUM" | "HIGH";
  };
  positioningAndRisk: {
    conservativeStakeUsd: number;
    moderateStakeUsd: number;
    aggressiveStakeUsd: number;
    maxLossUsd: number;
    invalidation: string;
    earlyExit: string;
    hedgeIdea: string;
    correlationWarning: string;
  };
  liveUpdateFramework: Array<{
    trigger: string;
    impact: "SMALL" | "MEDIUM" | "MAJOR";
    response: string;
  }>;
  deceptionFilter: string[];
  outputFormat: {
    contract: string;
    marketImpliedProbability: number;
    estimatedTrueProbability: number;
    edge: number;
    confidence: number;
    whyMispriced: string;
    catalysts: string[];
    keyRisks: string[];
    bestEntryApproach: string;
    positionSizingSuggestion: string;
    hedgeIdea: string;
    finalVerdict: CandidateVerdict;
  };
}

export interface RankedSetup {
  contract: string;
  ticker: string;
  category: PredictionCategory;
  edge: number;
  confidenceAdjustedEdge: number;
  confidence: number;
  expectedValuePerDollarRisked: number;
  timeToCloseDays: number;
  verdict: CandidateVerdict;
}

export interface PortfolioRanking {
  highestEv: RankedSetup[];
  safest: RankedSetup[];
  asymmetricLongshots: RankedSetup[];
  trapsToAvoid: Array<{
    contract: string;
    ticker: string;
    reason: string;
  }>;
}

export type ShadowBaselineProfile =
  | "CURRENT_MAKER"
  | "SMART_TAKER"
  | "MAKER_NO_TOXICITY"
  | "MAKER_NO_CLUSTER_CAP";

export interface ShadowBaselineSummary {
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

export interface ReplacementAttributionSummary {
  accepted: number;
  rejected: number;
  avgScoreDelta: number | null;
  avgReplacementCost: number | null;
  recent: ReplacementDecision[];
}

export interface OrderMaintenanceAttributionSummary {
  keep: number;
  reprice: number;
  cancel: number;
  avgExpectedImprovement: number | null;
  recent: OrderMaintenanceDecision[];
}

export interface WatchlistAttributionSummary {
  active: number;
  promotions: number;
  avgWatchlistHours: number | null;
  promotedResolvedCount: number;
  promotedHitRate: number | null;
  neverPromotedResolvedCount: number;
  neverPromotedHitRate: number | null;
  recent: WatchlistEvent[];
}

export interface LiquidationAttributionSummary {
  hold: number;
  trim: number;
  flatten: number;
  avgExitEdgeUsd: number | null;
  recent: LiquidationDecision[];
}

export interface SignalOverlayAttributionSummary {
  silentClockCount: number;
  leadLagCount: number;
  avgSilentClockPenalty: number | null;
  avgLeadLagSignal: number | null;
  silentClockPerformance: OverlayPerformanceSlice;
  leadLagPerformance: OverlayPerformanceSlice;
  recentSilentClock: SilentClockContribution[];
  recentLeadLag: LeadLagSignal[];
}

export interface AutomationRunSummary {
  mode: AutomationMode;
  executed: boolean;
  simulated: boolean;
  provider: "KALSHI_DEMO" | "SIMULATED";
  accountBalanceUsd: number;
  maxDailyRiskUsd: number;
  totalStakePlannedUsd: number;
  totalStakePlacedUsd: number;
  candidates: PredictionCandidate[];
  portfolioRanking?: PortfolioRanking;
  shadowBaselines?: ShadowBaselineSummary[];
  warnings: string[];
  inferredRegime: {
    label: string;
    confidence: number;
  };
  controls?: AutomationControls;
  generatedAt: string;
}

export interface ExecutionAttributionBucket {
  key: string;
  label: string;
  decisions: number;
  placed: number;
  failed: number;
  skipped: number;
  totalFilledContracts: number;
  avgNetAlphaUsd: number | null;
  avgExecutionAdjustedEdge: number | null;
  avgMarkout30s: number | null;
  avgMarkout2m: number | null;
  avgMarkoutExpiry: number | null;
  avgCashDeltaDriftUsd?: number | null;
}

export interface ExecutionCounterfactualBucket {
  key: string;
  label: string;
  resolved: number;
  profitable: number;
  hitRate: number | null;
  avgCounterfactualPnlUsd: number | null;
  totalCounterfactualPnlUsd: number | null;
}

export interface SelectionGateSummary {
  gate: CandidateGateKey;
  label: string;
  count: number;
  unit: "probability" | "usd" | "count" | "severity";
  avgMissBy: number | null;
  maxMissBy: number | null;
}

export interface SelectionGateWaterfallSummary {
  gate: CandidateGateKey;
  label: string;
  unit: "probability" | "usd" | "count" | "severity";
  primaryCount: number;
  secondaryCount: number;
  avgPrimaryMissBy: number | null;
  avgSecondaryMissBy: number | null;
}

export interface SelectionGateCounterfactualSummary {
  gate: CandidateGateKey;
  label: string;
  unit: "probability" | "usd" | "count" | "severity";
  looseningLabel: string;
  impactedCount: number;
  additionalPasses: number;
  conversionRate: number | null;
}

export interface ExecutionAttributionTrade {
  recordedAt: string;
  ticker: string;
  title: string;
  category: PredictionCategory;
  side: PredictionSide;
  executionStatus: "PLACED" | "SKIPPED" | "FAILED";
  executionMessage: string;
  dominantExpert: string;
  dominantExpertWeight: number | null;
  probabilityTransform?: ProbabilityTransform;
  calibrationMethod?: CalibrationMethod;
  cluster: string;
  bootstrapMode: ExecutionBootstrapMode;
  executionHealthRegime: ExecutionHealthRegime;
  uncertaintyBucket: string;
  toxicityBucket: string;
  marketProb: number;
  modelProb: number;
  edge: number;
  executionAdjustedEdge?: number | null;
  netAlphaUsd?: number | null;
  coherenceOverride?: number | null;
  uncertaintyWidth?: number | null;
  toxicityScore?: number | null;
  inventorySkew?: number | null;
  staleHazard?: number | null;
  quoteWidening?: number | null;
  silentClockProbabilityContribution?: number | null;
  silentClockScoreContribution?: number | null;
  leadLagProbabilityContribution?: number | null;
  leadLagScoreContribution?: number | null;
  clusterStress?: boolean;
  limitPriceCents: number;
  executionRole?: ExecutionPlanRole;
  fillProbability?: number | null;
  filledContracts: number;
  averageFillPriceCents: number | null;
  markout30s: number | null;
  markout2m: number | null;
  markoutExpiry: number | null;
  balanceBeforeCashUsd: number | null;
  balanceAfterCashUsd: number | null;
  balanceBeforePortfolioUsd: number | null;
  balanceAfterPortfolioUsd: number | null;
  expectedExecutionCostUsd: number | null;
  actualCashDeltaUsd: number | null;
  inferredActualFeeUsd: number | null;
  estimatedFeeUsd: number | null;
  feeDriftUsd: number | null;
  cashDeltaDriftUsd: number | null;
  reconciliationMatched: boolean;
}

export interface ExecutionAttributionSummary {
  generatedAt: string;
  lookbackHours: number;
  totals: {
    decisions: number;
    placed: number;
    failed: number;
    skipped: number;
    totalFilledContracts: number;
    avgNetAlphaUsd: number | null;
    avgExecutionAdjustedEdge: number | null;
    avgMarkout30s: number | null;
    avgMarkout2m: number | null;
    avgMarkoutExpiry: number | null;
    matchedReconciliations: number;
    avgCashDeltaDriftUsd: number | null;
    avgFeeDriftUsd: number | null;
  };
  byExpert: ExecutionAttributionBucket[];
  byExecutionHealth: ExecutionAttributionBucket[];
  byCluster: ExecutionAttributionBucket[];
  byUncertaintyWidth: ExecutionAttributionBucket[];
  byToxicity: ExecutionAttributionBucket[];
  byBootstrap: ExecutionAttributionBucket[];
  recentTrades: ExecutionAttributionTrade[];
  replacement?: ReplacementAttributionSummary;
  orderMaintenance?: OrderMaintenanceAttributionSummary;
  watchlist?: WatchlistAttributionSummary;
  learning?: FalseNegativeLearningOutput;
  liquidation?: LiquidationAttributionSummary;
  overlays?: SignalOverlayAttributionSummary;
  selectionControl?: {
    executed: {
      count: number;
      avgEdge: number | null;
      avgExecutionAdjustedEdge: number | null;
      avgConfidence: number | null;
      avgCompositeScore: number | null;
    };
    nearMisses: {
      count: number;
      avgEdge: number | null;
      avgExecutionAdjustedEdge: number | null;
      avgConfidence: number | null;
      avgCompositeScore: number | null;
      avgLatestQuoteDrift: number | null;
    };
    resolvedNearMisses: {
      count: number;
      hitRate: number | null;
      profitableRate: number | null;
      avgCounterfactualPnlUsd: number | null;
      totalCounterfactualPnlUsd: number | null;
      avgExpiryDrift: number | null;
      avgQuoteToExpiryDivergence: number | null;
    };
    falseNegativesByExpert: ExecutionCounterfactualBucket[];
    falseNegativesByCluster: ExecutionCounterfactualBucket[];
    falseNegativesByToxicity: ExecutionCounterfactualBucket[];
    byGate: SelectionGateSummary[];
    gateWaterfall: SelectionGateWaterfallSummary[];
    counterfactualByGate: SelectionGateCounterfactualSummary[];
    recentNearMisses: Array<{
      recordedAt: string;
      ticker: string;
      title: string;
      category: PredictionCategory;
      side: PredictionSide;
      source: string;
      verdict?: CandidateVerdict;
      dominantExpert: string;
      cluster: string;
      edge: number;
      executionAdjustedEdge: number | null;
      confidence: number;
      compositeScore: number | null;
      latestQuoteDrift: number | null;
      settlementMark: number | null;
      resolved: boolean;
      realizedHit: boolean | null;
      counterfactualPnlUsd: number | null;
      expiryDrift: number | null;
      quoteToExpiryDivergence: number | null;
      failedGates: CandidateGateDiagnostic[];
      primaryFailedGate: CandidateGateDiagnostic | null;
      secondaryFailedGates: CandidateGateDiagnostic[];
      executionMessage?: string;
    }>;
  };
}

export interface AutomationControls {
  edgeMultiplier: number;
  confidenceShift: number;
  spreadMultiplier: number;
  liquidityMultiplier: number;
  highProbModelMin: number;
  highProbMarketMin: number;
  highProbabilityEnabled: boolean;
  favoriteLongshotEnabled: boolean;
  throughputRecoveryEnabled: boolean;
  exploratoryFallbackEnabled: boolean;
  replacementEnabled: boolean;
  replacementMinDelta: number;
  orderMaintenanceEnabled: boolean;
  cancelReplaceMinImprovement: number;
  watchlistPromotionEnabled: boolean;
  watchlistPromotionThreshold: number;
  adaptiveLearningEnabled: boolean;
  liquidationAdvisoryEnabled: boolean;
}

export interface AutomationRunInput {
  mode: AutomationMode;
  execute: boolean;
  categories: PredictionCategory[];
  controls?: Partial<AutomationControls>;
}

export interface KalshiOrderRequest {
  ticker: string;
  side: PredictionSide;
  count: number;
  limitPriceCents: number;
  contractStep?: number;
  orderGroupId?: string;
  clientOrderId?: string;
}

export interface KalshiOrderGroupLite {
  order_group_id: string;
  contracts_limit: number;
  is_auto_cancel_enabled: boolean;
  status?: string;
  order_ids?: string[];
}

export interface KalshiOrderLite {
  order_id: string;
  client_order_id?: string;
  order_group_id?: string;
  ticker: string;
  title?: string;
  market_status?: string;
  side: "yes" | "no";
  action: string;
  status: string;
  type?: string;
  count: number;
  remaining_count?: number;
  yes_price?: number;
  no_price?: number;
  created_time?: string;
  expiration_time?: string;
  last_update_time?: string;
}

export interface KalshiFillLite {
  fill_id: string;
  order_id: string;
  ticker: string;
  side: "yes" | "no";
  action: string;
  count: number;
  yes_price?: number;
  no_price?: number;
  created_time?: string;
}

export interface KalshiQuoteLite {
  ticker: string;
  title?: string;
  marketStatus?: string;
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  lastPrice: number | null;
  settlementResult?: "yes" | "no";
  settlementPrice?: number | null;
}

export interface KalshiPositionLite {
  ticker: string;
  position_fp: string;
  market_exposure_dollars?: string;
  total_traded_dollars?: string;
  realized_pnl_dollars?: string;
  fees_paid_dollars?: string;
  last_updated_ts?: string;
  resting_orders_count?: number;
}
