import assert from "node:assert/strict";
import test from "node:test";

import {
  kalshiFillExecutionPriceCents,
  reconcileKalshiExecution,
  summarizeKalshiFills,
} from "@/lib/prediction/reconciliation";

test("kalshiFillExecutionPriceCents resolves complementary NO pricing", () => {
  assert.equal(
    kalshiFillExecutionPriceCents({
      fill_id: "f1",
      order_id: "o1",
      ticker: "TEST",
      side: "no",
      action: "buy",
      count: 1,
      yes_price: 61.25,
    }),
    38.75,
  );
});

test("summarizeKalshiFills computes weighted average using fractional counts", () => {
  const summary = summarizeKalshiFills([
    {
      fill_id: "f1",
      order_id: "o1",
      ticker: "TEST",
      side: "yes",
      action: "buy",
      count: 0.25,
      yes_price: 60,
    },
    {
      fill_id: "f2",
      order_id: "o1",
      ticker: "TEST",
      side: "yes",
      action: "buy",
      count: 0.75,
      yes_price: 62,
    },
  ]);

  assert.equal(summary.filledCount, 1);
  assert.equal(summary.averageFillPriceCents, 61.5);
});

test("reconcileKalshiExecution reports price, size, fee, and cash drift", () => {
  const reconciliation = reconcileKalshiExecution({
    intent: {
      side: "YES",
      requestedCount: 1.4,
      snappedCount: 1.25,
      requestedLimitPriceCents: 61.2,
      snappedLimitPriceCents: 61,
      estimatedFeeUsd: 0.01,
      expectedExecutionCostUsd: 0.7725,
    },
    fills: [
      {
        fill_id: "f1",
        order_id: "o1",
        ticker: "TEST",
        side: "yes",
        action: "buy",
        count: 0.5,
        yes_price: 61,
      },
      {
        fill_id: "f2",
        order_id: "o1",
        ticker: "TEST",
        side: "yes",
        action: "buy",
        count: 0.75,
        yes_price: 61.2,
      },
    ],
    actualFeeUsd: 0.02,
    actualCashDeltaUsd: 0.784,
  });

  assert.equal(reconciliation.filledCount, 1.25);
  assert.equal(reconciliation.averageFillPriceCents, 61.12);
  assert.equal(reconciliation.priceSlippageCents, 0.12);
  assert.equal(reconciliation.countDrift, 0);
  assert.equal(reconciliation.feeDriftUsd, 0.01);
  assert.equal(reconciliation.cashDeltaDriftUsd, 0.0115);
});
