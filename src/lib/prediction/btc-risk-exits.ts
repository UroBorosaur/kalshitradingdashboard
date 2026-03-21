import type { KalshiPositionLite, PredictionMarketQuote, PredictionSide } from "@/lib/prediction/types";

export interface BitcoinRiskExitDecision {
  ticker: string;
  title: string;
  heldSide: PredictionSide;
  exitSide: PredictionSide;
  contracts: number;
  entryProbability: number;
  currentProbability: number;
  unrealizedReturnPct: number;
  trigger: "STOP_LOSS" | "TAKE_PROFIT";
  exitLimitPriceCents: number;
  reason: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizePositionSide(positionFp: string): PredictionSide | null {
  const qty = Number(positionFp);
  if (!Number.isFinite(qty) || Math.abs(qty) < 1e-9) return null;
  return qty > 0 ? "YES" : "NO";
}

function heldSideMarkProbability(market: PredictionMarketQuote, side: PredictionSide) {
  const yes = clamp(
    market.yesBid ?? market.lastPrice ?? (market.noAsk !== null ? 1 - market.noAsk : null) ?? market.yesAsk ?? 0.5,
    0.01,
    0.99,
  );
  return side === "YES" ? yes : Number((1 - yes).toFixed(6));
}

function entryProbability(position: KalshiPositionLite) {
  const qty = Math.max(0.01, Math.abs(Number(position.position_fp)));
  const totalTraded = Number(position.total_traded_dollars ?? position.market_exposure_dollars ?? 0);
  if (Number.isFinite(totalTraded) && totalTraded > 0) return clamp(totalTraded / qty, 0.01, 0.99);
  return 0.5;
}

function exitProbability(market: PredictionMarketQuote, heldSide: PredictionSide) {
  if (heldSide === "YES") {
    const noAsk = market.noAsk ?? (market.yesBid !== null ? 1 - market.yesBid : null) ?? (market.lastPrice !== null ? 1 - market.lastPrice : null);
    return clamp(noAsk ?? 0.5, 0.01, 0.99);
  }
  const yesAsk = market.yesAsk ?? (market.noBid !== null ? 1 - market.noBid : null) ?? market.lastPrice ?? 0.5;
  return clamp(yesAsk, 0.01, 0.99);
}

export function evaluateBitcoinRiskExit(args: {
  position: KalshiPositionLite;
  market: PredictionMarketQuote;
  stopLossPct?: number;
  takeProfitPct?: number;
}): BitcoinRiskExitDecision | null {
  if (args.market.category !== "BITCOIN" || !args.market.canCloseEarly) return null;
  const heldSide = normalizePositionSide(args.position.position_fp);
  if (!heldSide) return null;
  const contracts = Math.abs(Number(args.position.position_fp));
  if (!Number.isFinite(contracts) || contracts <= 0) return null;

  const stopLossPct = Math.abs(args.stopLossPct ?? 0.1);
  const takeProfitPct = Math.abs(args.takeProfitPct ?? 0.25);
  const entryProb = entryProbability(args.position);
  const currentProb = heldSideMarkProbability(args.market, heldSide);
  const unrealizedReturnPct = Number((((currentProb - entryProb) / Math.max(0.01, entryProb))).toFixed(6));
  const trigger =
    unrealizedReturnPct <= -stopLossPct ? "STOP_LOSS" : unrealizedReturnPct >= takeProfitPct ? "TAKE_PROFIT" : null;
  if (!trigger) return null;

  const exitSide: PredictionSide = heldSide === "YES" ? "NO" : "YES";
  const exitLimitPriceCents = Math.round(exitProbability(args.market, heldSide) * 100);
  return {
    ticker: args.position.ticker,
    title: args.market.title,
    heldSide,
    exitSide,
    contracts,
    entryProbability: Number(entryProb.toFixed(6)),
    currentProbability: Number(currentProb.toFixed(6)),
    unrealizedReturnPct,
    trigger,
    exitLimitPriceCents,
    reason:
      trigger === "STOP_LOSS"
        ? `BTC stop loss triggered at ${(unrealizedReturnPct * 100).toFixed(2)}% versus ${(stopLossPct * 100).toFixed(0)}% threshold.`
        : `BTC take profit triggered at ${(unrealizedReturnPct * 100).toFixed(2)}% versus ${(takeProfitPct * 100).toFixed(0)}% threshold.`,
  };
}
