export type AutomationMode = "CONSERVATIVE" | "MIXED" | "AGGRESSIVE" | "AI";

export type PredictionCategory = "BITCOIN" | "SPORTS" | "POLITICS" | "ESPORTS" | "WEATHER" | "STOCKS" | "MACRO" | "OTHER";

export type PredictionSide = "YES" | "NO";
export type OpportunityType = "TRADE" | "WATCHLIST" | "HEDGE" | "PASS";
export type CandidateVerdict = "BUY_YES" | "BUY_NO" | "WATCHLIST" | "PASS";
export type ExecutionPlanRole = "TAKER" | "MAKER" | "MAKER_FEE";
export type ProbabilityTransform = "SIGMOID" | "SOFTMAX" | "SPARSEMAX" | "ENTMAX15";
export type CalibrationMethod = "NONE" | "TEMPERATURE" | "ISOTONIC_STRUCTURAL";
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
  | "TEMPERATURE_CALIBRATED";

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
  executionPlan?: {
    limitPriceCents: number;
    patienceHours: number;
    fillProbability: number;
    expectedExecutionValueUsd: number;
    feeUsd: number;
    role: ExecutionPlanRole;
    quoteWidening?: number;
    staleHazard?: number;
  };
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
  warnings: string[];
  inferredRegime: {
    label: string;
    confidence: number;
  };
  controls?: AutomationControls;
  generatedAt: string;
}

export interface AutomationControls {
  edgeMultiplier: number;
  confidenceShift: number;
  spreadMultiplier: number;
  liquidityMultiplier: number;
  highProbModelMin: number;
  highProbabilityEnabled: boolean;
  favoriteLongshotEnabled: boolean;
  throughputRecoveryEnabled: boolean;
  exploratoryFallbackEnabled: boolean;
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
