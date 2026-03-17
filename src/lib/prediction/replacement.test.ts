import assert from "node:assert/strict";
import test from "node:test";

import { buildOpenExposureConstraint, evaluateReplacementDecision } from "@/lib/prediction/replacement";
import type { PredictionCandidate, PredictionMarketQuote } from "@/lib/prediction/types";

function market(ticker: string): PredictionMarketQuote {
  return {
    ticker,
    title: `${ticker} Market`,
    category: "SPORTS",
    closeTime: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    yesBid: 0.58,
    yesAsk: 0.6,
    noBid: 0.4,
    noAsk: 0.42,
    yesBidSize: 10,
    yesAskSize: 10,
    noBidSize: 10,
    noAskSize: 10,
    lastPrice: 0.59,
    volume: 500,
    openInterest: 100,
    liquidityDollars: 1200,
    tickSize: 1,
    settlementTimerSeconds: 300,
    canCloseEarly: true,
    status: "open",
  };
}

function challenger(): PredictionCandidate {
  return {
    ticker: "TEST",
    title: "Test Market",
    category: "SPORTS",
    side: "YES",
    marketProb: 0.58,
    modelProb: 0.67,
    edge: 0.05,
    executionAdjustedEdge: 0.041,
    expectedValuePerContract: 0.04,
    expectedValuePerDollarRisked: 0.07,
    confidence: 0.66,
    recommendedStakeUsd: 12,
    recommendedContracts: 20,
    limitPriceCents: 59,
    compositeScore: 0.012,
    liquidationCVaR: 0.03,
    uncertaintyWidth: 0.02,
    toxicityScore: 0.18,
    riskCluster: "SPORTS:TEST",
    netAlphaUsd: 0.8,
    rationale: [],
    simulated: true,
  };
}

test("replacement accepts better challenger against incumbent order", () => {
  const constraint = buildOpenExposureConstraint(
    [],
    [
      {
        order_id: "order-1",
        ticker: "TEST",
        title: "Test Market",
        side: "yes",
        action: "buy",
        status: "resting",
        count: 10,
        remaining_count: 10,
        yes_price: 90,
        created_time: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
    ],
    new Map([["TEST", market("TEST")]]),
    new Map([["TEST", "SPORTS:TEST"]]),
  );

  const decision = evaluateReplacementDecision({
    challenger: challenger(),
    incumbents: constraint.incumbentsByCandidateKey.get("TEST:YES") ?? [],
    controls: {
      enabled: true,
      minDelta: 0.005,
    },
  });

  assert.equal(decision.accepted, true);
  assert.equal(decision.action, "REPLACE_ORDER");
  assert.equal(decision.incumbentSource, "ORDER");
  assert.ok(decision.replacementScoreDelta >= 0.01);
});

test("replacement on incumbent position stays advisory-only", () => {
  const constraint = buildOpenExposureConstraint(
    [
      {
        ticker: "TEST",
        market_title: "Test Market",
        position_fp: "5",
        total_traded_dollars: 4.9,
        market_exposure_dollars: 4.9,
        resting_orders_count: 0,
        fees_paid: 0,
      },
    ],
    [],
    new Map([["TEST", market("TEST")]]),
    new Map([["TEST", "SPORTS:TEST"]]),
  );

  const decision = evaluateReplacementDecision({
    challenger: challenger(),
    incumbents: constraint.incumbentsByCandidateKey.get("TEST:YES") ?? [],
    controls: {
      enabled: true,
      minDelta: 0.005,
    },
  });

  assert.equal(decision.incumbentSource, "POSITION");
  assert.equal(decision.action, "RECOMMEND_POSITION_SWAP");
});
