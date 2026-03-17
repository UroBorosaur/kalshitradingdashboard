import assert from "node:assert/strict";
import test from "node:test";

import { estimateLeadLagSignal, estimateSilentClockContribution } from "@/lib/prediction/signal-overlays";
import type { PredictionMarketQuote } from "@/lib/prediction/types";

function baseMarket(ticker: string, title: string): PredictionMarketQuote {
  return {
    ticker,
    title,
    eventTicker: "EVENT-1",
    category: "POLITICS",
    closeTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    expectedExpirationTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    latestExpirationTime: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    yesBid: 0.48,
    yesAsk: 0.5,
    noBid: 0.5,
    noAsk: 0.52,
    yesBidSize: 20,
    yesAskSize: 20,
    noBidSize: 20,
    noAskSize: 20,
    lastPrice: 0.49,
    volume: 120,
    openInterest: 30,
    liquidityDollars: 900,
    tickSize: 1,
    settlementTimerSeconds: 300,
    rulesPrimary: "Resolves YES if Trump mentions nuclear policy before close.",
    canCloseEarly: true,
    status: "open",
  };
}

test("silent-clock overlay applies bounded decay after checkpoint passes", () => {
  const overlay = estimateSilentClockContribution({
    market: baseMarket("LAG", "Will Trump mention nuclear policy?"),
    baseProbability: 0.54,
  });

  assert.ok(overlay);
  assert.equal(overlay?.eligible, true);
  assert.ok((overlay?.decayPenalty ?? 0) > 0);
  assert.ok((overlay?.adjustedProbability ?? 1) < 0.54);
});

test("lead-lag overlay detects conservative lag signal from related markets", () => {
  const lagMarket = baseMarket("LAG", "Will Trump mention nuclear policy?");
  const leadMarket = { ...baseMarket("LEAD", "Will Trump mention nuclear policy on stage?"), yesBid: 0.6, yesAsk: 0.62, lastPrice: 0.61 };
  const signal = estimateLeadLagSignal({
    market: lagMarket,
    relatedMarkets: [leadMarket],
    historyByTicker: new Map([
      [
        "LAG",
        [
          { recordedAt: new Date(Date.now() - 120_000).toISOString(), yesBid: 0.48, yesAsk: 0.5, lastPrice: 0.49 },
          { recordedAt: new Date(Date.now()).toISOString(), yesBid: 0.485, yesAsk: 0.505, lastPrice: 0.495 },
        ],
      ],
      [
        "LEAD",
        [
          { recordedAt: new Date(Date.now() - 120_000).toISOString(), yesBid: 0.49, yesAsk: 0.51, lastPrice: 0.5 },
          { recordedAt: new Date(Date.now()).toISOString(), yesBid: 0.61, yesAsk: 0.63, lastPrice: 0.62 },
        ],
      ],
    ]),
    baseProbability: 0.49,
  });

  assert.ok(signal);
  assert.equal(signal?.leadTicker, "LEAD");
  assert.equal(signal?.lagTicker, "LAG");
  assert.ok((signal?.signalMagnitude ?? 0) > 0);
});
