import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateKalshiFeeRounded,
  snapContractCount,
  snapProbabilityToMarket,
} from "@/lib/prediction/fixed-point";

test("snapProbabilityToMarket respects range transitions and subpenny ticks", () => {
  const market = {
    tickSize: 1,
    priceRanges: [
      { minProbability: 0, maxProbability: 0.1, tickSizeCents: 0.1 },
      { minProbability: 0.1, maxProbability: 1, tickSizeCents: 1 },
    ],
  };

  assert.equal(snapProbabilityToMarket(0.09994, market, "up"), 0.1);
  assert.equal(snapProbabilityToMarket(0.10006, market, "down"), 0.1);
  assert.equal(snapProbabilityToMarket(0.10054, market, "up"), 0.11);
});

test("snapProbabilityToMarket clamps near zero and one safely", () => {
  const market = { tickSize: 1 };

  assert.equal(snapProbabilityToMarket(0.000001, market, "down"), 0.01);
  assert.equal(snapProbabilityToMarket(0.999999, market, "up"), 0.99);
});

test("snapContractCount respects fractional minimums and whole-contract modes", () => {
  assert.equal(snapContractCount(0.004, 0.01, "down"), 0);
  assert.equal(snapContractCount(0.014, 0.01, "down"), 0.01);
  assert.equal(snapContractCount(1.234, 1, "down"), 1);
  assert.equal(snapContractCount(1.234, 1, "up"), 2);
});

test("complement snapping remains coherent across range boundaries", () => {
  const market = {
    tickSize: 0.5,
    priceRanges: [
      { minProbability: 0, maxProbability: 0.25, tickSizeCents: 0.1 },
      { minProbability: 0.25, maxProbability: 0.75, tickSizeCents: 0.5 },
      { minProbability: 0.75, maxProbability: 1, tickSizeCents: 0.1 },
    ],
  };

  const yes = snapProbabilityToMarket(0.2549, market, "down");
  const no = snapProbabilityToMarket(1 - yes, market, "down");

  assert.ok(Math.abs((yes + no) - 1) <= 0.005);
});

test("estimateKalshiFeeRounded stays monotone and cent-aligned", () => {
  const fee = estimateKalshiFeeRounded({
    contracts: 0.37,
    price: 0.8125,
    rate: 0.07,
    schedule: "GENERAL",
  });

  assert.ok(fee.theoreticalUsd > 0);
  assert.ok(fee.chargedUsd >= fee.theoreticalUsd);
  assert.equal(fee.chargedCentiCents % 100, 0);
});
