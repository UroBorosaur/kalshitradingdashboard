import type { LeadLagSignal, PredictionCategory, PredictionMarketQuote, SilentClockContribution } from "@/lib/prediction/types";

export interface StreamSignalPoint {
  recordedAt: string;
  yesBid: number | null;
  yesAsk: number | null;
  lastPrice: number | null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function yesMark(point: StreamSignalPoint | PredictionMarketQuote) {
  return clamp(
    point.yesBid ?? point.lastPrice ?? ("noAsk" in point && point.noAsk !== null ? 1 - point.noAsk : null) ?? point.yesAsk ?? 0.5,
    0.01,
    0.99,
  );
}

function isSilentClockEligible(category: PredictionCategory, market: PredictionMarketQuote) {
  const text = `${market.title} ${market.subtitle ?? ""} ${market.rulesPrimary ?? ""} ${market.rulesSecondary ?? ""}`.toLowerCase();
  if (!(category === "POLITICS" || category === "MACRO" || category === "OTHER" || category === "SPORTS")) return false;
  return /(mention|announce|statement|declare|release|speech|hearing|vote|file|decision|ruling|approval|launch|start)/.test(text);
}

export function estimateSilentClockContribution(args: {
  market: PredictionMarketQuote;
  baseProbability: number;
}): SilentClockContribution | null {
  if (!isSilentClockEligible(args.market.category, args.market)) return null;
  const now = Date.now();
  const closeTs = args.market.closeTime ? new Date(args.market.closeTime).getTime() : Number.NaN;
  if (!Number.isFinite(closeTs) || closeTs <= now) return null;
  const expectedTs = args.market.expectedExpirationTime ? new Date(args.market.expectedExpirationTime).getTime() : closeTs;
  const latestTs = args.market.latestExpirationTime ? new Date(args.market.latestExpirationTime).getTime() : closeTs;
  const checkpointStart = Math.min(expectedTs, closeTs);
  const checkpointEnd = Math.max(checkpointStart, latestTs, closeTs);
  const progress = clamp((now - checkpointStart) / Math.max(1, checkpointEnd - checkpointStart), 0, 1.2);
  const text = `${args.market.rulesPrimary ?? ""} ${args.market.rulesSecondary ?? ""}`.toLowerCase();
  const lagGrace = /(official|source|agency|certif|benchmarks|average)/.test(text) ? 0.3 : 0.15;
  if (progress <= lagGrace) {
    return {
      eligible: true,
      checkpointProgress: Number(progress.toFixed(6)),
      decayPenalty: 0,
      adjustedProbability: args.baseProbability,
      rationale: "Silent-clock expert eligible but still inside source-reporting grace window.",
    };
  }
  const decayPenalty = clamp((progress - lagGrace) * 0.09, 0, 0.09);
  return {
    eligible: true,
    checkpointProgress: Number(progress.toFixed(6)),
    decayPenalty: Number(decayPenalty.toFixed(6)),
    adjustedProbability: Number(clamp(args.baseProbability - decayPenalty, 0.02, 0.98).toFixed(6)),
    rationale: "No confirming event has arrived by the expected checkpoint, so fair probability decays under a rulebook-aware silent-clock model.",
  };
}

function linkStrength(left: PredictionMarketQuote, right: PredictionMarketQuote) {
  if (left.ticker === right.ticker) return 0;
  if (left.eventTicker && right.eventTicker && left.eventTicker === right.eventTicker) return 1;
  const leftTitle = `${left.title} ${left.subtitle ?? ""}`.toLowerCase();
  const rightTitle = `${right.title} ${right.subtitle ?? ""}`.toLowerCase();
  const leftTokens = new Set(leftTitle.split(/[^a-z0-9]+/).filter((token) => token.length >= 4));
  const rightTokens = new Set(rightTitle.split(/[^a-z0-9]+/).filter((token) => token.length >= 4));
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return clamp(overlap / Math.max(2, Math.min(leftTokens.size, rightTokens.size)), 0, 0.95);
}

export function estimateLeadLagSignal(args: {
  market: PredictionMarketQuote;
  relatedMarkets: PredictionMarketQuote[];
  historyByTicker: Map<string, StreamSignalPoint[]>;
  baseProbability: number;
}): LeadLagSignal | null {
  const lagHistory = args.historyByTicker.get(args.market.ticker) ?? [];
  if (lagHistory.length < 2) return null;
  const lagMove = yesMark(lagHistory[lagHistory.length - 1]) - yesMark(lagHistory[0]);
  let best: LeadLagSignal | null = null;

  for (const related of args.relatedMarkets) {
    const strength = linkStrength(args.market, related);
    if (strength < 0.35) continue;
    const history = args.historyByTicker.get(related.ticker) ?? [];
    if (history.length < 2) continue;
    const leadMove = yesMark(history[history.length - 1]) - yesMark(history[0]);
    const signalMagnitude = leadMove - lagMove;
    if (Math.abs(signalMagnitude) < 0.015) continue;
    const confidence = clamp(strength * (1 - Math.abs(lagMove) * 3), 0.2, 0.85);
    const adjustedProbability = clamp(args.baseProbability + signalMagnitude * confidence * 0.5, 0.02, 0.98);
    const next: LeadLagSignal = {
      leadTicker: related.ticker,
      lagTicker: args.market.ticker,
      horizonSeconds: 120,
      signalMagnitude: Number(signalMagnitude.toFixed(6)),
      confidence: Number(confidence.toFixed(6)),
      direction: signalMagnitude >= 0 ? "UP" : "DOWN",
      adjustedProbability: Number(adjustedProbability.toFixed(6)),
      rationale: `Related Kalshi market ${related.ticker} repriced first while ${args.market.ticker} lagged over the recent short horizon.`,
    };
    if (!best || Math.abs(next.signalMagnitude) > Math.abs(best.signalMagnitude)) best = next;
  }

  return best;
}
