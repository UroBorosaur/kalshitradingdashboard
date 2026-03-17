import assert from "node:assert/strict";
import test from "node:test";

import { evaluateOrderMaintenance } from "@/lib/prediction/order-maintenance";
import type { PredictionCandidate, PredictionMarketQuote } from "@/lib/prediction/types";

const market: PredictionMarketQuote = {
  ticker: "TEST",
  title: "Test Market",
  category: "SPORTS",
  closeTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  yesBid: 0.56,
  yesAsk: 0.58,
  noBid: 0.42,
  noAsk: 0.44,
  yesBidSize: 10,
  yesAskSize: 10,
  noBidSize: 10,
  noAskSize: 10,
  lastPrice: 0.57,
  volume: 200,
  openInterest: 40,
  liquidityDollars: 500,
  tickSize: 1,
  settlementTimerSeconds: 300,
  canCloseEarly: true,
  status: "open",
};

const challenger: PredictionCandidate = {
  ticker: "TEST",
  title: "Test Market",
  category: "SPORTS",
  side: "YES",
  marketProb: 0.57,
  modelProb: 0.65,
  edge: 0.04,
  executionAdjustedEdge: 0.03,
  expectedValuePerContract: 0.03,
  expectedValuePerDollarRisked: 0.04,
  confidence: 0.6,
  recommendedStakeUsd: 8,
  recommendedContracts: 12,
  limitPriceCents: 58,
  netAlphaUsd: 0.6,
  executionPlan: {
    limitPriceCents: 58,
    patienceHours: 0.2,
    fillProbability: 0.72,
    expectedExecutionValueUsd: 0.12,
    feeUsd: 0.02,
    role: "MAKER",
  },
  rationale: [],
  simulated: true,
};

test("order maintenance reprices stale order when EV improves enough", () => {
  const decision = evaluateOrderMaintenance({
    order: {
      order_id: "order-1",
      ticker: "TEST",
      title: "Test Market",
      side: "yes",
      action: "buy",
      status: "resting",
      count: 20,
      remaining_count: 20,
      yes_price: 70,
      created_time: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    },
    market,
    challenger: {
      ...challenger,
      netAlphaUsd: 0.05,
    },
    minImprovement: 0.005,
  });

  assert.equal(decision.action, "REPRICE");
  assert.ok(decision.expectedImprovement >= 0.005);
});

test("order maintenance cancels when cluster is triggered and challenger value is better elsewhere", () => {
  const decision = evaluateOrderMaintenance({
    order: {
      order_id: "order-2",
      ticker: "TEST",
      title: "Test Market",
      side: "yes",
      action: "buy",
      status: "resting",
      count: 1,
      remaining_count: 1,
      yes_price: 60,
      created_time: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    },
    market,
    challenger: {
      ...challenger,
      netAlphaUsd: 2,
    },
    minImprovement: 0.001,
    clusterTriggered: true,
  });

  assert.equal(decision.action, "CANCEL");
});
