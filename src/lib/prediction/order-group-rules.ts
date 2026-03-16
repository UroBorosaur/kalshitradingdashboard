import type { PredictionCandidate } from "@/lib/prediction/types";

export interface ClusterGuardSpec {
  clusterKey: string;
  contractsLimit: number;
  shouldTrigger: boolean;
}

export function deriveClusterGuardSpecs(args: {
  actionable: PredictionCandidate[];
  clusterStakeLimitUsd: number;
  executionHealthPenalty: number;
}) {
  const clusterMap = new Map<string, PredictionCandidate[]>();
  for (const candidate of args.actionable) {
    const key = candidate.riskCluster ?? candidate.category;
    const bucket = clusterMap.get(key) ?? [];
    bucket.push(candidate);
    clusterMap.set(key, bucket);
  }

  const specs: ClusterGuardSpec[] = [];
  for (const [clusterKey, bucket] of clusterMap.entries()) {
    const maxPrice = Math.max(...bucket.map((candidate) => Math.max(0.01, candidate.limitPriceCents / 100)));
    const maxToxicity = Math.max(...bucket.map((candidate) => candidate.toxicityScore ?? 0));
    const baseContractsLimit = Math.max(1, Math.floor(args.clusterStakeLimitUsd / maxPrice));
    const tightenFactor = 1 - Math.min(0.8, maxToxicity * 0.45 + args.executionHealthPenalty * 5);
    const contractsLimit = Math.max(1, Math.floor(baseContractsLimit * tightenFactor));
    const shouldTrigger = maxToxicity >= 0.95 || args.executionHealthPenalty >= 0.08;

    specs.push({
      clusterKey,
      contractsLimit,
      shouldTrigger,
    });
  }

  return specs;
}
