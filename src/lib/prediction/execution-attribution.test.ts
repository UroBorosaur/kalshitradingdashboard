import assert from "node:assert/strict";
import test from "node:test";

import { summarizeExecutionAttribution } from "@/lib/prediction/execution-attribution";
import type {
  PredictionStorageEnvelope,
  StoredCandidateDecisionEvent,
  StoredKalshiBalanceEvent,
  StoredKalshiFillEvent,
  StoredKalshiOrderEvent,
  StoredKalshiQuoteEvent,
  StoredMarkoutEvent,
  StoredResolutionEvent,
} from "@/lib/storage/types";

function envelope<TPayload>(
  stream: PredictionStorageEnvelope<TPayload>["stream"],
  source: string,
  entityKey: string,
  payload: TPayload,
  recordedAt = "2026-03-16T12:00:00.000Z",
): PredictionStorageEnvelope<TPayload> {
  return {
    id: `${stream}-${entityKey}`,
    stream,
    layer: stream === "markouts" ? "derived" : "raw",
    schemaVersion: 1,
    recordedAt,
    source,
    entityKey,
    payload,
  };
}

test("summarizeExecutionAttribution groups executed candidates by expert, regime, cluster, uncertainty, toxicity, and bootstrap mode", () => {
  const decisions = [
    envelope<StoredCandidateDecisionEvent>(
      "candidate_decisions",
      "automation/executed-candidates",
      "decision:run-1:TEST:YES",
      {
        runId: "run-1",
        mode: "AI",
        executeRequested: true,
        ticker: "TEST",
        title: "Test Market",
        category: "SPORTS",
        side: "YES",
        marketProb: 0.58,
        rawModelProb: 0.61,
        modelProb: 0.64,
        coherentFairProb: 0.62,
        edge: 0.03,
        executionAdjustedEdge: 0.025,
        confidence: 0.66,
        recommendedStakeUsd: 1.22,
        recommendedContracts: 2,
        limitPriceCents: 61,
        probabilityTransform: "ENTMAX15",
        calibrationMethod: "TEMPERATURE",
        expertWeights: [
          { expert: "MICROSTRUCTURE", weight: 0.6, probability: 0.64 },
          { expert: "RULEBOOK", weight: 0.4, probability: 0.63 },
        ],
        compositeScore: 0.012,
        netAlphaUsd: 0.47,
        feeEstimateUsd: 0.02,
        uncertaintyWidth: 0.03,
        toxicityScore: 0.24,
        riskCluster: "SPORTS:TEST-EVENT",
        executionStatus: "PLACED",
        executionMessage: "Order placed",
        executionOrderId: "order-1",
        executionClientOrderId: "client-1",
        bootstrapMode: "ACKED",
        executionHealthRegime: "TIGHTENED",
        executionHealthPenalty: 0.012,
        executionPlan: {
          limitPriceCents: 61,
          patienceHours: 0.25,
          fillProbability: 0.72,
          expectedExecutionValueUsd: 0.15,
          feeUsd: 0.02,
          role: "MAKER",
          quoteWidening: 0.01,
          staleHazard: 0.12,
          inventorySkew: 0.33,
        },
        rationale: [],
      },
      "2026-03-16T12:00:00.000Z",
    ),
    envelope<StoredCandidateDecisionEvent>(
      "candidate_decisions",
      "automation/executed-candidates",
      "decision:run-2:TEST2:NO",
      {
        runId: "run-2",
        mode: "AI",
        executeRequested: true,
        ticker: "TEST2",
        title: "Second Market",
        category: "POLITICS",
        side: "NO",
        marketProb: 0.74,
        modelProb: 0.78,
        edge: 0.01,
        confidence: 0.52,
        recommendedStakeUsd: 7.4,
        recommendedContracts: 1,
        limitPriceCents: 74,
        probabilityTransform: "SIGMOID",
        calibrationMethod: "TEMPERATURE",
        uncertaintyWidth: 0.06,
        toxicityScore: 0.72,
        riskCluster: "POLITICS:TEST2",
        executionStatus: "SKIPPED",
        executionMessage: "Simulation mode selected.",
        bootstrapMode: "EVENT_PRIMED",
        executionHealthRegime: "DEFENSIVE",
        executionPlan: {
          limitPriceCents: 74,
          patienceHours: 0.08,
          fillProbability: 0.31,
          expectedExecutionValueUsd: -0.02,
          feeUsd: 0.03,
          role: "TAKER",
          quoteWidening: 0.04,
          staleHazard: 0.5,
          inventorySkew: -0.1,
        },
        rationale: [],
      },
      "2026-03-16T11:30:00.000Z",
    ),
    envelope<StoredCandidateDecisionEvent>(
      "candidate_decisions",
      "automation/planned-candidates",
      "decision:run-3:MISS:YES",
      {
        runId: "run-3",
        mode: "AI",
        executeRequested: true,
        ticker: "MISS",
        title: "Near Miss Market",
        category: "CRYPTO",
        side: "YES",
        verdict: "WATCHLIST",
        marketProb: 0.41,
        modelProb: 0.49,
        edge: 0.04,
        executionAdjustedEdge: 0.028,
        confidence: 0.58,
        recommendedStakeUsd: 3.1,
        recommendedContracts: 5,
        limitPriceCents: 42,
        probabilityTransform: "SIGMOID",
        calibrationMethod: "TEMPERATURE",
        expertWeights: [{ expert: "MICROSTRUCTURE", weight: 0.55, probability: 0.5 }],
        compositeScore: 0.009,
        riskCluster: "CRYPTO:MISS",
        gateDiagnostics: [
          {
            gate: "POSITION_ORDER_CONFLICT",
            passed: false,
            observed: 1,
            threshold: 0,
            missBy: 1,
            unit: "count",
            detail: "Market already has an active or recent order.",
          },
        ],
        executionStatus: "SKIPPED",
        executionMessage: "Skipped after portfolio sizing.",
        rationale: [],
      },
      "2026-03-16T11:45:00.000Z",
    ),
  ];

  const orders = [
    envelope<StoredKalshiOrderEvent>(
      "orders",
      "kalshi/private-state",
      "order:order-1",
      {
        orderId: "order-1",
        clientOrderId: "client-1",
        ticker: "TEST",
        side: "yes",
        action: "buy",
        status: "executed",
        count: 2,
        yesPriceCents: 61,
      },
    ),
  ];

  const fills = [
    envelope<StoredKalshiFillEvent>(
      "fills",
      "kalshi/private-state",
      "fill:fill-1",
      {
        fillId: "fill-1",
        orderId: "order-1",
        ticker: "TEST",
        side: "yes",
        action: "buy",
        count: 2,
        yesPriceCents: 61,
      },
    ),
  ];

  const balances = [
    envelope<StoredKalshiBalanceEvent>(
      "balances",
      "automation/pre-run-balance",
      "balance:before",
      {
        balanceUsd: 100,
        cashUsd: 100,
        portfolioUsd: 0,
      },
      "2026-03-16T11:59:00.000Z",
    ),
    envelope<StoredKalshiBalanceEvent>(
      "balances",
      "automation/post-run-balance",
      "balance:after",
      {
        balanceUsd: 98.76,
        cashUsd: 98.76,
        portfolioUsd: 1.22,
      },
      "2026-03-16T12:01:00.000Z",
    ),
  ];

  const markouts = [
    envelope<StoredMarkoutEvent>(
      "markouts",
      "markout-telemetry",
      "markout:fill-1:30s",
      {
        fillId: "fill-1",
        ticker: "TEST",
        side: "yes",
        fillPrice: 0.61,
        fillTs: Date.parse("2026-03-16T12:00:00.000Z"),
        horizon: "30s",
        targetTs: Date.parse("2026-03-16T12:00:30.000Z"),
        observedTs: Date.parse("2026-03-16T12:00:31.000Z"),
        mark: 0.64,
        markout: 0.03,
      },
    ),
    envelope<StoredMarkoutEvent>(
      "markouts",
      "markout-telemetry",
      "markout:fill-1:2m",
      {
        fillId: "fill-1",
        ticker: "TEST",
        side: "yes",
        fillPrice: 0.61,
        fillTs: Date.parse("2026-03-16T12:00:00.000Z"),
        horizon: "2m",
        targetTs: Date.parse("2026-03-16T12:02:00.000Z"),
        observedTs: Date.parse("2026-03-16T12:02:02.000Z"),
        mark: 0.66,
        markout: 0.05,
      },
    ),
    envelope<StoredMarkoutEvent>(
      "markouts",
      "markout-telemetry",
      "markout:fill-1:expiry",
      {
        fillId: "fill-1",
        ticker: "TEST",
        side: "yes",
        fillPrice: 0.61,
        fillTs: Date.parse("2026-03-16T12:00:00.000Z"),
        horizon: "expiry",
        targetTs: Date.parse("2026-03-16T15:00:00.000Z"),
        observedTs: Date.parse("2026-03-16T15:00:01.000Z"),
        mark: 1,
        markout: 0.39,
      },
    ),
  ];

  const quotes = [
    envelope<StoredKalshiQuoteEvent>(
      "quotes",
      "kalshi/summary",
      "quote:MISS",
      {
        ticker: "MISS",
        title: "Near Miss Market",
        marketStatus: "open",
        yesBid: 0.46,
        yesAsk: 0.47,
        noBid: 0.53,
        noAsk: 0.54,
        lastPrice: 0.46,
      },
      "2026-03-16T12:10:00.000Z",
    ),
  ];

  const resolutions = [
    envelope<StoredResolutionEvent>(
      "resolutions",
      "kalshi/summary",
      "resolution:MISS",
      {
        ticker: "MISS",
        title: "Near Miss Market",
        status: "settled",
        settlementResult: "yes",
        settlementPrice: 1,
        resolvedAt: "2026-03-16T18:00:00.000Z",
      },
      "2026-03-16T18:00:00.000Z",
    ),
  ];

  const summary = summarizeExecutionAttribution({
    lookbackHours: 72,
    decisions,
    orders,
    fills,
    balances,
    quotes,
    resolutions,
    markouts,
    recentTradeLimit: 10,
    bucketLimit: 10,
  });

  assert.equal(summary.totals.decisions, 2);
  assert.equal(summary.totals.placed, 1);
  assert.equal(summary.totals.skipped, 1);
  assert.equal(summary.totals.totalFilledContracts, 2);
  assert.equal(summary.totals.avgMarkout30s, 0.03);
  assert.equal(summary.totals.avgMarkout2m, 0.05);
  assert.equal(summary.totals.avgMarkoutExpiry, 0.39);
  assert.equal(summary.totals.matchedReconciliations, 1);
  assert.equal(summary.totals.avgCashDeltaDriftUsd, 0);
  assert.equal(summary.totals.avgFeeDriftUsd, 0);

  const byExpert = summary.byExpert.find((row) => row.key === "MICROSTRUCTURE");
  assert.ok(byExpert);
  assert.equal(byExpert?.placed, 1);
  assert.equal(byExpert?.avgMarkout30s, 0.03);

  const byBootstrap = summary.byBootstrap.find((row) => row.key === "ACKED");
  assert.ok(byBootstrap);
  assert.equal(byBootstrap?.placed, 1);

  const firstTrade = summary.recentTrades[0];
  assert.equal(firstTrade.ticker, "TEST");
  assert.equal(firstTrade.executionHealthRegime, "TIGHTENED");
  assert.equal(firstTrade.bootstrapMode, "ACKED");
  assert.equal(firstTrade.markoutExpiry, 0.39);
  assert.equal(firstTrade.averageFillPriceCents, 61);
  assert.equal(firstTrade.actualCashDeltaUsd, 1.24);
  assert.equal(firstTrade.cashDeltaDriftUsd, 0);
  assert.equal(firstTrade.inferredActualFeeUsd, 0.02);

  assert.equal(summary.selectionControl?.executed.count, 1);
  assert.equal(summary.selectionControl?.nearMisses.count, 2);
  assert.equal(summary.selectionControl?.recentNearMisses[0]?.ticker, "MISS");
  assert.equal(summary.selectionControl?.recentNearMisses[0]?.latestQuoteDrift, 0.05);
  assert.equal(summary.selectionControl?.recentNearMisses[0]?.resolved, true);
  assert.equal(summary.selectionControl?.recentNearMisses[0]?.realizedHit, true);
  assert.equal(summary.selectionControl?.recentNearMisses[0]?.counterfactualPnlUsd, 2.9);
  assert.equal(summary.selectionControl?.recentNearMisses[0]?.failedGates[0]?.gate, "POSITION_ORDER_CONFLICT");
  assert.equal(summary.selectionControl?.resolvedNearMisses.count, 1);
  assert.equal(summary.selectionControl?.resolvedNearMisses.hitRate, 1);
  assert.equal(summary.selectionControl?.resolvedNearMisses.profitableRate, 1);
  assert.equal(summary.selectionControl?.resolvedNearMisses.totalCounterfactualPnlUsd, 2.9);
  assert.equal(summary.selectionControl?.falseNegativesByExpert[0]?.key, "MICROSTRUCTURE");
  assert.equal(summary.selectionControl?.byGate[0]?.gate, "POSITION_ORDER_CONFLICT");
  assert.equal(summary.selectionControl?.byGate[0]?.avgMissBy, 1);
});
