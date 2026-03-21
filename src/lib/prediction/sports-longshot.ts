import type { PredictionMarketQuote, PredictionSide, SportsUnderdogLongshotSetup } from "@/lib/prediction/types";

interface EvaluateSportsUnderdogLongshotArgs {
  enabled: boolean;
  market: PredictionMarketQuote;
  relatedMarkets: PredictionMarketQuote[];
  selectedSide: PredictionSide;
  timeToCloseDays: number;
  modelProb: number;
  marketProb: number;
  edge: number;
  confidence: number;
  spread: number;
  liquidityScore: number;
  marketProbabilityCeiling: number;
  minGap: number;
  minEdge: number;
  minConfidence: number;
  maxSpread: number;
  minLiquidityScore: number;
  focusWindowDays: number;
  maxWindowDays: number;
  modelProbabilityFloor: number;
  confirmationGapMin: number;
  sizeScale: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function firstDefined(...values: Array<number | null | undefined>) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function isSportsWinnerMarket(market: PredictionMarketQuote) {
  const text = `${market.title} ${market.subtitle ?? ""} ${market.eventTicker ?? ""} ${market.ticker}`.toLowerCase();
  const titlePattern = /\bwinner\?/.test(text) && (/\bvs\b/.test(text) || /\bat\b/.test(text));
  const tickerPattern = /kx(?:nba|wnba|ncaa|atp|wta|nfl|mlb|nhl|soccer|epl|baller)/.test(text);
  return titlePattern || tickerPattern;
}

function equivalentProbability(counterpart: PredictionMarketQuote, selectedSide: PredictionSide) {
  return selectedSide === "YES"
    ? firstDefined(
        counterpart.noAsk,
        counterpart.yesBid !== null ? 1 - counterpart.yesBid : null,
        counterpart.lastPrice !== null ? 1 - counterpart.lastPrice : null,
      )
    : firstDefined(
        counterpart.yesAsk,
        counterpart.noBid !== null ? 1 - counterpart.noBid : null,
        counterpart.lastPrice,
      );
}

function pickCounterpart(
  market: PredictionMarketQuote,
  relatedMarkets: PredictionMarketQuote[],
  selectedSide: PredictionSide,
  marketProb: number,
) {
  const candidates = relatedMarkets
    .filter((candidate) => candidate.eventTicker && candidate.eventTicker === market.eventTicker)
    .filter((candidate) => candidate.ticker !== market.ticker)
    .filter(isSportsWinnerMarket)
    .map((candidate) => {
      const eqProb = equivalentProbability(candidate, selectedSide);
      return {
        market: candidate,
        equivalentProbability: eqProb,
        priceAdvantage: eqProb !== null ? eqProb - marketProb : null,
      };
    })
    .filter((candidate) => candidate.equivalentProbability !== null);

  if (!candidates.length) return null;
  return candidates.sort((left, right) => (right.equivalentProbability ?? 0) - (left.equivalentProbability ?? 0))[0] ?? null;
}

export function evaluateSportsUnderdogLongshot(args: EvaluateSportsUnderdogLongshotArgs): SportsUnderdogLongshotSetup | null {
  if (!args.enabled || !isSportsWinnerMarket(args.market)) return null;
  if (!Number.isFinite(args.timeToCloseDays) || args.timeToCloseDays > args.maxWindowDays) return null;

  const probabilityGap = Number((args.modelProb - args.marketProb).toFixed(6));
  const focusWindow = args.timeToCloseDays <= args.focusWindowDays;
  const counterpart = pickCounterpart(args.market, args.relatedMarkets, args.selectedSide, args.marketProb);
  const counterpartEquivalentProbability = counterpart?.equivalentProbability ?? null;
  const equivalentPriceAdvantage =
    counterpartEquivalentProbability !== null
      ? Number((counterpartEquivalentProbability - args.marketProb).toFixed(6))
      : null;

  const minEdge = Number((args.minEdge * (focusWindow ? 1 : 0.9)).toFixed(6));
  const minConfidence = Number((args.minConfidence * (focusWindow ? 1 : 0.97)).toFixed(6));
  const maxSpread = Number((args.maxSpread * (focusWindow ? 1 : 0.9)).toFixed(6));
  const minLiquidityScore = Number((args.minLiquidityScore * (focusWindow ? 1 : 1.05)).toFixed(6));
  const modelProbabilityFloor = Number(clamp(args.modelProbabilityFloor, 0.18, 0.45).toFixed(6));
  const asymmetryConfirmed =
    equivalentPriceAdvantage !== null
      ? equivalentPriceAdvantage >= args.confirmationGapMin
      : probabilityGap >= args.minGap * 1.35;
  const strongEquivalentMismatch = (equivalentPriceAdvantage ?? 0) >= Math.max(0.12, args.confirmationGapMin * 3);
  const effectiveMinGap = strongEquivalentMismatch ? Math.max(0.01, args.minGap * 0.35) : args.minGap;
  const effectiveMinEdge = strongEquivalentMismatch ? Math.max(0.003, args.minEdge * 0.35) : minEdge;

  const eligible =
    args.modelProb >= modelProbabilityFloor &&
    args.marketProb <= args.marketProbabilityCeiling &&
    probabilityGap >= effectiveMinGap &&
    args.edge >= effectiveMinEdge &&
    args.confidence >= minConfidence &&
    args.spread <= maxSpread &&
    args.liquidityScore >= minLiquidityScore &&
    asymmetryConfirmed;

  const rationale = [
    `sports underdog ${focusWindow ? "focus" : "extended"} window`,
    `model ${(args.modelProb * 100).toFixed(1)}%`,
    `implied ${(args.marketProb * 100).toFixed(1)}%`,
    `gap ${(probabilityGap * 100).toFixed(2)} pts`,
    counterpart?.market.ticker
      ? `counterpart ${counterpart.market.ticker} eq ${(counterpartEquivalentProbability! * 100).toFixed(1)}%`
      : "no counterpart confirmation",
    strongEquivalentMismatch ? "strong structural mismatch" : "normal confirmation",
  ].join(" | ");

  return {
    eligible,
    focusWindow,
    probabilityGap,
    modelProbabilityFloor,
    marketProbabilityCeiling: args.marketProbabilityCeiling,
    minGap: effectiveMinGap,
    minEdge: effectiveMinEdge,
    minConfidence,
    maxSpread,
    minLiquidityScore,
    counterpartTicker: counterpart?.market.ticker,
    counterpartTitle: counterpart?.market.title,
    counterpartEquivalentProbability,
    equivalentPriceAdvantage,
    confirmationGapMin: args.confirmationGapMin,
    sizeScale: args.sizeScale,
    rationale,
  };
}
