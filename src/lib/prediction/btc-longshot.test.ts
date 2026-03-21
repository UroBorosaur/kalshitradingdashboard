import assert from "node:assert/strict";
import test from "node:test";

import { evaluateBitcoinMicroLongshot } from "@/lib/prediction/btc-longshot";

test("btc micro longshot qualifies only inside micro window with real model-implied gap", () => {
  const result = evaluateBitcoinMicroLongshot({
    enabled: true,
    isBitcoin: true,
    timeToCloseDays: 15 / (24 * 60),
    focusHorizonDays: 15 / (24 * 60),
    microHorizonDays: 60 / (24 * 60),
    modelProb: 0.29,
    marketProb: 0.22,
    edge: 0.012,
    confidence: 0.39,
    spread: 0.05,
    liquidityScore: 0.31,
    highProbModelFloor: 0.9,
    marketProbabilityCeiling: 0.38,
    minGap: 0.035,
    minEdge: 0.005,
    minConfidence: 0.36,
    maxSpread: 0.09,
    minLiquidityScore: 0.18,
    sizeScale: 0.38,
  });

  assert.ok(result);
  assert.equal(result?.eligible, true);
  assert.equal(result?.focusWindow, true);
  assert.ok((result?.probabilityGap ?? 0) >= 0.06);
});

test("btc micro longshot rejects weak gaps and non-micro horizons", () => {
  const weakGap = evaluateBitcoinMicroLongshot({
    enabled: true,
    isBitcoin: true,
    timeToCloseDays: 15 / (24 * 60),
    focusHorizonDays: 15 / (24 * 60),
    microHorizonDays: 60 / (24 * 60),
    modelProb: 0.24,
    marketProb: 0.22,
    edge: 0.004,
    confidence: 0.36,
    spread: 0.05,
    liquidityScore: 0.28,
    highProbModelFloor: 0.9,
    marketProbabilityCeiling: 0.38,
    minGap: 0.035,
    minEdge: 0.005,
    minConfidence: 0.36,
    maxSpread: 0.09,
    minLiquidityScore: 0.18,
    sizeScale: 0.38,
  });
  const nonMicro = evaluateBitcoinMicroLongshot({
    enabled: true,
    isBitcoin: true,
    timeToCloseDays: 4 / 24,
    focusHorizonDays: 15 / (24 * 60),
    microHorizonDays: 60 / (24 * 60),
    modelProb: 0.29,
    marketProb: 0.22,
    edge: 0.012,
    confidence: 0.39,
    spread: 0.05,
    liquidityScore: 0.31,
    highProbModelFloor: 0.9,
    marketProbabilityCeiling: 0.38,
    minGap: 0.035,
    minEdge: 0.005,
    minConfidence: 0.36,
    maxSpread: 0.09,
    minLiquidityScore: 0.18,
    sizeScale: 0.38,
  });

  assert.ok(weakGap);
  assert.equal(weakGap?.eligible, false);
  assert.equal(nonMicro, null);
});
