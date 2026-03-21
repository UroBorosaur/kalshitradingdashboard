import assert from "node:assert/strict";
import test from "node:test";

import { buildStrategyPerformanceProfile, evaluateStrategyPerformanceAdjustment } from "@/lib/prediction/strategy-performance";
import type { ExecutionAttributionSummary, ExecutionAttributionTrade } from "@/lib/prediction/types";

function trade(overrides: Partial<ExecutionAttributionTrade>): ExecutionAttributionTrade {
  return {
    recordedAt: new Date().toISOString(),
    ticker: "KXBTC15M-TEST",
    title: "BTC Test",
    category: "BITCOIN",
    side: "YES",
    executionStatus: "PLACED",
    executionMessage: "placed",
    dominantExpert: "PHYSICAL_BRIDGE",
    dominantExpertWeight: 0.5,
    cluster: "BITCOIN:MICRO",
    bootstrapMode: "ACKED",
    executionHealthRegime: "NORMAL",
    uncertaintyBucket: "Tight <=2%",
    toxicityBucket: "Low <20%",
    marketProb: 0.28,
    modelProb: 0.35,
    edge: 0.05,
    executionAdjustedEdge: 0.12,
    netAlphaUsd: 1.2,
    limitPriceCents: 28,
    filledContracts: 1,
    averageFillPriceCents: 28,
    markout30s: 0.04,
    markout2m: 0.05,
    markoutExpiry: 0.07,
    balanceBeforeCashUsd: null,
    balanceAfterCashUsd: null,
    balanceBeforePortfolioUsd: null,
    balanceAfterPortfolioUsd: null,
    expectedExecutionCostUsd: null,
    actualCashDeltaUsd: null,
    inferredActualFeeUsd: null,
    estimatedFeeUsd: null,
    feeDriftUsd: null,
    cashDeltaDriftUsd: null,
    reconciliationMatched: false,
    strategyTags: ["BTC_MICRO_LONGSHOT", "PHYSICAL_MEASURE_BRIDGE", "QUEUE_REACTIVE_EXECUTION"],
    ...overrides,
  };
}

function attributionFromTrades(trades: ExecutionAttributionTrade[]): ExecutionAttributionSummary {
  return {
    generatedAt: new Date().toISOString(),
    lookbackHours: 96,
    totals: {
      decisions: trades.length,
      placed: trades.length,
      failed: 0,
      skipped: 0,
      totalFilledContracts: trades.length,
      avgNetAlphaUsd: 1,
      avgExecutionAdjustedEdge: 0.08,
      avgMarkout30s: 0.03,
      avgMarkout2m: 0.04,
      avgMarkoutExpiry: 0.05,
      matchedReconciliations: 0,
      avgCashDeltaDriftUsd: null,
      avgFeeDriftUsd: null,
    },
    byExpert: [],
    byExecutionHealth: [],
    byCluster: [],
    byUncertaintyWidth: [],
    byToxicity: [],
    byBootstrap: [],
    recentTrades: trades,
  };
}

test("strategy performance profile favors BTC micro longshots with positive realized outcomes", () => {
  const profile = buildStrategyPerformanceProfile({
    attribution: attributionFromTrades([
      trade({ ticker: "KXBTC15M-A" }),
      trade({ ticker: "KXBTC15M-B", markoutExpiry: 0.06, executionAdjustedEdge: 0.11 }),
      trade({
        ticker: "KXNBA-A",
        category: "SPORTS",
        executionAdjustedEdge: 0.02,
        markout30s: -0.01,
        markout2m: -0.01,
        markoutExpiry: -0.02,
        strategyTags: ["FAVORITE_LONGSHOT_BIAS"],
      }),
    ]),
    lookbackHours: 96,
    maxBoost: 0.0025,
  });

  assert.ok(profile);
  assert.equal(profile?.totalPlacedTrades, 3);
  assert.equal(profile?.topTags[0]?.key, "BTC_MICRO_LONGSHOT");
  assert.ok((profile?.topTags[0]?.recommendedBoost ?? 0) > 0);
});

test("strategy performance adjustment boosts 15m BTC longshots without bypassing bounds", () => {
  const profile = buildStrategyPerformanceProfile({
    attribution: attributionFromTrades([
      trade({ ticker: "KXBTC15M-A" }),
      trade({ ticker: "KXBTC15M-B" }),
      trade({
        ticker: "KXNBA-A",
        category: "SPORTS",
        executionAdjustedEdge: 0.01,
        markout30s: -0.01,
        markout2m: -0.01,
        markoutExpiry: -0.02,
        strategyTags: ["FAVORITE_LONGSHOT_BIAS"],
      }),
    ]),
    lookbackHours: 96,
    maxBoost: 0.0025,
  });

  const adjustment = evaluateStrategyPerformanceAdjustment({
    candidate: {
      category: "BITCOIN",
      strategyTags: ["BTC_MICRO_LONGSHOT", "PHYSICAL_MEASURE_BRIDGE"],
      timeToCloseDays: 15 / (24 * 60),
    },
    profile,
    enabled: true,
    maxBoost: 0.0025,
    focusHorizonDays: 15 / (24 * 60),
  });

  assert.ok(adjustment.scoreBoost > 0);
  assert.ok(adjustment.scoreBoost <= 0.0025);
  assert.ok(adjustment.utilityMultiplier > 1);
  assert.ok(adjustment.reasons.some((reason) => reason.includes("BTC 15m micro longshot")));
});
