import assert from "node:assert/strict";
import test from "node:test";

import { evaluateSportsUnderdogLongshot } from "@/lib/prediction/sports-longshot";
import type { PredictionMarketQuote } from "@/lib/prediction/types";

function sportsMarket(ticker: string, title: string, yesAsk: number, noAsk: number, lastPrice = yesAsk): PredictionMarketQuote {
  return {
    ticker,
    title,
    eventTicker: "KXNCAABGAME-TEST",
    category: "SPORTS",
    closeTime: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    yesBid: Math.max(0.01, yesAsk - 0.04),
    yesAsk,
    noBid: Math.max(0.01, noAsk - 0.04),
    noAsk,
    yesBidSize: 20,
    yesAskSize: 20,
    noBidSize: 20,
    noAskSize: 20,
    lastPrice,
    volume: 120,
    openInterest: 60,
    liquidityDollars: 800,
    tickSize: 1,
    settlementTimerSeconds: 60,
    canCloseEarly: true,
    status: "open",
  };
}

test("sports underdog asymmetry qualifies with strong model gap and cheaper equivalent representation", () => {
  const illinois = sportsMarket("KXTEST-ILL", "Wisconsin at Illinois Winner?", 0.42, 0.58, 0.42);
  const wisconsin = sportsMarket("KXTEST-WIS", "Wisconsin at Illinois Winner?", 0.62, 0.38, 0.62);

  const result = evaluateSportsUnderdogLongshot({
    enabled: true,
    market: wisconsin,
    relatedMarkets: [illinois],
    selectedSide: "NO",
    timeToCloseDays: 6 / 24,
    modelProb: 0.53,
    marketProb: 0.38,
    edge: 0.028,
    confidence: 0.39,
    spread: 0.04,
    liquidityScore: 0.28,
    marketProbabilityCeiling: 0.45,
    minGap: 0.075,
    minEdge: 0.012,
    minConfidence: 0.34,
    maxSpread: 0.12,
    minLiquidityScore: 0.18,
    focusWindowDays: 18 / 24,
    maxWindowDays: 3.5,
    modelProbabilityFloor: 0.24,
    confirmationGapMin: 0.025,
    sizeScale: 0.34,
  });

  assert.ok(result);
  assert.equal(result?.eligible, true);
  assert.equal(result?.counterpartTicker, "KXTEST-ILL");
  assert.ok((result?.equivalentPriceAdvantage ?? 0) >= 0.04);
});

test("sports underdog asymmetry rejects weak gaps without counterpart confirmation", () => {
  const illinois = sportsMarket("KXTEST-ILL", "Wisconsin at Illinois Winner?", 0.42, 0.58, 0.42);
  const weakCounterpart = sportsMarket("KXTEST-WIS", "Wisconsin at Illinois Winner?", 0.56, 0.44, 0.56);

  const result = evaluateSportsUnderdogLongshot({
    enabled: true,
    market: illinois,
    relatedMarkets: [weakCounterpart],
    selectedSide: "YES",
    timeToCloseDays: 6 / 24,
    modelProb: 0.48,
    marketProb: 0.42,
    edge: 0.01,
    confidence: 0.35,
    spread: 0.04,
    liquidityScore: 0.24,
    marketProbabilityCeiling: 0.45,
    minGap: 0.075,
    minEdge: 0.012,
    minConfidence: 0.34,
    maxSpread: 0.12,
    minLiquidityScore: 0.18,
    focusWindowDays: 18 / 24,
    maxWindowDays: 3.5,
    modelProbabilityFloor: 0.24,
    confirmationGapMin: 0.025,
    sizeScale: 0.34,
  });

  assert.ok(result);
  assert.equal(result?.eligible, false);
});
