import assert from "node:assert/strict";
import test from "node:test";

import { deriveClusterGuardSpecs } from "@/lib/prediction/order-group-rules";
import type { PredictionCandidate } from "@/lib/prediction/types";

function candidate(overrides: Partial<PredictionCandidate>): PredictionCandidate {
  return {
    ticker: "TEST",
    title: "Test",
    category: "SPORTS",
    side: "YES",
    marketProb: 0.8,
    modelProb: 0.84,
    edge: 0.02,
    expectedValuePerContract: 0.01,
    expectedValuePerDollarRisked: 0.01,
    confidence: 0.6,
    recommendedStakeUsd: 10,
    recommendedContracts: 10,
    limitPriceCents: 80,
    rationale: [],
    strategyTags: [],
    opportunityType: "TRADE",
    verdict: "BUY_YES",
    timeToCloseDays: 1,
    simulated: true,
    executionStatus: "SKIPPED",
    ...overrides,
  };
}

test("deriveClusterGuardSpecs tightens limits and triggers on critical toxicity", () => {
  const specs = deriveClusterGuardSpecs({
    actionable: [
      candidate({ riskCluster: "cluster-a", limitPriceCents: 75, toxicityScore: 0.35 }),
      candidate({ riskCluster: "cluster-a", limitPriceCents: 80, toxicityScore: 0.4 }),
      candidate({ riskCluster: "cluster-b", limitPriceCents: 60, toxicityScore: 0.97 }),
    ],
    clusterStakeLimitUsd: 40,
    executionHealthPenalty: 0.01,
  });

  const clusterA = specs.find((row) => row.clusterKey === "cluster-a");
  const clusterB = specs.find((row) => row.clusterKey === "cluster-b");

  assert.ok(clusterA);
  assert.ok(clusterB);
  assert.equal(clusterA?.shouldTrigger, false);
  assert.ok((clusterA?.contractsLimit ?? 0) >= 1);
  assert.equal(clusterB?.shouldTrigger, true);
});
