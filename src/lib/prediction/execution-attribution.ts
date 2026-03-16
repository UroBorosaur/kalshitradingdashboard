import "@/lib/server-only";

import { readStoredCandidateDecisionsSince, readStoredFillsSince, readStoredMarkoutsSince, readStoredOrdersSince } from "@/lib/storage/prediction-store";
import type {
  PredictionStorageEnvelope,
  StoredCandidateDecisionEvent,
  StoredKalshiFillEvent,
  StoredKalshiOrderEvent,
  StoredMarkoutEvent,
} from "@/lib/storage/types";
import type {
  ExecutionAttributionBucket,
  ExecutionAttributionSummary,
  ExecutionAttributionTrade,
  ExecutionBootstrapMode,
  ExecutionHealthRegime,
  PredictionSide,
} from "@/lib/prediction/types";

const EXECUTED_CANDIDATE_SOURCE = "automation/executed-candidates";
const DEFAULT_LOOKBACK_HOURS = 72;
const DEFAULT_RECENT_TRADE_LIMIT = 12;
const DEFAULT_BUCKET_LIMIT = 6;

type AttributionHorizon = "30s" | "2m" | "expiry";

interface SummarizeExecutionAttributionArgs {
  lookbackHours: number;
  recentTradeLimit?: number;
  bucketLimit?: number;
  decisions: Array<PredictionStorageEnvelope<StoredCandidateDecisionEvent>>;
  orders: Array<PredictionStorageEnvelope<StoredKalshiOrderEvent>>;
  fills: Array<PredictionStorageEnvelope<StoredKalshiFillEvent>>;
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
  };
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

function summarizeOrderExecution(args: {
  decision: StoredCandidateDecisionEvent;
  orderId?: string;
  fillsByOrderId: Map<string, StoredKalshiFillEvent[]>;
  markoutsByFillId: Map<string, Map<AttributionHorizon, StoredMarkoutEvent>>;
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

  return {
    filledContracts: Number(filledContracts.toFixed(4)),
    averageFillPriceCents:
      fillPriceWeight > 0 ? Number((fillPriceWeighted / fillPriceWeight).toFixed(4)) : null,
    markout30s: horizonCounts["30s"] > 0 ? Number((horizonSums["30s"] / horizonCounts["30s"]).toFixed(4)) : null,
    markout2m: horizonCounts["2m"] > 0 ? Number((horizonSums["2m"] / horizonCounts["2m"]).toFixed(4)) : null,
    markoutExpiry:
      horizonCounts.expiry > 0 ? Number((horizonSums.expiry / horizonCounts.expiry).toFixed(4)) : null,
  };
}

export function summarizeExecutionAttribution({
  lookbackHours,
  recentTradeLimit = DEFAULT_RECENT_TRADE_LIMIT,
  bucketLimit = DEFAULT_BUCKET_LIMIT,
  decisions,
  orders,
  fills,
  markouts,
}: SummarizeExecutionAttributionArgs): ExecutionAttributionSummary {
  const executedDecisions = decisions
    .filter((event) => event.source === EXECUTED_CANDIDATE_SOURCE)
    .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());

  const ordersByClientOrderId = new Map<string, StoredKalshiOrderEvent>();
  for (const order of orders) {
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

  const byExpert = new Map<string, BucketAccumulator>();
  const byExecutionHealth = new Map<string, BucketAccumulator>();
  const byCluster = new Map<string, BucketAccumulator>();
  const byUncertainty = new Map<string, BucketAccumulator>();
  const byToxicity = new Map<string, BucketAccumulator>();
  const byBootstrap = new Map<string, BucketAccumulator>();
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
    const executionStats = summarizeOrderExecution({
      decision,
      orderId,
      fillsByOrderId,
      markoutsByFillId,
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
    },
    byExpert: finalizeBuckets(byExpert, bucketLimit),
    byExecutionHealth: finalizeBuckets(byExecutionHealth, bucketLimit),
    byCluster: finalizeBuckets(byCluster, bucketLimit),
    byUncertaintyWidth: finalizeBuckets(byUncertainty, bucketLimit),
    byToxicity: finalizeBuckets(byToxicity, bucketLimit),
    byBootstrap: finalizeBuckets(byBootstrap, bucketLimit),
    recentTrades: trades.slice(0, clamp(recentTradeLimit, 1, 30)),
  };
}

export async function loadExecutionAttributionSummary(args?: {
  lookbackHours?: number;
  recentTradeLimit?: number;
  bucketLimit?: number;
}): Promise<ExecutionAttributionSummary> {
  const lookbackHours = clamp(args?.lookbackHours ?? DEFAULT_LOOKBACK_HOURS, 1, 24 * 30);
  const sinceMs = Date.now() - lookbackHours * 60 * 60 * 1000;
  const [decisions, orders, fills, markouts] = await Promise.all([
    readStoredCandidateDecisionsSince(sinceMs),
    readStoredOrdersSince(sinceMs),
    readStoredFillsSince(sinceMs),
    readStoredMarkoutsSince(sinceMs),
  ]);

  return summarizeExecutionAttribution({
    lookbackHours,
    recentTradeLimit: args?.recentTradeLimit,
    bucketLimit: args?.bucketLimit,
    decisions,
    orders,
    fills,
    markouts,
  });
}
