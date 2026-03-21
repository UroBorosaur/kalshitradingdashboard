import type { CandidateGateKey, ExecutionAttributionSummary, FalseNegativeLearningOutput, GateLearningRecommendation } from "@/lib/prediction/types";

const MIN_SAMPLE_BY_GATE: Partial<Record<CandidateGateKey, number>> = {
  CONFIDENCE_FLOOR: 3,
  EXECUTION_EDGE: 3,
  TOXICITY: 4,
  UNCERTAINTY_WIDTH: 4,
  BOOTSTRAP_HEALTH: 5,
};

const GATE_CAPS: Partial<Record<CandidateGateKey, number>> = {
  CONFIDENCE_FLOOR: 0.01,
  EXECUTION_EDGE: 0.006,
  TOXICITY: 0.015,
  UNCERTAINTY_WIDTH: 0.01,
  BOOTSTRAP_HEALTH: 0,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function gateLabel(gate: CandidateGateKey) {
  switch (gate) {
    case "CONFIDENCE_FLOOR":
      return "Confidence floor";
    case "EXECUTION_EDGE":
      return "Execution-adjusted edge";
    case "TOXICITY":
      return "Toxicity";
    case "UNCERTAINTY_WIDTH":
      return "Uncertainty width";
    case "CLUSTER_CAP":
      return "Cluster cap";
    case "ORDER_GROUP_BRAKE":
      return "Order-group brake";
    case "POSITION_ORDER_CONFLICT":
      return "Existing position/order conflict";
    case "BOOTSTRAP_HEALTH":
      return "Bootstrap / stream health";
  }
}

export function buildFalseNegativeLearning(args: {
  selectionControl: ExecutionAttributionSummary["selectionControl"];
  lookbackHours: number;
  active: boolean;
}): FalseNegativeLearningOutput {
  const recommendations: GateLearningRecommendation[] = [];
  const control = args.selectionControl;
  const resolvedCount = control?.resolvedNearMisses.count ?? 0;
  let gatesEvaluated = 0;
  let gatesMeetingMinSample = 0;
  let gatesBlockedBySupport = 0;

  for (const gate of control?.byGate ?? []) {
    const key = gate.gate;
    if (key === "POSITION_ORDER_CONFLICT" || key === "ORDER_GROUP_BRAKE" || key === "CLUSTER_CAP") continue;
    gatesEvaluated += 1;
    const sampleCount = gate.count;
    const required = MIN_SAMPLE_BY_GATE[key] ?? 5;
    if (sampleCount < required || resolvedCount <= 0) {
      gatesBlockedBySupport += 1;
      continue;
    }
    gatesMeetingMinSample += 1;

    const hitRate = control?.resolvedNearMisses.hitRate ?? null;
    const profitableRate = control?.resolvedNearMisses.profitableRate ?? null;
    const avgCounterfactualPnlUsd = control?.resolvedNearMisses.avgCounterfactualPnlUsd ?? null;
    const avgExpiryDrift = control?.resolvedNearMisses.avgExpiryDrift ?? null;
    const miss = gate.avgMissBy ?? 0;
    const severity = clamp((hitRate ?? 0) * 0.55 + (profitableRate ?? 0) * 0.45 + Math.max(0, avgExpiryDrift ?? 0) * 0.5, 0, 1);
    const rawDelta = miss * severity * 0.45;
    const cap = GATE_CAPS[key] ?? 0;
    const boundedDelta = Number(clamp(rawDelta, 0, cap).toFixed(6));
    recommendations.push({
      gate: key,
      label: gateLabel(key),
      unit: gate.unit,
      sampleCount,
      hitRate,
      profitableRate,
      avgCounterfactualPnlUsd,
      avgExpiryDrift,
      proposedDelta: Number(rawDelta.toFixed(6)),
      boundedDelta,
      reason: boundedDelta > 0
        ? `Resolved near misses suggest this gate is producing expensive false negatives with ${sampleCount} samples.`
        : `False-negative evidence is not yet strong enough to justify loosening this gate.`,
      active: args.active && boundedDelta > 0,
    });
  }

  recommendations.sort((left, right) => {
    if (right.active !== left.active) return Number(right.active) - Number(left.active);
    return (right.avgCounterfactualPnlUsd ?? 0) - (left.avgCounterfactualPnlUsd ?? 0);
  });

  return {
    generatedAt: new Date().toISOString(),
    lookbackHours: args.lookbackHours,
    active: args.active,
    resolvedNearMissCount: resolvedCount,
    gatesEvaluated,
    gatesMeetingMinSample,
    gatesBlockedBySupport,
    recommendations,
  };
}
