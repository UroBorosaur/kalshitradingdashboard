import type { BitcoinMicroLongshotSetup } from "@/lib/prediction/types";

interface EvaluateBitcoinMicroLongshotArgs {
  enabled: boolean;
  isBitcoin: boolean;
  timeToCloseDays: number;
  focusHorizonDays: number;
  microHorizonDays: number;
  modelProb: number;
  marketProb: number;
  edge: number;
  confidence: number;
  spread: number;
  liquidityScore: number;
  highProbModelFloor: number;
  marketProbabilityCeiling: number;
  minGap: number;
  minEdge: number;
  minConfidence: number;
  maxSpread: number;
  minLiquidityScore: number;
  sizeScale: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function evaluateBitcoinMicroLongshot(args: EvaluateBitcoinMicroLongshotArgs): BitcoinMicroLongshotSetup | null {
  const isMicro = args.isBitcoin && Number.isFinite(args.timeToCloseDays) && args.timeToCloseDays <= args.microHorizonDays;
  if (!args.enabled || !isMicro) return null;

  const focusWindow = args.timeToCloseDays <= args.focusHorizonDays;
  const probabilityGap = Number((args.modelProb - args.marketProb).toFixed(6));
  const focusTightener = focusWindow ? 1 : 0.85;
  const modelProbabilityFloor = clamp(Math.min(args.highProbModelFloor * 0.3, 0.28), 0.18, 0.28);
  const minEdge = Number((args.minEdge * focusTightener).toFixed(6));
  const minConfidence = Number((args.minConfidence * (focusWindow ? 1 : 0.96)).toFixed(6));
  const maxSpread = Number((args.maxSpread * (focusWindow ? 1 : 0.92)).toFixed(6));
  const minLiquidityScore = Number((args.minLiquidityScore * (focusWindow ? 1 : 1.06)).toFixed(6));

  const eligible =
    args.modelProb >= modelProbabilityFloor &&
    args.marketProb <= args.marketProbabilityCeiling &&
    probabilityGap >= args.minGap &&
    args.edge >= minEdge &&
    args.confidence >= minConfidence &&
    args.spread <= maxSpread &&
    args.liquidityScore >= minLiquidityScore;

  const rationale = [
    `BTC micro longshot ${focusWindow ? "focus" : "outer-micro"} window`,
    `model ${(args.modelProb * 100).toFixed(1)}%`,
    `implied ${(args.marketProb * 100).toFixed(1)}%`,
    `gap ${(probabilityGap * 100).toFixed(2)} pts`,
    `spread ${(args.spread * 100).toFixed(1)}%`,
    `liq ${(args.liquidityScore * 100).toFixed(0)}%`,
  ].join(" | ");

  return {
    eligible,
    focusWindow,
    probabilityGap,
    modelProbabilityFloor,
    marketProbabilityCeiling: args.marketProbabilityCeiling,
    minGap: args.minGap,
    minEdge,
    minConfidence,
    maxSpread,
    minLiquidityScore,
    maxToxicity: 0,
    executionAdjustedEdgeFloor: 0,
    sizeScale: args.sizeScale,
    rationale,
  };
}
