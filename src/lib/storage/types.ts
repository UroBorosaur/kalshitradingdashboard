import type {
  AutomationMode,
  CandidateVerdict,
  ExecutionPlanRole,
  OpportunityType,
  PredictionCandidate,
  PredictionCategory,
} from "@/lib/prediction/types";

export type PredictionStorageLayer = "raw" | "derived";
export type PredictionStorageStream =
  | "fills"
  | "orders"
  | "positions"
  | "quotes"
  | "orderbook_events"
  | "candidate_decisions"
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

export interface StoredKalshiOrderEvent {
  orderId: string;
  clientOrderId?: string;
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
  compositeScore?: number;
  portfolioWeight?: number;
  netAlphaUsd?: number;
  feeEstimateUsd?: number;
  incentiveRewardUsd?: number;
  executionAlphaUsd?: number;
  uncertaintyWidth?: number;
  toxicityScore?: number;
  riskCluster?: string;
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
  };
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
  fills: Array<PredictionStorageEnvelope<StoredKalshiFillEvent>>;
  orders: Array<PredictionStorageEnvelope<StoredKalshiOrderEvent>>;
  positions: Array<PredictionStorageEnvelope<StoredKalshiPositionEvent>>;
  quotes: Array<PredictionStorageEnvelope<StoredKalshiQuoteEvent>>;
  orderbookEvents: Array<PredictionStorageEnvelope<StoredOrderbookEvent>>;
  candidateDecisions: Array<PredictionStorageEnvelope<StoredCandidateDecisionEvent>>;
  resolutions: Array<PredictionStorageEnvelope<StoredResolutionEvent>>;
  markouts: Array<PredictionStorageEnvelope<StoredMarkoutEvent>>;
}

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
    compositeScore: candidate.compositeScore,
    portfolioWeight: candidate.portfolioWeight,
    netAlphaUsd: candidate.netAlphaUsd,
    feeEstimateUsd: candidate.feeEstimateUsd,
    incentiveRewardUsd: candidate.incentiveRewardUsd,
    executionAlphaUsd: candidate.executionAlphaUsd,
    uncertaintyWidth: candidate.uncertaintyWidth,
    toxicityScore: candidate.toxicityScore,
    riskCluster: candidate.riskCluster,
    strategyTags: candidate.strategyTags,
    executionPlan: candidate.executionPlan,
    rationale: candidate.rationale,
  };
}
