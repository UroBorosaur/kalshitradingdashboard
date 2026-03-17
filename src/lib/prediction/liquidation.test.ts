import assert from "node:assert/strict";
import test from "node:test";

import { evaluateLiquidationDecision } from "@/lib/prediction/liquidation";
import type { PredictionMarketQuote } from "@/lib/prediction/types";

const market: PredictionMarketQuote = {
  ticker: "LQD",
  title: "Liquidation Market",
  category: "SPORTS",
  closeTime: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  yesBid: 0.99,
  yesAsk: 0.99,
  noBid: 0.01,
  noAsk: 0.01,
  yesBidSize: 5000,
  yesAskSize: 5000,
  noBidSize: 5000,
  noAskSize: 5000,
  lastPrice: 0.99,
  volume: 60000,
  openInterest: 20000,
  liquidityDollars: 400000,
  tickSize: 1,
  settlementTimerSeconds: 300,
  canCloseEarly: true,
  status: "open",
};

test("liquidation optimizer recommends flatten near close when exit dominates", () => {
  const decision = evaluateLiquidationDecision({
    position: {
      ticker: "LQD",
      market_title: "Liquidation Market",
      position_fp: "-100000",
      total_traded_dollars: 1500,
      market_exposure_dollars: 1500,
      resting_orders_count: 0,
      fees_paid: 0,
    },
    market,
    riskCluster: "SPORTS:LQD",
  });

  assert.ok(decision);
  assert.equal(decision?.action, "FLATTEN");
  assert.ok((decision?.valueExitNowUsd ?? 0) > (decision?.valueHoldToResolutionUsd ?? 0));
});
