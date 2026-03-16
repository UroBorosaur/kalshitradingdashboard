import "@/lib/server-only";

import {
  readStoredBalancesSince,
  readStoredCandidateDecisionsSince,
  readStoredFillsSince,
  readStoredMarkoutsSince,
  readStoredOrdersSince,
  readStoredQuotesSince,
  readStoredResolutionsSince,
} from "@/lib/storage/prediction-store";
import type {
  PredictionStorageEnvelope,
  StoredKalshiBalanceEvent,
  StoredCandidateDecisionEvent,
  StoredKalshiFillEvent,
  StoredKalshiOrderEvent,
  StoredMarkoutEvent,
  StoredKalshiQuoteEvent,
  StoredResolutionEvent,
} from "@/lib/storage/types";
import type {
  CandidateGateKey,
  ExecutionAttributionBucket,
  ExecutionCounterfactualBucket,
  ExecutionAttributionSummary,
  ExecutionAttributionTrade,
  ExecutionBootstrapMode,
  ExecutionHealthRegime,
  PredictionSide,
} from "@/lib/prediction/types";
import { reconcileKalshiExecution } from "@/lib/prediction/reconciliation";

const EXECUTED_CANDIDATE_SOURCE = "automation/executed-candidates";
const DEFAULT_LOOKBACK_HOURS = 72;
const DEFAULT_RECENT_TRADE_LIMIT = 12;
const DEFAULT_BUCKET_LIMIT = 6;
const NEAR_MISS_SOURCE_PRIORITY = [
  "automation/executed-candidates",
  "automation/conflict-blocked-candidates",
  "automation/planned-candidates",
  "automation/exploratory-boost",
  "automation/throughput-recovery-step-1",
  "automation/throughput-recovery-step-2",
  "automation/generated-candidates",
] as const;

type AttributionHorizon = "30s" | "2m" | "expiry";

interface SummarizeExecutionAttributionArgs {
  lookbackHours: number;
  recentTradeLimit?: number;
  bucketLimit?: number;
  decisions: Array<PredictionStorageEnvelope<StoredCandidateDecisionEvent>>;
  orders: Array<PredictionStorageEnvelope<StoredKalshiOrderEvent>>;
  fills: Array<PredictionStorageEnvelope<StoredKalshiFillEvent>>;
  balances: Array<PredictionStorageEnvelope<StoredKalshiBalanceEvent>>;
  quotes: Array<PredictionStorageEnvelope<StoredKalshiQuoteEvent>>;
  resolutions: Array<PredictionStorageEnvelope<StoredResolutionEvent>>;
  markouts: Array<PredictionStorageEnvelope<StoredMarkoutEvent>>;
}

interface BucketAccumulator {
  key: string;
  label: string;
  decisions: number;
  placed: number;
  failed: number;
  skipped: number;
  totalFilledContracts: number;
  netAlphaSum: number;
  netAlphaCount: number;
  executionAdjustedEdgeSum: number;
  executionAdjustedEdgeCount: number;
  markout30sSum: number;
  markout30sCount: number;
  markout2mSum: number;
  markout2mCount: number;
  markoutExpirySum: number;
  markoutExpiryCount: number;
  cashDeltaDriftSum: number;
  cashDeltaDriftCount: number;
  feeDriftSum: number;
  feeDriftCount: number;
  matchedReconciliations: number;
}

interface CounterfactualAccumulator {
  key: string;
  label: string;
  resolved: number;
  profitable: number;
  hitCount: number;
  pnlSum: number;
  expiryDriftSum: number;
  expiryDriftCount: number;
  divergenceSum: number;
  divergenceCount: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundNullable(value: number | null | undefined, digits = 4) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function average(sum: number, count: number) {
  return count > 0 ? Number((sum / count).toFixed(4)) : null;
}

function normalizeBootstrapMode(mode: string | undefined): ExecutionBootstrapMode {
  if (mode === "ACKED" || mode === "EVENT_PRIMED" || mode === "UNAVAILABLE") return mode;
  return "UNAVAILABLE";
}

function normalizeExecutionHealthRegime(regime: string | undefined): ExecutionHealthRegime {
  if (regime === "NORMAL" || regime === "TIGHTENED" || regime === "DEFENSIVE") return regime;
  return "NORMAL";
}

function uncertaintyBucket(width: number | undefined) {
  if (typeof width !== "number" || !Number.isFinite(width)) return "Unspecified";
  if (width < 0.02) return "Tight <=2%";
  if (width < 0.05) return "Moderate 2-5%";
  return "Wide >5%";
}

function toxicityBucket(score: number | undefined) {
  if (typeof score !== "number" || !Number.isFinite(score)) return "Unspecified";
  if (score < 0.2) return "Low <20%";
  if (score < 0.45) return "Elevated 20-45%";
  if (score < 0.7) return "High 45-70%";
  return "Critical >=70%";
}

function determineDominantExpert(
  weights: StoredCandidateDecisionEvent["expertWeights"],
): { expert: string; weight: number | null } {
  if (!weights?.length) return { expert: "BASELINE", weight: null };
  const dominant = [...weights].sort((a, b) => b.weight - a.weight)[0];
  return {
    expert: dominant?.expert ?? "BASELINE",
    weight: typeof dominant?.weight === "number" && Number.isFinite(dominant.weight) ? dominant.weight : null,
  };
}

function fillPriceCentsForSide(fill: StoredKalshiFillEvent, side: PredictionSide) {
  const yesPrice = typeof fill.yesPriceCents === "number" ? fill.yesPriceCents : null;
  const noPrice = typeof fill.noPriceCents === "number" ? fill.noPriceCents : null;
  if (side === "YES") {
    if (yesPrice !== null) return yesPrice;
    if (noPrice !== null) return 100 - noPrice;
  } else {
    if (noPrice !== null) return noPrice;
    if (yesPrice !== null) return 100 - yesPrice;
  }
  return null;
}

function quoteMarkProbability(quote: StoredKalshiQuoteEvent, side: PredictionSide) {
  const yesMark =
    typeof quote.yesBid === "number" && Number.isFinite(quote.yesBid)
      ? quote.yesBid
      : typeof quote.lastPrice === "number" && Number.isFinite(quote.lastPrice)
        ? quote.lastPrice
        : null;
  if (yesMark === null) return null;
  return side === "YES" ? yesMark : Number((1 - yesMark).toFixed(4));
}

function sourcePriority(source: string) {
  const index = NEAR_MISS_SOURCE_PRIORITY.indexOf(source as (typeof NEAR_MISS_SOURCE_PRIORITY)[number]);
  return index === -1 ? NEAR_MISS_SOURCE_PRIORITY.length : index;
}

function gateLabel(gate: string) {
  switch (gate) {
    case "CONFIDENCE_FLOOR":
      return "Confidence floor";
    case "EXECUTION_EDGE":
      return "Execution-adjusted edge";
    case "TOXICITY":
      return "Toxicity";
    case "UNCERTAINTY_WIDTH":
      return "Uncertainty width";
    case "CLUSTER_CAP":
      return "Cluster cap";
    case "ORDER_GROUP_BRAKE":
      return "Order-group brake";
    case "POSITION_ORDER_CONFLICT":
      return "Existing position/order conflict";
    case "BOOTSTRAP_HEALTH":
      return "Bootstrap / stream health";
    default:
      return gate;
  }
}

function settlementMarkForDecision(
  resolution: StoredResolutionEvent | undefined,
  side: PredictionSide,
) {
  if (!resolution) return null;
  if (typeof resolution.settlementPrice === "number" && Number.isFinite(resolution.settlementPrice)) {
    return Number((side === "YES" ? resolution.settlementPrice : 1 - resolution.settlementPrice).toFixed(4));
  }
  if (resolution.settlementResult === "yes") return side === "YES" ? 1 : 0;
  if (resolution.settlementResult === "no") return side === "YES" ? 0 : 1;
  return null;
}

function createAccumulator(key: string, label: string): BucketAccumulator {
  return {
    key,
    label,
    decisions: 0,
    placed: 0,
    failed: 0,
    skipped: 0,
    totalFilledContracts: 0,
    netAlphaSum: 0,
    netAlphaCount: 0,
    executionAdjustedEdgeSum: 0,
    executionAdjustedEdgeCount: 0,
    markout30sSum: 0,
    markout30sCount: 0,
    markout2mSum: 0,
    markout2mCount: 0,
    markoutExpirySum: 0,
    markoutExpiryCount: 0,
    cashDeltaDriftSum: 0,
    cashDeltaDriftCount: 0,
    feeDriftSum: 0,
    feeDriftCount: 0,
    matchedReconciliations: 0,
  };
}

function applyTradeToAccumulator(accumulator: BucketAccumulator, trade: ExecutionAttributionTrade) {
  accumulator.decisions += 1;
  if (trade.executionStatus === "PLACED") accumulator.placed += 1;
  else if (trade.executionStatus === "FAILED") accumulator.failed += 1;
  else accumulator.skipped += 1;

  accumulator.totalFilledContracts += trade.filledContracts;

  if (typeof trade.netAlphaUsd === "number" && Number.isFinite(trade.netAlphaUsd)) {
    accumulator.netAlphaSum += trade.netAlphaUsd;
    accumulator.netAlphaCount += 1;
  }
  if (typeof trade.executionAdjustedEdge === "number" && Number.isFinite(trade.executionAdjustedEdge)) {
    accumulator.executionAdjustedEdgeSum += trade.executionAdjustedEdge;
    accumulator.executionAdjustedEdgeCount += 1;
  }
  if (typeof trade.markout30s === "number" && Number.isFinite(trade.markout30s)) {
    accumulator.markout30sSum += trade.markout30s;
    accumulator.markout30sCount += 1;
  }
  if (typeof trade.markout2m === "number" && Number.isFinite(trade.markout2m)) {
    accumulator.markout2mSum += trade.markout2m;
    accumulator.markout2mCount += 1;
  }
  if (typeof trade.markoutExpiry === "number" && Number.isFinite(trade.markoutExpiry)) {
    accumulator.markoutExpirySum += trade.markoutExpiry;
    accumulator.markoutExpiryCount += 1;
  }
  if (trade.reconciliationMatched) {
    accumulator.matchedReconciliations += 1;
  }
  if (typeof trade.cashDeltaDriftUsd === "number" && Number.isFinite(trade.cashDeltaDriftUsd)) {
    accumulator.cashDeltaDriftSum += trade.cashDeltaDriftUsd;
    accumulator.cashDeltaDriftCount += 1;
  }
  if (typeof trade.feeDriftUsd === "number" && Number.isFinite(trade.feeDriftUsd)) {
    accumulator.feeDriftSum += trade.feeDriftUsd;
    accumulator.feeDriftCount += 1;
  }
}

function finalizeAccumulator(accumulator: BucketAccumulator): ExecutionAttributionBucket {
  return {
    key: accumulator.key,
    label: accumulator.label,
    decisions: accumulator.decisions,
    placed: accumulator.placed,
    failed: accumulator.failed,
    skipped: accumulator.skipped,
    totalFilledContracts: Number(accumulator.totalFilledContracts.toFixed(4)),
    avgNetAlphaUsd: average(accumulator.netAlphaSum, accumulator.netAlphaCount),
    avgExecutionAdjustedEdge: average(accumulator.executionAdjustedEdgeSum, accumulator.executionAdjustedEdgeCount),
    avgMarkout30s: average(accumulator.markout30sSum, accumulator.markout30sCount),
    avgMarkout2m: average(accumulator.markout2mSum, accumulator.markout2mCount),
    avgMarkoutExpiry: average(accumulator.markoutExpirySum, accumulator.markoutExpiryCount),
    avgCashDeltaDriftUsd: average(accumulator.cashDeltaDriftSum, accumulator.cashDeltaDriftCount),
  };
}

function createCounterfactualAccumulator(key: string, label: string): CounterfactualAccumulator {
  return {
    key,
    label,
    resolved: 0,
    profitable: 0,
    hitCount: 0,
    pnlSum: 0,
    expiryDriftSum: 0,
    expiryDriftCount: 0,
    divergenceSum: 0,
    divergenceCount: 0,
  };
}

function applyCounterfactualSample(
  accumulator: CounterfactualAccumulator,
  sample: {
    settlementMark: number;
    counterfactualPnlUsd: number;
    latestQuoteDrift: number | null;
    marketProb: number;
  },
) {
  accumulator.resolved += 1;
  if (sample.counterfactualPnlUsd > 0) accumulator.profitable += 1;
  if (sample.settlementMark > 0.5) accumulator.hitCount += 1;
  accumulator.pnlSum += sample.counterfactualPnlUsd;
  const expiryDrift = sample.settlementMark - sample.marketProb;
  accumulator.expiryDriftSum += expiryDrift;
  accumulator.expiryDriftCount += 1;
  if (typeof sample.latestQuoteDrift === "number" && Number.isFinite(sample.latestQuoteDrift)) {
    accumulator.divergenceSum += expiryDrift - sample.latestQuoteDrift;
    accumulator.divergenceCount += 1;
  }
}

function finalizeCounterfactualAccumulator(accumulator: CounterfactualAccumulator): ExecutionCounterfactualBucket {
  return {
    key: accumulator.key,
    label: accumulator.label,
    resolved: accumulator.resolved,
    profitable: accumulator.profitable,
    hitRate: average(accumulator.hitCount, accumulator.resolved),
    avgCounterfactualPnlUsd: average(accumulator.pnlSum, accumulator.resolved),
    totalCounterfactualPnlUsd: accumulator.resolved > 0 ? roundNullable(accumulator.pnlSum) : null,
  };
}

function pushCounterfactualBucket(
  map: Map<string, CounterfactualAccumulator>,
  key: string,
  label: string,
  sample: {
    settlementMark: number;
    counterfactualPnlUsd: number;
    latestQuoteDrift: number | null;
    marketProb: number;
  },
) {
  const accumulator = map.get(key) ?? createCounterfactualAccumulator(key, label);
  applyCounterfactualSample(accumulator, sample);
  map.set(key, accumulator);
}

function finalizeCounterfactualBuckets(map: Map<string, CounterfactualAccumulator>, limit: number) {
  return [...map.values()]
    .map(finalizeCounterfactualAccumulator)
    .sort((a, b) => {
      if ((b.totalCounterfactualPnlUsd ?? 0) !== (a.totalCounterfactualPnlUsd ?? 0)) {
        return (b.totalCounterfactualPnlUsd ?? 0) - (a.totalCounterfactualPnlUsd ?? 0);
      }
      if (b.resolved !== a.resolved) return b.resolved - a.resolved;
      return a.label.localeCompare(b.label);
    })
    .slice(0, limit);
}

function pushBucket(
  map: Map<string, BucketAccumulator>,
  key: string,
  label: string,
  trade: ExecutionAttributionTrade,
) {
  const accumulator = map.get(key) ?? createAccumulator(key, label);
  applyTradeToAccumulator(accumulator, trade);
  map.set(key, accumulator);
}

function finalizeBuckets(map: Map<string, BucketAccumulator>, limit: number) {
  return [...map.values()]
    .map(finalizeAccumulator)
    .sort((a, b) => {
      if (b.decisions !== a.decisions) return b.decisions - a.decisions;
      if ((a.avgMarkoutExpiry ?? Infinity) !== (b.avgMarkoutExpiry ?? Infinity)) {
        return (a.avgMarkoutExpiry ?? Infinity) - (b.avgMarkoutExpiry ?? Infinity);
      }
      return a.label.localeCompare(b.label);
    })
    .slice(0, limit);
}

function resolveOrderId(
  decision: StoredCandidateDecisionEvent,
  ordersByClientOrderId: Map<string, StoredKalshiOrderEvent>,
) {
  if (decision.executionOrderId?.trim()) return decision.executionOrderId.trim();
  if (decision.executionClientOrderId?.trim()) {
    return ordersByClientOrderId.get(decision.executionClientOrderId.trim())?.orderId;
  }
  return undefined;
}

function parseIsoTime(value: string | undefined) {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function resolveAnchorTs(args: {
  decisionRecordedAt: string;
  order?: StoredKalshiOrderEvent;
  fills: StoredKalshiFillEvent[];
}) {
  const fillTimes = args.fills.map((fill) => parseIsoTime(fill.createdTime)).filter((value): value is number => value !== null);
  if (fillTimes.length) return Math.min(...fillTimes);
  const orderTime = parseIsoTime(args.order?.createdTime) ?? parseIsoTime(args.order?.lastUpdateTime);
  if (orderTime !== null) return orderTime;
  return new Date(args.decisionRecordedAt).getTime();
}

function resolveBalanceWindow(
  balances: Array<PredictionStorageEnvelope<StoredKalshiBalanceEvent>>,
  anchorTs: number,
) {
  let before: PredictionStorageEnvelope<StoredKalshiBalanceEvent> | null = null;
  let after: PredictionStorageEnvelope<StoredKalshiBalanceEvent> | null = null;

  for (const balance of balances) {
    const ts = new Date(balance.recordedAt).getTime();
    if (!Number.isFinite(ts)) continue;
    if (ts <= anchorTs) {
      if (!before || ts >= new Date(before.recordedAt).getTime()) before = balance;
    }
    if (ts >= anchorTs) {
      if (!after || ts <= new Date(after.recordedAt).getTime()) after = balance;
    }
  }

  return { before, after };
}

function latestQuoteDriftForDecision(args: {
  decision: PredictionStorageEnvelope<StoredCandidateDecisionEvent>;
  quotesByTicker: Map<string, Array<PredictionStorageEnvelope<StoredKalshiQuoteEvent>>>;
}) {
  const quotes = args.quotesByTicker.get(args.decision.payload.ticker) ?? [];
  const decisionTs = new Date(args.decision.recordedAt).getTime();
  let latest: PredictionStorageEnvelope<StoredKalshiQuoteEvent> | null = null;

  for (const quote of quotes) {
    const ts = new Date(quote.recordedAt).getTime();
    if (!Number.isFinite(ts) || ts < decisionTs) continue;
    if (!latest || ts > new Date(latest.recordedAt).getTime()) {
      latest = quote;
    }
  }

  if (!latest) return null;
  const mark = quoteMarkProbability(latest.payload, args.decision.payload.side);
  if (mark === null) return null;
  return Number((mark - args.decision.payload.marketProb).toFixed(4));
}

function summarizeOrderExecution(args: {
  decision: StoredCandidateDecisionEvent;
  decisionRecordedAt: string;
  order?: StoredKalshiOrderEvent;
  orderId?: string;
  fillsByOrderId: Map<string, StoredKalshiFillEvent[]>;
  markoutsByFillId: Map<string, Map<AttributionHorizon, StoredMarkoutEvent>>;
  balances: Array<PredictionStorageEnvelope<StoredKalshiBalanceEvent>>;
}) {
  const fills = args.orderId ? args.fillsByOrderId.get(args.orderId) ?? [] : [];
  let filledContracts = 0;
  let fillPriceWeighted = 0;
  let fillPriceWeight = 0;
  const horizonSums: Record<AttributionHorizon, number> = {
    "30s": 0,
    "2m": 0,
    expiry: 0,
  };
  const horizonCounts: Record<AttributionHorizon, number> = {
    "30s": 0,
    "2m": 0,
    expiry: 0,
  };

  for (const fill of fills) {
    const count = typeof fill.count === "number" && Number.isFinite(fill.count) ? fill.count : 0;
    if (count > 0) filledContracts += count;

    const fillPriceCents = fillPriceCentsForSide(fill, args.decision.side);
    if (fillPriceCents !== null && count > 0) {
      fillPriceWeighted += fillPriceCents * count;
      fillPriceWeight += count;
    }

    const markouts = args.markoutsByFillId.get(fill.fillId);
    if (!markouts) continue;
    for (const horizon of ["30s", "2m", "expiry"] as AttributionHorizon[]) {
      const event = markouts.get(horizon);
      if (!event || count <= 0) continue;
      horizonSums[horizon] += event.markout * count;
      horizonCounts[horizon] += count;
    }
  }

  const anchorTs = resolveAnchorTs({
    decisionRecordedAt: args.decisionRecordedAt,
    order: args.order,
    fills,
  });
  const balanceWindow = resolveBalanceWindow(args.balances, anchorTs);
  const beforeCash = balanceWindow.before?.payload.cashUsd ?? null;
  const afterCash = balanceWindow.after?.payload.cashUsd ?? null;
  const beforePortfolio = balanceWindow.before?.payload.portfolioUsd ?? null;
  const afterPortfolio = balanceWindow.after?.payload.portfolioUsd ?? null;
  const actualCashDeltaUsd =
    typeof beforeCash === "number" && typeof afterCash === "number" ? Number((beforeCash - afterCash).toFixed(4)) : null;
  const reconciliation = reconcileKalshiExecution({
    intent: {
      side: args.decision.side,
      requestedCount: args.decision.recommendedContracts,
      snappedCount: args.decision.recommendedContracts,
      requestedLimitPriceCents: args.decision.limitPriceCents,
      snappedLimitPriceCents: args.decision.limitPriceCents,
      estimatedFeeUsd: args.decision.feeEstimateUsd,
      expectedExecutionCostUsd: Number((args.decision.recommendedStakeUsd + (args.decision.feeEstimateUsd ?? 0)).toFixed(4)),
    },
    fills: fills.map((fill) => ({
      fill_id: fill.fillId,
      order_id: fill.orderId,
      ticker: fill.ticker,
      side: fill.side,
      action: fill.action,
      count: fill.count,
      yes_price: fill.yesPriceCents,
      no_price: fill.noPriceCents,
      created_time: fill.createdTime,
    })),
    actualCashDeltaUsd,
  });
  const inferredActualFeeUsd =
    typeof actualCashDeltaUsd === "number" && typeof reconciliation.realizedNotionalUsd === "number"
      ? Number((actualCashDeltaUsd - reconciliation.realizedNotionalUsd).toFixed(4))
      : null;

  return {
    filledContracts: Number(filledContracts.toFixed(4)),
    averageFillPriceCents:
      fillPriceWeight > 0 ? Number((fillPriceWeighted / fillPriceWeight).toFixed(4)) : null,
    markout30s: horizonCounts["30s"] > 0 ? Number((horizonSums["30s"] / horizonCounts["30s"]).toFixed(4)) : null,
    markout2m: horizonCounts["2m"] > 0 ? Number((horizonSums["2m"] / horizonCounts["2m"]).toFixed(4)) : null,
    markoutExpiry:
      horizonCounts.expiry > 0 ? Number((horizonSums.expiry / horizonCounts.expiry).toFixed(4)) : null,
    balanceBeforeCashUsd: beforeCash,
    balanceAfterCashUsd: afterCash,
    balanceBeforePortfolioUsd: beforePortfolio,
    balanceAfterPortfolioUsd: afterPortfolio,
    expectedExecutionCostUsd: reconciliation.expectedExecutionCostUsd,
    actualCashDeltaUsd: reconciliation.actualCashDeltaUsd,
    inferredActualFeeUsd,
    estimatedFeeUsd: reconciliation.estimatedFeeUsd,
    feeDriftUsd:
      inferredActualFeeUsd !== null && typeof reconciliation.estimatedFeeUsd === "number"
        ? Number((inferredActualFeeUsd - reconciliation.estimatedFeeUsd).toFixed(4))
        : null,
    cashDeltaDriftUsd: reconciliation.cashDeltaDriftUsd,
    reconciliationMatched: actualCashDeltaUsd !== null,
  };
}

export function summarizeExecutionAttribution({
  lookbackHours,
  recentTradeLimit = DEFAULT_RECENT_TRADE_LIMIT,
  bucketLimit = DEFAULT_BUCKET_LIMIT,
  decisions,
  orders,
  fills,
  balances,
  quotes,
  resolutions,
  markouts,
}: SummarizeExecutionAttributionArgs): ExecutionAttributionSummary {
  const executedDecisions = decisions
    .filter((event) => event.source === EXECUTED_CANDIDATE_SOURCE)
    .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());
  const candidateDecisions = decisions
    .filter((event) => NEAR_MISS_SOURCE_PRIORITY.includes(event.source as (typeof NEAR_MISS_SOURCE_PRIORITY)[number]))
    .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());

  const ordersByClientOrderId = new Map<string, StoredKalshiOrderEvent>();
  const ordersById = new Map<string, StoredKalshiOrderEvent>();
  for (const order of orders) {
    ordersById.set(order.payload.orderId, order.payload);
    const clientOrderId = order.payload.clientOrderId?.trim();
    if (!clientOrderId) continue;
    const existing = ordersByClientOrderId.get(clientOrderId);
    if (!existing || new Date(order.recordedAt).getTime() >= new Date(existing.lastUpdateTime ?? existing.createdTime ?? 0).getTime()) {
      ordersByClientOrderId.set(clientOrderId, order.payload);
    }
  }

  const fillsByOrderId = new Map<string, StoredKalshiFillEvent[]>();
  for (const fill of fills) {
    const orderId = fill.payload.orderId?.trim();
    if (!orderId) continue;
    const next = fillsByOrderId.get(orderId) ?? [];
    next.push(fill.payload);
    fillsByOrderId.set(orderId, next);
  }

  const markoutsByFillId = new Map<string, Map<AttributionHorizon, StoredMarkoutEvent>>();
  for (const markout of markouts) {
    if (markout.payload.horizon !== "30s" && markout.payload.horizon !== "2m" && markout.payload.horizon !== "expiry") continue;
    const next = markoutsByFillId.get(markout.payload.fillId) ?? new Map<AttributionHorizon, StoredMarkoutEvent>();
    next.set(markout.payload.horizon, markout.payload);
    markoutsByFillId.set(markout.payload.fillId, next);
  }

  const quotesByTicker = new Map<string, Array<PredictionStorageEnvelope<StoredKalshiQuoteEvent>>>();
  for (const quote of quotes) {
    const ticker = quote.payload.ticker?.trim().toUpperCase();
    if (!ticker) continue;
    const next = quotesByTicker.get(ticker) ?? [];
    next.push(quote);
    quotesByTicker.set(ticker, next);
  }
  for (const tickerQuotes of quotesByTicker.values()) {
    tickerQuotes.sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  }

  const resolutionByTicker = new Map<string, PredictionStorageEnvelope<StoredResolutionEvent>>();
  for (const resolution of resolutions) {
    const ticker = resolution.payload.ticker?.trim().toUpperCase();
    if (!ticker) continue;
    const existing = resolutionByTicker.get(ticker);
    const resolutionTs = parseIsoTime(resolution.payload.resolvedAt) ?? new Date(resolution.recordedAt).getTime();
    const existingTs = existing
      ? parseIsoTime(existing.payload.resolvedAt) ?? new Date(existing.recordedAt).getTime()
      : -Infinity;
    if (!existing || resolutionTs >= existingTs) {
      resolutionByTicker.set(ticker, resolution);
    }
  }

  const preferredDecisionsByKey = new Map<string, PredictionStorageEnvelope<StoredCandidateDecisionEvent>>();
  for (const event of candidateDecisions) {
    const payload = event.payload;
    const key = `${payload.runId}:${payload.ticker}:${payload.side}`;
    const existing = preferredDecisionsByKey.get(key);
    if (!existing) {
      preferredDecisionsByKey.set(key, event);
      continue;
    }
    const eventPriority = sourcePriority(event.source);
    const existingPriority = sourcePriority(existing.source);
    if (eventPriority < existingPriority) {
      preferredDecisionsByKey.set(key, event);
      continue;
    }
    if (eventPriority === existingPriority && new Date(event.recordedAt).getTime() > new Date(existing.recordedAt).getTime()) {
      preferredDecisionsByKey.set(key, event);
    }
  }

  const byExpert = new Map<string, BucketAccumulator>();
  const byExecutionHealth = new Map<string, BucketAccumulator>();
  const byCluster = new Map<string, BucketAccumulator>();
  const byUncertainty = new Map<string, BucketAccumulator>();
  const byToxicity = new Map<string, BucketAccumulator>();
  const byBootstrap = new Map<string, BucketAccumulator>();
  const falseNegativesByExpert = new Map<string, CounterfactualAccumulator>();
  const falseNegativesByCluster = new Map<string, CounterfactualAccumulator>();
  const falseNegativesByToxicity = new Map<string, CounterfactualAccumulator>();
  const totals = createAccumulator("totals", "Totals");
  const trades: ExecutionAttributionTrade[] = [];

  for (const event of executedDecisions) {
    const decision = event.payload;
    const dominantExpert = determineDominantExpert(decision.expertWeights);
    const bootstrapMode = normalizeBootstrapMode(decision.bootstrapMode);
    const executionHealthRegime = normalizeExecutionHealthRegime(decision.executionHealthRegime);
    const uncertaintyLabel = uncertaintyBucket(decision.uncertaintyWidth);
    const toxicityLabel = toxicityBucket(decision.toxicityScore);
    const orderId = resolveOrderId(decision, ordersByClientOrderId);
    const order = orderId ? ordersById.get(orderId) : undefined;
    const executionStats = summarizeOrderExecution({
      decision,
      decisionRecordedAt: event.recordedAt,
      order,
      orderId,
      fillsByOrderId,
      markoutsByFillId,
      balances,
    });

    const trade: ExecutionAttributionTrade = {
      recordedAt: event.recordedAt,
      ticker: decision.ticker,
      title: decision.title,
      category: decision.category,
      side: decision.side,
      executionStatus: decision.executionStatus ?? "SKIPPED",
      executionMessage: decision.executionMessage ?? "No execution message recorded.",
      dominantExpert: dominantExpert.expert,
      dominantExpertWeight: roundNullable(dominantExpert.weight),
      probabilityTransform: decision.probabilityTransform,
      calibrationMethod: decision.calibrationMethod,
      cluster: decision.riskCluster ?? `${decision.category}:${decision.ticker}`,
      bootstrapMode,
      executionHealthRegime,
      uncertaintyBucket: uncertaintyLabel,
      toxicityBucket: toxicityLabel,
      marketProb: Number(decision.marketProb.toFixed(4)),
      modelProb: Number(decision.modelProb.toFixed(4)),
      edge: Number(decision.edge.toFixed(4)),
      executionAdjustedEdge: roundNullable(decision.executionAdjustedEdge),
      netAlphaUsd: roundNullable(decision.netAlphaUsd),
      coherenceOverride:
        typeof decision.coherentFairProb === "number" && Number.isFinite(decision.coherentFairProb)
          ? Number((decision.coherentFairProb - decision.marketProb).toFixed(4))
          : null,
      uncertaintyWidth: roundNullable(decision.uncertaintyWidth, 6),
      toxicityScore: roundNullable(decision.toxicityScore, 6),
      inventorySkew: roundNullable(decision.executionPlan?.inventorySkew, 6),
      staleHazard: roundNullable(decision.executionPlan?.staleHazard, 6),
      quoteWidening: roundNullable(decision.executionPlan?.quoteWidening, 6),
      limitPriceCents: decision.limitPriceCents,
      executionRole: decision.executionPlan?.role,
      fillProbability: roundNullable(decision.executionPlan?.fillProbability),
      filledContracts: executionStats.filledContracts,
      averageFillPriceCents: executionStats.averageFillPriceCents,
      markout30s: executionStats.markout30s,
      markout2m: executionStats.markout2m,
      markoutExpiry: executionStats.markoutExpiry,
      balanceBeforeCashUsd: executionStats.balanceBeforeCashUsd,
      balanceAfterCashUsd: executionStats.balanceAfterCashUsd,
      balanceBeforePortfolioUsd: executionStats.balanceBeforePortfolioUsd,
      balanceAfterPortfolioUsd: executionStats.balanceAfterPortfolioUsd,
      expectedExecutionCostUsd: executionStats.expectedExecutionCostUsd,
      actualCashDeltaUsd: executionStats.actualCashDeltaUsd,
      inferredActualFeeUsd: executionStats.inferredActualFeeUsd,
      estimatedFeeUsd: executionStats.estimatedFeeUsd,
      feeDriftUsd: executionStats.feeDriftUsd,
      cashDeltaDriftUsd: executionStats.cashDeltaDriftUsd,
      reconciliationMatched: executionStats.reconciliationMatched,
    };

    trades.push(trade);
    applyTradeToAccumulator(totals, trade);
    pushBucket(byExpert, dominantExpert.expert, dominantExpert.expert, trade);
    pushBucket(byExecutionHealth, executionHealthRegime, executionHealthRegime, trade);
    pushBucket(byCluster, trade.cluster, trade.cluster, trade);
    pushBucket(byUncertainty, uncertaintyLabel, uncertaintyLabel, trade);
    pushBucket(byToxicity, toxicityLabel, toxicityLabel, trade);
    pushBucket(byBootstrap, bootstrapMode, bootstrapMode, trade);
  }

  const placedExecutedKeys = new Set(
    executedDecisions
      .filter((event) => event.payload.executionStatus === "PLACED")
      .map((event) => `${event.payload.runId}:${event.payload.ticker}:${event.payload.side}`),
  );
  const placedExecutedDecisions = executedDecisions.filter((event) => event.payload.executionStatus === "PLACED");
  const nearMisses = [...preferredDecisionsByKey.values()]
    .filter((event) => !placedExecutedKeys.has(`${event.payload.runId}:${event.payload.ticker}:${event.payload.side}`))
    .filter((event) => {
      const adjustedEdge = event.payload.executionAdjustedEdge ?? event.payload.edge;
      return adjustedEdge > 0 && event.payload.confidence >= 0.35 && event.payload.verdict !== "PASS";
    })
    .sort((a, b) => {
      const aScore = (a.payload.executionAdjustedEdge ?? a.payload.edge) + (a.payload.compositeScore ?? 0);
      const bScore = (b.payload.executionAdjustedEdge ?? b.payload.edge) + (b.payload.compositeScore ?? 0);
      return bScore - aScore;
    });

  const executedAvgEdge = average(
    placedExecutedDecisions.reduce((sum, event) => sum + event.payload.edge, 0),
    placedExecutedDecisions.length,
  );
  const executedAvgExecutionAdjustedEdge = average(
    placedExecutedDecisions.reduce((sum, event) => sum + (event.payload.executionAdjustedEdge ?? event.payload.edge), 0),
    placedExecutedDecisions.length,
  );
  const executedAvgConfidence = average(
    placedExecutedDecisions.reduce((sum, event) => sum + event.payload.confidence, 0),
    placedExecutedDecisions.length,
  );
  const executedCompositeSamples = placedExecutedDecisions.filter((event) => typeof event.payload.compositeScore === "number");
  const executedAvgCompositeScore = average(
    executedCompositeSamples.reduce((sum, event) => sum + (event.payload.compositeScore ?? 0), 0),
    executedCompositeSamples.length,
  );

  const nearMissQuoteDrifts = nearMisses
    .map((event) => latestQuoteDriftForDecision({ decision: event, quotesByTicker }))
    .filter((value): value is number => value !== null);
  const gateSummaryMap = new Map<
    string,
    { gate: string; label: string; unit: "probability" | "usd" | "count" | "severity"; count: number; missSum: number; missCount: number; maxMissBy: number }
  >();
  const nearMissAvgEdge = average(
    nearMisses.reduce((sum, event) => sum + event.payload.edge, 0),
    nearMisses.length,
  );
  const nearMissAvgExecutionAdjustedEdge = average(
    nearMisses.reduce((sum, event) => sum + (event.payload.executionAdjustedEdge ?? event.payload.edge), 0),
    nearMisses.length,
  );
  const nearMissAvgConfidence = average(
    nearMisses.reduce((sum, event) => sum + event.payload.confidence, 0),
    nearMisses.length,
  );
  const nearMissCompositeSamples = nearMisses.filter((event) => typeof event.payload.compositeScore === "number");
  const nearMissAvgCompositeScore = average(
    nearMissCompositeSamples.reduce((sum, event) => sum + (event.payload.compositeScore ?? 0), 0),
    nearMissCompositeSamples.length,
  );
  const nearMissAvgLatestQuoteDrift = average(
    nearMissQuoteDrifts.reduce((sum, value) => sum + value, 0),
    nearMissQuoteDrifts.length,
  );
  let resolvedNearMissCount = 0;
  let resolvedNearMissHitCount = 0;
  let resolvedNearMissProfitableCount = 0;
  let resolvedNearMissPnlSum = 0;
  let resolvedNearMissExpiryDriftSum = 0;
  let resolvedNearMissExpiryDriftCount = 0;
  let resolvedNearMissDivergenceSum = 0;
  let resolvedNearMissDivergenceCount = 0;
  const seenRecentNearMisses = new Set<string>();
  const recentNearMisses = nearMisses
    .filter((event) => {
      const key = `${event.payload.ticker}:${event.payload.side}`;
      if (seenRecentNearMisses.has(key)) return false;
      seenRecentNearMisses.add(key);
      return true;
    })
    .slice(0, clamp(recentTradeLimit, 1, 30))
    .map((event) => {
      const dominantExpert = determineDominantExpert(event.payload.expertWeights);
      const latestQuoteDrift = latestQuoteDriftForDecision({ decision: event, quotesByTicker });
      const failedGates = (event.payload.gateDiagnostics ?? []).filter((diagnostic) => !diagnostic.passed && diagnostic.missBy > 0);
      for (const diagnostic of failedGates) {
        const accumulator = gateSummaryMap.get(diagnostic.gate) ?? {
          gate: diagnostic.gate,
          label: gateLabel(diagnostic.gate),
          unit: diagnostic.unit,
          count: 0,
          missSum: 0,
          missCount: 0,
          maxMissBy: 0,
        };
        accumulator.count += 1;
        if (Number.isFinite(diagnostic.missBy)) {
          accumulator.missSum += diagnostic.missBy;
          accumulator.missCount += 1;
          accumulator.maxMissBy = Math.max(accumulator.maxMissBy, diagnostic.missBy);
        }
        gateSummaryMap.set(diagnostic.gate, accumulator);
      }
      const resolution = resolutionByTicker.get(event.payload.ticker)?.payload;
      const settlementMark = settlementMarkForDecision(resolution, event.payload.side);
      const counterfactualPnlUsd =
        settlementMark !== null
          ? Number(
              (
                event.payload.recommendedContracts * (settlementMark - event.payload.limitPriceCents / 100) -
                (event.payload.feeEstimateUsd ?? 0)
              ).toFixed(4),
            )
          : null;
      const expiryDrift =
        settlementMark !== null ? Number((settlementMark - event.payload.marketProb).toFixed(4)) : null;
      const quoteToExpiryDivergence =
        settlementMark !== null && typeof latestQuoteDrift === "number"
          ? Number((expiryDrift! - latestQuoteDrift).toFixed(4))
          : null;
      if (settlementMark !== null && counterfactualPnlUsd !== null) {
        resolvedNearMissCount += 1;
        if (settlementMark > 0.5) resolvedNearMissHitCount += 1;
        if (counterfactualPnlUsd > 0) resolvedNearMissProfitableCount += 1;
        resolvedNearMissPnlSum += counterfactualPnlUsd;
        if (expiryDrift !== null) {
          resolvedNearMissExpiryDriftSum += expiryDrift;
          resolvedNearMissExpiryDriftCount += 1;
        }
        if (quoteToExpiryDivergence !== null) {
          resolvedNearMissDivergenceSum += quoteToExpiryDivergence;
          resolvedNearMissDivergenceCount += 1;
        }
        if (counterfactualPnlUsd > 0) {
          const sample = {
            settlementMark,
            counterfactualPnlUsd,
            latestQuoteDrift,
            marketProb: event.payload.marketProb,
          };
          pushCounterfactualBucket(falseNegativesByExpert, dominantExpert.expert, dominantExpert.expert, sample);
          pushCounterfactualBucket(
            falseNegativesByCluster,
            event.payload.riskCluster ?? `${event.payload.category}:${event.payload.ticker}`,
            event.payload.riskCluster ?? `${event.payload.category}:${event.payload.ticker}`,
            sample,
          );
          const toxicityLabel = toxicityBucket(event.payload.toxicityScore);
          pushCounterfactualBucket(falseNegativesByToxicity, toxicityLabel, toxicityLabel, sample);
        }
      }
      return {
        recordedAt: event.recordedAt,
        ticker: event.payload.ticker,
        title: event.payload.title,
        category: event.payload.category,
        side: event.payload.side,
        source: event.source,
        verdict: event.payload.verdict,
        dominantExpert: dominantExpert.expert,
        cluster: event.payload.riskCluster ?? `${event.payload.category}:${event.payload.ticker}`,
        edge: Number(event.payload.edge.toFixed(4)),
        executionAdjustedEdge: roundNullable(event.payload.executionAdjustedEdge ?? event.payload.edge),
        confidence: Number(event.payload.confidence.toFixed(4)),
        compositeScore: roundNullable(event.payload.compositeScore),
        latestQuoteDrift,
        settlementMark,
        resolved: settlementMark !== null,
        realizedHit: settlementMark !== null ? settlementMark > 0.5 : null,
        counterfactualPnlUsd,
        expiryDrift,
        quoteToExpiryDivergence,
        failedGates,
        executionMessage: event.payload.executionMessage,
      };
    });
  const byGate = [...gateSummaryMap.values()]
    .map((row) => ({
      gate: row.gate as CandidateGateKey,
      label: row.label,
      count: row.count,
      unit: row.unit,
      avgMissBy: average(row.missSum, row.missCount),
      maxMissBy: row.missCount > 0 ? roundNullable(row.maxMissBy) : null,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return (b.avgMissBy ?? 0) - (a.avgMissBy ?? 0);
    });

  return {
    generatedAt: new Date().toISOString(),
    lookbackHours,
    totals: {
      decisions: totals.decisions,
      placed: totals.placed,
      failed: totals.failed,
      skipped: totals.skipped,
      totalFilledContracts: Number(totals.totalFilledContracts.toFixed(4)),
      avgNetAlphaUsd: average(totals.netAlphaSum, totals.netAlphaCount),
      avgExecutionAdjustedEdge: average(totals.executionAdjustedEdgeSum, totals.executionAdjustedEdgeCount),
      avgMarkout30s: average(totals.markout30sSum, totals.markout30sCount),
      avgMarkout2m: average(totals.markout2mSum, totals.markout2mCount),
      avgMarkoutExpiry: average(totals.markoutExpirySum, totals.markoutExpiryCount),
      matchedReconciliations: totals.matchedReconciliations,
      avgCashDeltaDriftUsd: average(totals.cashDeltaDriftSum, totals.cashDeltaDriftCount),
      avgFeeDriftUsd: average(totals.feeDriftSum, totals.feeDriftCount),
    },
    byExpert: finalizeBuckets(byExpert, bucketLimit),
    byExecutionHealth: finalizeBuckets(byExecutionHealth, bucketLimit),
    byCluster: finalizeBuckets(byCluster, bucketLimit),
    byUncertaintyWidth: finalizeBuckets(byUncertainty, bucketLimit),
    byToxicity: finalizeBuckets(byToxicity, bucketLimit),
    byBootstrap: finalizeBuckets(byBootstrap, bucketLimit),
    recentTrades: trades.slice(0, clamp(recentTradeLimit, 1, 30)),
    selectionControl: {
      executed: {
        count: placedExecutedDecisions.length,
        avgEdge: executedAvgEdge,
        avgExecutionAdjustedEdge: executedAvgExecutionAdjustedEdge,
        avgConfidence: executedAvgConfidence,
        avgCompositeScore: executedAvgCompositeScore,
      },
      nearMisses: {
        count: nearMisses.length,
        avgEdge: nearMissAvgEdge,
        avgExecutionAdjustedEdge: nearMissAvgExecutionAdjustedEdge,
        avgConfidence: nearMissAvgConfidence,
        avgCompositeScore: nearMissAvgCompositeScore,
        avgLatestQuoteDrift: nearMissAvgLatestQuoteDrift,
      },
      resolvedNearMisses: {
        count: resolvedNearMissCount,
        hitRate: average(resolvedNearMissHitCount, resolvedNearMissCount),
        profitableRate: average(resolvedNearMissProfitableCount, resolvedNearMissCount),
        avgCounterfactualPnlUsd: average(resolvedNearMissPnlSum, resolvedNearMissCount),
        totalCounterfactualPnlUsd: resolvedNearMissCount > 0 ? roundNullable(resolvedNearMissPnlSum) : null,
        avgExpiryDrift: average(resolvedNearMissExpiryDriftSum, resolvedNearMissExpiryDriftCount),
        avgQuoteToExpiryDivergence: average(resolvedNearMissDivergenceSum, resolvedNearMissDivergenceCount),
      },
      falseNegativesByExpert: finalizeCounterfactualBuckets(falseNegativesByExpert, bucketLimit),
      falseNegativesByCluster: finalizeCounterfactualBuckets(falseNegativesByCluster, bucketLimit),
      falseNegativesByToxicity: finalizeCounterfactualBuckets(falseNegativesByToxicity, bucketLimit),
      byGate,
      recentNearMisses,
    },
  };
}

export async function loadExecutionAttributionSummary(args?: {
  lookbackHours?: number;
  recentTradeLimit?: number;
  bucketLimit?: number;
}): Promise<ExecutionAttributionSummary> {
  const lookbackHours = clamp(args?.lookbackHours ?? DEFAULT_LOOKBACK_HOURS, 1, 24 * 30);
  const sinceMs = Date.now() - lookbackHours * 60 * 60 * 1000;
  const [decisions, orders, fills, balances, quotes, resolutions, markouts] = await Promise.all([
    readStoredCandidateDecisionsSince(sinceMs),
    readStoredOrdersSince(sinceMs),
    readStoredFillsSince(sinceMs),
    readStoredBalancesSince(sinceMs),
    readStoredQuotesSince(sinceMs),
    readStoredResolutionsSince(sinceMs),
    readStoredMarkoutsSince(sinceMs),
  ]);

  return summarizeExecutionAttribution({
    lookbackHours,
    recentTradeLimit: args?.recentTradeLimit,
    bucketLimit: args?.bucketLimit,
    decisions,
    orders,
    fills,
    balances,
    quotes,
    resolutions,
    markouts,
  });
}
