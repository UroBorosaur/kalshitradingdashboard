import type {
  ExecutionAttributionSummary,
  ExecutionAttributionTrade,
  PredictionCandidate,
  PredictionCategory,
  StrategyPerformanceProfile,
  StrategyPerformanceSlice,
  StrategyTag,
} from "@/lib/prediction/types";

const TAG_PREVALENCE_CEILING = 0.85;
const TAG_MIN_TRADES = 2;
const CATEGORY_MIN_TRADES = 2;
const BTC_MICRO_LONGSHOT_FOCUS_MULTIPLIER = 1.35;
const BTC_MICRO_BRIDGE_MULTIPLIER = 1.15;
const SPORTS_UNDERDOG_FOCUS_MULTIPLIER = 1.2;

interface StrategyBucketAccumulator {
  trades: number;
  executionAdjustedEdgeSum: number;
  executionAdjustedEdgeCount: number;
  markout30sSum: number;
  markout30sCount: number;
  markoutExpirySum: number;
  markoutExpiryCount: number;
  netAlphaUsdSum: number;
  netAlphaUsdCount: number;
  examples: string[];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function average(sum: number, count: number) {
  return count > 0 ? sum / count : null;
}

function pushExample(bucket: StrategyBucketAccumulator, ticker: string) {
  if (!ticker) return;
  if (bucket.examples.includes(ticker)) return;
  if (bucket.examples.length < 4) bucket.examples.push(ticker);
}

function createBucket(): StrategyBucketAccumulator {
  return {
    trades: 0,
    executionAdjustedEdgeSum: 0,
    executionAdjustedEdgeCount: 0,
    markout30sSum: 0,
    markout30sCount: 0,
    markoutExpirySum: 0,
    markoutExpiryCount: 0,
    netAlphaUsdSum: 0,
    netAlphaUsdCount: 0,
    examples: [],
  };
}

function accumulate(bucket: StrategyBucketAccumulator, trade: ExecutionAttributionTrade) {
  bucket.trades += 1;
  if (typeof trade.executionAdjustedEdge === "number" && Number.isFinite(trade.executionAdjustedEdge)) {
    bucket.executionAdjustedEdgeSum += trade.executionAdjustedEdge;
    bucket.executionAdjustedEdgeCount += 1;
  }
  if (typeof trade.markout30s === "number" && Number.isFinite(trade.markout30s)) {
    bucket.markout30sSum += trade.markout30s;
    bucket.markout30sCount += 1;
  }
  if (typeof trade.markoutExpiry === "number" && Number.isFinite(trade.markoutExpiry)) {
    bucket.markoutExpirySum += trade.markoutExpiry;
    bucket.markoutExpiryCount += 1;
  }
  if (typeof trade.netAlphaUsd === "number" && Number.isFinite(trade.netAlphaUsd)) {
    bucket.netAlphaUsdSum += trade.netAlphaUsd;
    bucket.netAlphaUsdCount += 1;
  }
  pushExample(bucket, trade.ticker);
}

function scoreBucket(args: {
  bucket: StrategyBucketAccumulator;
  totalTrades: number;
  minTrades: number;
  maxBoost: number;
  prevalenceCeiling?: number;
}): Omit<StrategyPerformanceSlice, "key"> | null {
  const { bucket, totalTrades, minTrades, maxBoost, prevalenceCeiling } = args;
  if (bucket.trades < minTrades || totalTrades <= 0) return null;
  const prevalence = bucket.trades / totalTrades;
  if (prevalenceCeiling !== undefined && prevalence > prevalenceCeiling) return null;

  const avgExecutionAdjustedEdge = average(bucket.executionAdjustedEdgeSum, bucket.executionAdjustedEdgeCount);
  const avgMarkout30s = average(bucket.markout30sSum, bucket.markout30sCount);
  const avgMarkoutExpiry = average(bucket.markoutExpirySum, bucket.markoutExpiryCount);
  const avgNetAlphaUsd = average(bucket.netAlphaUsdSum, bucket.netAlphaUsdCount);
  const markoutSignal =
    avgMarkoutExpiry !== null
      ? avgMarkoutExpiry
      : avgMarkout30s !== null
        ? avgMarkout30s * 0.75
        : 0;
  const alphaSignal = avgNetAlphaUsd !== null ? Math.tanh(avgNetAlphaUsd / 5) * 0.01 : 0;
  const sampleConfidence = clamp(Math.sqrt(bucket.trades / 6), 0.4, 1);
  const profitabilityScore = Number(
    (
      sampleConfidence *
      (0.55 * (avgExecutionAdjustedEdge ?? 0) + 0.35 * markoutSignal + 0.1 * alphaSignal)
    ).toFixed(6),
  );
  const recommendedBoost = Number(clamp(profitabilityScore, -maxBoost, maxBoost).toFixed(6));

  return {
    trades: bucket.trades,
    prevalence: Number(prevalence.toFixed(4)),
    avgExecutionAdjustedEdge: avgExecutionAdjustedEdge !== null ? Number(avgExecutionAdjustedEdge.toFixed(6)) : null,
    avgMarkout30s: avgMarkout30s !== null ? Number(avgMarkout30s.toFixed(6)) : null,
    avgMarkoutExpiry: avgMarkoutExpiry !== null ? Number(avgMarkoutExpiry.toFixed(6)) : null,
    avgNetAlphaUsd: avgNetAlphaUsd !== null ? Number(avgNetAlphaUsd.toFixed(4)) : null,
    profitabilityScore,
    recommendedBoost,
    examples: bucket.examples,
  };
}

export function buildStrategyPerformanceProfile(args: {
  attribution: ExecutionAttributionSummary | null;
  trades?: ExecutionAttributionTrade[];
  lookbackHours: number;
  maxBoost: number;
}): StrategyPerformanceProfile | null {
  const trades = args.trades ?? args.attribution?.recentTrades ?? [];
  const placedTrades = trades.filter((trade) => trade.executionStatus === "PLACED");
  if (!placedTrades.length) return null;

  const tagBuckets = new Map<string, StrategyBucketAccumulator>();
  const categoryBuckets = new Map<string, StrategyBucketAccumulator>();

  for (const trade of placedTrades) {
    const tags = Array.isArray(trade.strategyTags) && trade.strategyTags.length ? trade.strategyTags : [];
    for (const tag of tags) {
      const bucket = tagBuckets.get(tag) ?? createBucket();
      accumulate(bucket, trade);
      tagBuckets.set(tag, bucket);
    }
    const categoryKey = trade.category;
    const categoryBucket = categoryBuckets.get(categoryKey) ?? createBucket();
    accumulate(categoryBucket, trade);
    categoryBuckets.set(categoryKey, categoryBucket);
  }

  const topTags = [...tagBuckets.entries()]
    .map(([key, bucket]) => {
      const scored = scoreBucket({
        bucket,
        totalTrades: placedTrades.length,
        minTrades: TAG_MIN_TRADES,
        maxBoost: args.maxBoost,
        prevalenceCeiling: TAG_PREVALENCE_CEILING,
      });
      return scored ? { key, ...scored } : null;
    })
    .filter((row): row is StrategyPerformanceSlice => row !== null)
    .sort((left, right) => right.profitabilityScore - left.profitabilityScore)
    .slice(0, 10);

  const topCategories = [...categoryBuckets.entries()]
    .map(([key, bucket]) => {
      const scored = scoreBucket({
        bucket,
        totalTrades: placedTrades.length,
        minTrades: CATEGORY_MIN_TRADES,
        maxBoost: Math.min(args.maxBoost * 0.7, 0.0018),
      });
      return scored ? { key, ...scored } : null;
    })
    .filter((row): row is StrategyPerformanceSlice => row !== null)
    .sort((left, right) => right.profitabilityScore - left.profitabilityScore)
    .slice(0, 8);

  return {
    generatedAt: new Date().toISOString(),
    lookbackHours: args.lookbackHours,
    totalPlacedTrades: placedTrades.length,
    topTags,
    topCategories,
  };
}

function bestMatchingTagBoost(
  candidate: Pick<PredictionCandidate, "category" | "strategyTags" | "timeToCloseDays">,
  profile: StrategyPerformanceProfile,
) {
  const tags = candidate.strategyTags ?? [];
  const matches = profile.topTags.filter((slice) => tags.includes(slice.key as StrategyTag));
  if (!matches.length) return { boost: 0, reasons: [] as string[] };
  const selected = matches
    .filter((slice) => slice.recommendedBoost > 0)
    .sort((left, right) => right.recommendedBoost - left.recommendedBoost)
    .slice(0, 2);
  const reasons = selected.map(
    (slice) =>
      `${slice.key} recent profile: ${slice.trades} placed trades, ${((slice.avgExecutionAdjustedEdge ?? 0) * 100).toFixed(2)}% avg exec edge, boost ${slice.recommendedBoost.toFixed(4)}.`,
  );
  const boost = selected.length
    ? Number((selected.reduce((sum, slice) => sum + slice.recommendedBoost, 0) / selected.length).toFixed(6))
    : 0;
  return { boost, reasons };
}

function categoryBoost(category: PredictionCategory, profile: StrategyPerformanceProfile) {
  return profile.topCategories.find((slice) => slice.key === category)?.recommendedBoost ?? 0;
}

export function evaluateStrategyPerformanceAdjustment(args: {
  candidate: Pick<PredictionCandidate, "category" | "strategyTags" | "timeToCloseDays">;
  profile: StrategyPerformanceProfile | null;
  enabled: boolean;
  maxBoost: number;
  focusHorizonDays: number;
}): { scoreBoost: number; utilityMultiplier: number; reasons: string[] } {
  const { candidate, profile, enabled, maxBoost, focusHorizonDays } = args;
  if (!enabled || !profile) {
    return { scoreBoost: 0, utilityMultiplier: 1, reasons: [] };
  }

  const tagMatch = bestMatchingTagBoost(candidate, profile);
  const categoryBias = categoryBoost(candidate.category, profile);
  let scoreBoost = tagMatch.boost * 0.75 + categoryBias * 0.25;
  const reasons = [...tagMatch.reasons];

  if (
    candidate.category === "BITCOIN" &&
    candidate.strategyTags?.includes("BTC_MICRO_LONGSHOT") &&
    (candidate.timeToCloseDays ?? 999) <= focusHorizonDays
  ) {
    const laneBoost = profile.topTags.find((slice) => slice.key === "BTC_MICRO_LONGSHOT")?.recommendedBoost ?? 0;
    if (laneBoost > 0) {
      const boosted = laneBoost * BTC_MICRO_LONGSHOT_FOCUS_MULTIPLIER;
      scoreBoost += boosted;
      reasons.push(`BTC 15m micro longshot focus boost ${boosted.toFixed(4)} from recent longshot executions.`);
    }
  }
  if (
    candidate.category === "BITCOIN" &&
    candidate.strategyTags?.includes("PHYSICAL_MEASURE_BRIDGE")
  ) {
    const bridgeBoost = profile.topTags.find((slice) => slice.key === "PHYSICAL_MEASURE_BRIDGE")?.recommendedBoost ?? 0;
    if (bridgeBoost > 0) {
      const boosted = bridgeBoost * BTC_MICRO_BRIDGE_MULTIPLIER;
      scoreBoost += boosted;
      reasons.push(`BTC physical-bridge boost ${boosted.toFixed(4)} from recent bridge trades.`);
    }
  }
  if (
    candidate.category === "SPORTS" &&
    candidate.strategyTags?.includes("SPORTS_UNDERDOG_ASYMMETRY")
  ) {
    const laneBoost = profile.topTags.find((slice) => slice.key === "SPORTS_UNDERDOG_ASYMMETRY")?.recommendedBoost ?? 0;
    if (laneBoost > 0) {
      const boosted = laneBoost * SPORTS_UNDERDOG_FOCUS_MULTIPLIER;
      scoreBoost += boosted;
      reasons.push(`Sports underdog asymmetry boost ${boosted.toFixed(4)} from recent low-cost winner trades.`);
    }
  }

  scoreBoost = Number(clamp(scoreBoost, -maxBoost, maxBoost).toFixed(6));
  const utilityMultiplier = Number((1 + clamp(scoreBoost * 25, -0.18, 0.18)).toFixed(6));
  return { scoreBoost, utilityMultiplier, reasons };
}
