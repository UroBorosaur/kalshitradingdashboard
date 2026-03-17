import assert from "node:assert/strict";
import test from "node:test";

import { summarizeExecutionAttribution } from "@/lib/prediction/execution-attribution";
import type {
  PredictionStorageEnvelope,
  StoredLearningOutputEvent,
  StoredCandidateDecisionEvent,
  StoredKalshiBalanceEvent,
  StoredKalshiFillEvent,
  StoredLiquidationDecisionEvent,
  StoredOrderMaintenanceEvent,
  StoredKalshiOrderEvent,
  StoredKalshiQuoteEvent,
  StoredMarkoutEvent,
  StoredReplacementDecisionEvent,
  StoredResolutionEvent,
  StoredSignalOverlayEvent,
  StoredWatchlistEvent,
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
        category: "BITCOIN",
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
        riskCluster: "BITCOIN:MISS",
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
    envelope<StoredCandidateDecisionEvent>(
      "candidate_decisions",
      "automation/planned-candidates",
      "decision:run-4:MISS2:NO",
      {
        runId: "run-4",
        mode: "AI",
        executeRequested: true,
        ticker: "MISS2",
        title: "Two Gate Miss",
        category: "POLITICS",
        side: "NO",
        verdict: "WATCHLIST",
        marketProb: 0.57,
        modelProb: 0.62,
        edge: 0.018,
        executionAdjustedEdge: 0.014,
        confidence: 0.44,
        recommendedStakeUsd: 2.1,
        recommendedContracts: 3,
        limitPriceCents: 57,
        probabilityTransform: "SIGMOID",
        calibrationMethod: "TEMPERATURE",
        compositeScore: 0.006,
        riskCluster: "POLITICS:MISS2",
        gateDiagnostics: [
          {
            gate: "EXECUTION_EDGE",
            passed: false,
            observed: -0.006,
            threshold: 0,
            missBy: 0.006,
            unit: "probability",
            detail: "Execution-adjusted edge fell slightly negative after penalties.",
          },
          {
            gate: "CONFIDENCE_FLOOR",
            passed: false,
            observed: 0.441,
            threshold: 0.448,
            missBy: 0.007,
            unit: "probability",
            detail: "Primary confidence floor",
          },
        ],
        executionStatus: "SKIPPED",
        executionMessage: "Skipped on multiple near-threshold gates.",
        rationale: [],
      },
      "2026-03-16T11:46:00.000Z",
    ),
    envelope<StoredCandidateDecisionEvent>(
      "candidate_decisions",
      "automation/planned-candidates",
      "decision:run-5:MISS3:YES",
      {
        runId: "run-5",
        mode: "AI",
        executeRequested: true,
        ticker: "MISS3",
        title: "Single Confidence Miss",
        category: "SPORTS",
        side: "YES",
        verdict: "WATCHLIST",
        marketProb: 0.52,
        modelProb: 0.56,
        edge: 0.019,
        executionAdjustedEdge: 0.016,
        confidence: 0.443,
        recommendedStakeUsd: 2.4,
        recommendedContracts: 4,
        limitPriceCents: 52,
        probabilityTransform: "SIGMOID",
        calibrationMethod: "TEMPERATURE",
        compositeScore: 0.0065,
        riskCluster: "SPORTS:MISS3",
        gateDiagnostics: [
          {
            gate: "CONFIDENCE_FLOOR",
            passed: false,
            observed: 0.443,
            threshold: 0.45,
            missBy: 0.007,
            unit: "probability",
            detail: "Primary confidence floor",
          },
        ],
        executionStatus: "SKIPPED",
        executionMessage: "Skipped on narrow confidence miss.",
        rationale: [],
      },
      "2026-03-16T11:47:00.000Z",
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

  const replacements = [
    envelope<StoredReplacementDecisionEvent>(
      "replacement_decisions",
      "automation/conflict-replacements",
      "replacement:MISS",
      {
        runId: "run-3",
        mode: "AI",
        candidateKey: "MISS:YES",
        ticker: "MISS",
        title: "Near Miss Market",
        category: "OTHER",
        side: "YES",
        incumbentSource: "ORDER",
        incumbentConflictType: "SAME_SIDE_ORDER",
        incumbentTicker: "MISS",
        incumbentSide: "YES",
        incumbentOrderId: "order-blocker",
        incumbentUtility: 0.02,
        challengerUtility: 0.06,
        replacementCost: 0.005,
        queueResetPenalty: 0.003,
        additionalClusterRiskPenalty: 0.002,
        replacementScoreDelta: 0.03,
        threshold: 0.02,
        accepted: true,
        action: "REPLACE_ORDER",
        reason: "Challenger dominates incumbent.",
        clusterKey: "BITCOIN:MISS",
      },
    ),
  ];

  const orderActions = [
    envelope<StoredOrderMaintenanceEvent>(
      "order_actions",
      "automation/order-maintenance",
      "order-action:order-1",
      {
        runId: "run-1",
        mode: "AI",
        orderId: "order-1",
        ticker: "TEST",
        side: "YES",
        action: "REPRICE",
        currentPriceCents: 61,
        suggestedPriceCents: 62,
        evKeep: 0.01,
        evReprice: 0.03,
        evCancel: 0.005,
        expectedImprovement: 0.02,
        threshold: 0.01,
        staleHazard: 0.2,
        toxicityScore: 0.15,
        reservationDrift: 0.01,
        queueResetPenalty: 0.002,
        challengerOpportunityUsd: 0.12,
        reason: "Refresh the quote.",
      },
    ),
  ];

  const watchlistEvents = [
    envelope<StoredWatchlistEvent>(
      "watchlist_events",
      "automation/watchlist",
      "watchlist:MISS",
      {
        runId: "run-3",
        mode: "AI",
        key: "MISS:YES",
        ticker: "MISS",
        title: "Near Miss Market",
        category: "OTHER",
        side: "YES",
        type: "PROMOTED",
        promotionScore: 0.08,
        avgWatchlistHours: 3,
        edge: 0.04,
        executionAdjustedEdge: 0.028,
        confidence: 0.58,
        reason: "Improved across cycles.",
      },
    ),
  ];

  const learningOutputs = [
    envelope<StoredLearningOutputEvent>(
      "learning_outputs",
      "automation/learning",
      "learning:latest",
      {
        generatedAt: "2026-03-16T13:00:00.000Z",
        lookbackHours: 72,
        active: false,
        recommendations: [
          {
            gate: "CONFIDENCE_FLOOR",
            label: "Confidence floor",
            unit: "probability",
            sampleCount: 4,
            hitRate: 0.6,
            profitableRate: 0.5,
            avgCounterfactualPnlUsd: 0.42,
            avgExpiryDrift: 0.03,
            proposedDelta: 0.005,
            boundedDelta: 0.005,
            reason: "False negatives are moderately expensive.",
            active: false,
          },
        ],
      },
    ),
  ];

  const liquidationDecisions = [
    envelope<StoredLiquidationDecisionEvent>(
      "liquidation_decisions",
      "automation/liquidation",
      "liquidation:TEST",
      {
        runId: "run-1",
        mode: "AI",
        ticker: "TEST",
        title: "Test Market",
        category: "SPORTS",
        side: "YES",
        contracts: 2,
        canCloseEarly: true,
        timeToResolutionDays: 0.05,
        valueHoldToResolutionUsd: 0.08,
        valueExitNowUsd: 0.21,
        liquidationCostUsd: 0.02,
        expectedMarkToResolution: 0.67,
        spread: 0.02,
        liquidityScore: 0.7,
        liquidationCVaR: 0.03,
        action: "FLATTEN",
        reason: "Exit-now dominates.",
      },
    ),
  ];

  const signalOverlays = [
    envelope<StoredSignalOverlayEvent>(
      "signal_overlays",
      "automation/signal-overlays",
      "overlay:MISS",
      {
        runId: "run-3",
        mode: "AI",
        ticker: "MISS",
        side: "YES",
        silentClock: {
          eligible: true,
          checkpointProgress: 0.62,
          decayPenalty: 0.03,
          adjustedProbability: 0.46,
          probabilityDelta: -0.02,
          scoreContribution: -0.0012,
          rationale: "No confirming event arrived by checkpoint.",
        },
        leadLag: {
          leadTicker: "LEAD",
          lagTicker: "MISS",
          horizonSeconds: 120,
          signalMagnitude: 0.02,
          confidence: 0.5,
          direction: "UP",
          adjustedProbability: 0.5,
          probabilityDelta: 0.01,
          scoreContribution: 0.0008,
          rationale: "Related market repriced first.",
        },
      },
    ),
  ];

  const summary = summarizeExecutionAttribution({
    lookbackHours: 72,
    decisions,
    orders,
    fills,
    balances,
    quotes,
    replacements,
    orderActions,
    watchlistEvents,
    learningOutputs,
    liquidationDecisions,
    signalOverlays,
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
  assert.equal(summary.selectionControl?.nearMisses.count, 4);
  const missRow = summary.selectionControl?.recentNearMisses.find((row) => row.ticker === "MISS");
  assert.equal(missRow?.latestQuoteDrift, 0.05);
  assert.equal(missRow?.resolved, true);
  assert.equal(missRow?.realizedHit, true);
  assert.equal(missRow?.counterfactualPnlUsd, 2.9);
  assert.equal(missRow?.failedGates[0]?.gate, "POSITION_ORDER_CONFLICT");
  assert.equal(missRow?.primaryFailedGate?.gate, "POSITION_ORDER_CONFLICT");
  const miss2Row = summary.selectionControl?.recentNearMisses.find((row) => row.ticker === "MISS2");
  assert.equal(miss2Row?.primaryFailedGate?.gate, "EXECUTION_EDGE");
  assert.equal(miss2Row?.secondaryFailedGates[0]?.gate, "CONFIDENCE_FLOOR");
  assert.equal(summary.selectionControl?.resolvedNearMisses.count, 1);
  assert.equal(summary.selectionControl?.resolvedNearMisses.hitRate, 1);
  assert.equal(summary.selectionControl?.resolvedNearMisses.profitableRate, 1);
  assert.equal(summary.selectionControl?.resolvedNearMisses.totalCounterfactualPnlUsd, 2.9);
  assert.equal(summary.selectionControl?.falseNegativesByExpert[0]?.key, "MICROSTRUCTURE");
  assert.equal(summary.selectionControl?.byGate.find((row) => row.gate === "POSITION_ORDER_CONFLICT")?.avgMissBy, 1);
  assert.equal(summary.selectionControl?.byGate.find((row) => row.gate === "CONFIDENCE_FLOOR")?.count, 2);
  assert.equal(summary.selectionControl?.gateWaterfall.find((row) => row.gate === "EXECUTION_EDGE")?.primaryCount, 1);
  assert.equal(summary.selectionControl?.gateWaterfall.find((row) => row.gate === "CONFIDENCE_FLOOR")?.secondaryCount, 1);
  assert.equal(summary.selectionControl?.counterfactualByGate.find((row) => row.gate === "CONFIDENCE_FLOOR")?.additionalPasses, 1);
  assert.equal(summary.selectionControl?.counterfactualByGate.find((row) => row.gate === "EXECUTION_EDGE")?.additionalPasses, 0);
  assert.equal(summary.replacement?.accepted, 1);
  assert.equal(summary.orderMaintenance?.reprice, 1);
  assert.equal(summary.watchlist?.promotions, 1);
  assert.equal(summary.learning?.recommendations[0]?.gate, "CONFIDENCE_FLOOR");
  assert.equal(summary.liquidation?.flatten, 1);
  assert.equal(summary.overlays?.silentClockCount, 1);
  assert.equal(summary.overlays?.leadLagCount, 1);
  assert.equal(summary.overlays?.silentClockPerformance.decisions, 0);
  assert.equal(summary.overlays?.leadLagPerformance.decisions, 0);
});
