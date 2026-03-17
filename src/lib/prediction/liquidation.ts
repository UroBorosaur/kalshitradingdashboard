import type { KalshiPositionLite, LiquidationDecision, PredictionMarketQuote, PredictionSide } from "@/lib/prediction/types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizePositionSide(positionFp: string): PredictionSide | null {
  const qty = Number(positionFp);
  if (!Number.isFinite(qty) || Math.abs(qty) < 1e-9) return null;
  return qty > 0 ? "YES" : "NO";
}

function markProbability(market: PredictionMarketQuote, side: PredictionSide) {
  const yes = clamp(
    market.yesBid ?? market.lastPrice ?? (market.noAsk !== null ? 1 - market.noAsk : null) ?? market.yesAsk ?? 0.5,
    0.01,
    0.99,
  );
  return side === "YES" ? yes : Number((1 - yes).toFixed(6));
}

function positionEntryProbability(position: KalshiPositionLite, side: PredictionSide) {
  const qty = Math.max(0.01, Math.abs(Number(position.position_fp)));
  const totalTraded = Number(position.total_traded_dollars ?? position.market_exposure_dollars ?? 0);
  if (Number.isFinite(totalTraded) && totalTraded > 0) return clamp(totalTraded / qty, 0.01, 0.99);
  return side === "YES" ? 0.55 : 0.45;
}

function daysUntil(closeTime: string | null) {
  if (!closeTime) return 7;
  const target = new Date(closeTime).getTime();
  if (!Number.isFinite(target)) return 7;
  return Math.max(0, (target - Date.now()) / 86_400_000);
}

export function evaluateLiquidationDecision(args: {
  position: KalshiPositionLite;
  market: PredictionMarketQuote;
  riskCluster?: string;
}): LiquidationDecision | null {
  const side = normalizePositionSide(args.position.position_fp);
  if (!side) return null;
  const contracts = Math.abs(Number(args.position.position_fp));
  const timeToResolutionDays = Number(daysUntil(args.market.closeTime).toFixed(6));
  const currentProb = markProbability(args.market, side);
  const entryProb = positionEntryProbability(args.position, side);
  const spread = Math.max(0.01, (side === "YES"
    ? (args.market.yesAsk ?? currentProb) - (args.market.yesBid ?? currentProb)
    : (args.market.noAsk ?? currentProb) - (args.market.noBid ?? currentProb)));
  const liquidityScore = clamp(Math.log1p(args.market.volume + args.market.openInterest) / 8, 0.08, 1);
  const expectedMarkToResolution = Number((currentProb + Math.sign(currentProb - 0.5) * Math.min(0.03, timeToResolutionDays * 0.01)).toFixed(6));
  const liquidationCVaR = Number((Math.max(0.005, spread * 0.15 + (1 - liquidityScore) * 0.04)).toFixed(6));
  const liquidationCostUsd = Number((contracts * Math.max(0.01, currentProb) * (spread * 0.5 + liquidationCVaR)).toFixed(4));
  const valueHoldToResolutionUsd = Number((contracts * (expectedMarkToResolution - entryProb)).toFixed(4));
  const valueExitNowUsd = Number((contracts * (currentProb - entryProb) - liquidationCostUsd).toFixed(4));
  const edge = valueExitNowUsd - valueHoldToResolutionUsd;
  const action: LiquidationDecision["action"] =
    timeToResolutionDays <= 0.08 && edge > 0.35
      ? "FLATTEN"
      : timeToResolutionDays <= 0.25 && edge > 0.12
        ? "TRIM"
        : "HOLD";

  return {
    ticker: args.position.ticker,
    title: args.market.title,
    category: args.market.category,
    side,
    contracts,
    riskCluster: args.riskCluster,
    canCloseEarly: args.market.canCloseEarly,
    timeToResolutionDays,
    valueHoldToResolutionUsd,
    valueExitNowUsd,
    liquidationCostUsd,
    expectedMarkToResolution,
    spread: Number(spread.toFixed(6)),
    liquidityScore: Number(liquidityScore.toFixed(6)),
    liquidationCVaR,
    action,
    reason:
      action === "FLATTEN"
        ? "Near close and exit-now value dominates hold-to-resolution after liquidation cost."
        : action === "TRIM"
          ? "Trim risk near resolution because exit value modestly dominates holding full size."
          : "Continue holding; estimated hold value still beats immediate exit after costs.",
  };
}
