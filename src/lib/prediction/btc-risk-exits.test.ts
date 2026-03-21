import assert from "node:assert/strict";
import test from "node:test";

import { evaluateBitcoinRiskExit } from "@/lib/prediction/btc-risk-exits";
import type { KalshiPositionLite, PredictionMarketQuote } from "@/lib/prediction/types";

function bitcoinMarket(): PredictionMarketQuote {
  return {
    ticker: "KXBTC-TEST",
    title: "BTC above threshold in 15m",
    category: "BITCOIN",
    closeTime: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    yesBid: 0.58,
    yesAsk: 0.6,
    noBid: 0.4,
    noAsk: 0.42,
    yesBidSize: 20,
    yesAskSize: 20,
    noBidSize: 20,
    noAskSize: 20,
    lastPrice: 0.59,
    volume: 500,
    openInterest: 120,
    liquidityDollars: 2500,
    tickSize: 1,
    settlementTimerSeconds: 60,
    canCloseEarly: true,
    status: "open",
  };
}

test("btc stop loss triggers on adverse move", () => {
  const position: KalshiPositionLite = {
    ticker: "KXBTC-TEST",
    position_fp: "10",
    total_traded_dollars: "6.5",
  };

  const decision = evaluateBitcoinRiskExit({
    position,
    market: bitcoinMarket(),
    stopLossPct: 0.1,
    takeProfitPct: 0.25,
  });

  assert.ok(decision);
  assert.equal(decision?.trigger, "STOP_LOSS");
  assert.equal(decision?.exitSide, "NO");
});

test("btc take profit triggers on favorable move", () => {
  const position: KalshiPositionLite = {
    ticker: "KXBTC-TEST",
    position_fp: "-10",
    total_traded_dollars: "3",
  };
  const market = {
    ...bitcoinMarket(),
    yesBid: 0.22,
    yesAsk: 0.24,
    noBid: 0.76,
    noAsk: 0.78,
    lastPrice: 0.23,
  };

  const decision = evaluateBitcoinRiskExit({
    position,
    market,
    stopLossPct: 0.1,
    takeProfitPct: 0.25,
  });

  assert.ok(decision);
  assert.equal(decision?.trigger, "TAKE_PROFIT");
  assert.equal(decision?.exitSide, "YES");
});
