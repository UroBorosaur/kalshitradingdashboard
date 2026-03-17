import assert from "node:assert/strict";
import test from "node:test";

import { saveStorageState } from "@/lib/storage/jsonl";
import { loadWatchlistState, updateWatchlistLifecycle } from "@/lib/prediction/watchlist";
import type { PredictionCandidate } from "@/lib/prediction/types";

function watchCandidate(overrides: Partial<PredictionCandidate> = {}): PredictionCandidate {
  return {
    ticker: "WATCH",
    title: "Watch Market",
    category: "OTHER",
    side: "YES",
    marketProb: 0.45,
    modelProb: 0.5,
    edge: 0.018,
    executionAdjustedEdge: 0.014,
    expectedValuePerContract: 0.01,
    expectedValuePerDollarRisked: 0.02,
    confidence: 0.44,
    recommendedStakeUsd: 3,
    recommendedContracts: 5,
    limitPriceCents: 45,
    verdict: "WATCHLIST",
    rationale: [],
    simulated: true,
    ...overrides,
  };
}

test("watchlist lifecycle persists and promotes improving candidate", async () => {
  await saveStorageState("prediction-watchlist", { stateVersion: 1, items: {} });

  const first = await updateWatchlistLifecycle({
    runId: "run-1",
    candidates: [watchCandidate()],
    promotionThreshold: 0.03,
    enabled: true,
  });

  assert.equal(first.events[0]?.type, "ADDED");
  assert.equal(first.promotions.get("WATCH:YES")?.promoted, false);

  const second = await updateWatchlistLifecycle({
    runId: "run-2",
    candidates: [
      watchCandidate({
        marketProb: 0.43,
        edge: 0.03,
        executionAdjustedEdge: 0.026,
        confidence: 0.55,
        toxicityScore: 0.08,
        uncertaintyWidth: 0.02,
      }),
    ],
    promotionThreshold: 0.03,
    enabled: true,
  });

  assert.equal(second.promotions.get("WATCH:YES")?.promoted, true);
  const state = await loadWatchlistState();
  assert.equal(state["WATCH:YES"]?.cyclesObserved, 2);
  assert.equal(state["WATCH:YES"]?.promotedCount, 1);

  await saveStorageState("prediction-watchlist", { stateVersion: 1, items: {} });
});
