import assert from "node:assert/strict";
import test from "node:test";

import { buildFalseNegativeLearning } from "@/lib/prediction/false-negative-learning";
import type { ExecutionAttributionSummary } from "@/lib/prediction/types";

const attribution = {
  generatedAt: new Date().toISOString(),
  lookbackHours: 72,
  totals: {
    decisions: 0,
    placed: 0,
    failed: 0,
    skipped: 0,
    totalFilledContracts: 0,
    avgNetAlphaUsd: null,
    avgExecutionAdjustedEdge: null,
    avgMarkout30s: null,
    avgMarkout2m: null,
    avgMarkoutExpiry: null,
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
  recentTrades: [],
  selectionControl: {
    executed: { count: 0, avgEdge: null, avgExecutionAdjustedEdge: null, avgConfidence: null, avgCompositeScore: null },
    nearMisses: { count: 0, avgEdge: null, avgExecutionAdjustedEdge: null, avgConfidence: null, avgCompositeScore: null, avgLatestQuoteDrift: null },
    resolvedNearMisses: {
      count: 8,
      hitRate: 0.62,
      profitableRate: 0.55,
      avgCounterfactualPnlUsd: 0.42,
      totalCounterfactualPnlUsd: 3.36,
      avgExpiryDrift: 0.03,
      avgQuoteToExpiryDivergence: 0.01,
    },
    falseNegativesByExpert: [],
    falseNegativesByCluster: [],
    falseNegativesByToxicity: [],
    byGate: [
      { gate: "CONFIDENCE_FLOOR", label: "Confidence floor", count: 4, unit: "probability", avgMissBy: 0.009, maxMissBy: 0.02 },
      { gate: "POSITION_ORDER_CONFLICT", label: "Existing conflict", count: 6, unit: "count", avgMissBy: 1, maxMissBy: 1 },
    ],
    gateWaterfall: [],
    counterfactualByGate: [],
    recentNearMisses: [],
  },
} satisfies ExecutionAttributionSummary;

test("false-negative learning emits bounded recommendation and skips structural hard guards", () => {
  const output = buildFalseNegativeLearning({
    attribution,
    lookbackHours: 72,
    active: false,
  });

  assert.equal(output.recommendations.length, 1);
  assert.equal(output.recommendations[0]?.gate, "CONFIDENCE_FLOOR");
  assert.ok((output.recommendations[0]?.boundedDelta ?? 0) <= 0.01);
  assert.equal(output.recommendations[0]?.active, false);
});
