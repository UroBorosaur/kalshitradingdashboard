import type {
  KalshiOrderLite,
  OrderMaintenanceDecision,
  PredictionCandidate,
  PredictionMarketQuote,
  PredictionSide,
} from "@/lib/prediction/types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeSide(side: KalshiOrderLite["side"]): PredictionSide {
  return side === "yes" ? "YES" : "NO";
}

function orderPriceCents(order: KalshiOrderLite, side: PredictionSide) {
  const direct = side === "YES" ? order.yes_price : order.no_price;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  const complement = side === "YES" ? order.no_price : order.yes_price;
  if (typeof complement === "number" && Number.isFinite(complement)) return 100 - complement;
  return null;
}

function orderAgeHours(order: KalshiOrderLite) {
  const ts = order.last_update_time ?? order.created_time;
  if (!ts) return 0;
  const value = (Date.now() - new Date(ts).getTime()) / 3_600_000;
  return clamp(Number.isFinite(value) ? value : 0, 0, 72);
}

function quoteMarkProbability(market: PredictionMarketQuote | undefined, side: PredictionSide) {
  if (!market) return 0.5;
  const yes = clamp(
    market.yesBid ?? market.lastPrice ?? (market.noAsk !== null ? 1 - market.noAsk : null) ?? market.yesAsk ?? 0.5,
    0.01,
    0.99,
  );
  return side === "YES" ? yes : 1 - yes;
}

export function evaluateOrderMaintenance(args: {
  order: KalshiOrderLite;
  market?: PredictionMarketQuote;
  challenger?: PredictionCandidate;
  minImprovement: number;
  clusterTriggered?: boolean;
}): OrderMaintenanceDecision {
  const side = normalizeSide(args.order.side);
  const currentPriceCents = orderPriceCents(args.order, side);
  const markProb = quoteMarkProbability(args.market, side);
  const ageHours = orderAgeHours(args.order);
  const staleHazard = clamp(1 - Math.exp(-(0.22 + ageHours * 0.08)), 0, 0.98);
  const currentProb = currentPriceCents !== null ? clamp(currentPriceCents / 100, 0.01, 0.99) : markProb;
  const reservationProb = args.challenger?.rulebookProb ?? args.challenger?.modelProb ?? markProb;
  const reservationDrift = Number((reservationProb - currentProb).toFixed(6));
  const toxicityScore = clamp(args.challenger?.toxicityScore ?? staleHazard * 0.65, 0, 1);
  const queueResetPenalty = Number((Math.max(0.001, (args.order.remaining_count ?? args.order.count ?? 1) * 0.00075 + ageHours * 0.0004)).toFixed(6));
  const challengerOpportunityUsd = Number(Math.max(0, args.challenger?.netAlphaUsd ?? 0).toFixed(6));

  const evKeep = Number((
    (args.challenger?.executionPlan?.fillProbability ?? 0.52) * ((reservationProb - currentProb) + 0.002) -
    staleHazard * 0.012 -
    toxicityScore * 0.008
  ).toFixed(6));
  const suggestedPriceCents = args.challenger?.limitPriceCents ?? (currentPriceCents !== null ? Math.round((currentProb + reservationDrift * 0.75) * 100) : null);
  const evReprice = Number((
    (args.challenger?.executionPlan?.fillProbability ?? 0.6) * Math.max(-0.02, reservationProb - (suggestedPriceCents ?? 50) / 100) -
    queueResetPenalty -
    toxicityScore * 0.005
  ).toFixed(6));
  const evCancel = Number((
    (args.clusterTriggered ? 0.006 : 0) +
    Math.max(0, challengerOpportunityUsd / Math.max(1, args.order.remaining_count ?? args.order.count ?? 1)) -
    0.001
  ).toFixed(6));

  const candidates: Array<{ action: OrderMaintenanceDecision["action"]; value: number; reason: string }> = [
    { action: "KEEP", value: evKeep, reason: "Current resting order still has the best expected value after stale-hazard penalties." },
    { action: "REPRICE", value: evReprice, reason: "Refreshing the resting quote improves expected value enough to justify queue reset." },
    { action: "CANCEL", value: evCancel, reason: "Order is better removed than left resting given stale hazard and competing opportunity value." },
  ];
  candidates.sort((left, right) => right.value - left.value);
  const best = candidates[0];
  const baseline = candidates.find((row) => row.action === "KEEP") ?? best;
  const expectedImprovement = Number((best.value - baseline.value).toFixed(6));
  const action = expectedImprovement >= args.minImprovement ? best.action : "KEEP";
  const chosen = action === best.action ? best : baseline;

  return {
    orderId: args.order.order_id,
    ticker: args.order.ticker,
    title: args.order.title,
    side,
    orderGroupId: args.order.order_group_id,
    action,
    currentPriceCents,
    suggestedPriceCents: action === "REPRICE" ? suggestedPriceCents : null,
    evKeep,
    evReprice,
    evCancel,
    expectedImprovement,
    threshold: args.minImprovement,
    staleHazard: Number(staleHazard.toFixed(6)),
    toxicityScore: Number(toxicityScore.toFixed(6)),
    reservationDrift,
    queueResetPenalty,
    challengerOpportunityUsd,
    reason: chosen.reason,
    riskCluster: args.challenger?.riskCluster,
  };
}
