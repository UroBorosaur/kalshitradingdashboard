import type {
  KalshiOrderLite,
  KalshiPositionLite,
  PredictionCandidate,
  PredictionMarketQuote,
  PredictionSide,
  ReplacementDecision,
} from "@/lib/prediction/types";

interface IncumbentExposure {
  source: "ORDER" | "POSITION";
  conflictType: "SAME_SIDE_ORDER" | "MARKET_ORDER" | "SAME_SIDE_POSITION" | "MARKET_POSITION";
  ticker: string;
  side: PredictionSide;
  orderId?: string;
  title?: string;
  count: number;
  remainingCount: number;
  entryProb: number;
  currentProb: number;
  stakeUsd: number;
  riskCluster?: string;
  queuePriorityAgeHours: number;
  restingOrdersCount?: number;
}

export interface OpenExposureConstraint {
  tickers: Set<string>;
  sameSideKeys: Set<string>;
  orderTickers: Set<string>;
  orderSideKeys: Set<string>;
  incumbentsByCandidateKey: Map<string, IncumbentExposure[]>;
}

export interface ReplacementControlConfig {
  enabled: boolean;
  minDelta: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizePositionSide(positionFp: string): PredictionSide | null {
  const qty = Number(positionFp);
  if (!Number.isFinite(qty) || Math.abs(qty) < 1e-9) return null;
  return qty > 0 ? "YES" : "NO";
}

function normalizeOrderSide(side: KalshiOrderLite["side"]): PredictionSide {
  return side === "yes" ? "YES" : "NO";
}

function shouldBlockRepeatOrder(order: KalshiOrderLite) {
  const status = order.status.trim().toLowerCase();
  if (["canceled", "cancelled", "expired", "failed", "rejected"].includes(status)) return false;
  if ((order.remaining_count ?? 0) > 0) return true;
  return ["resting", "open", "pending", "partially_filled", "executed", "filled"].includes(status);
}

function quoteSideProbability(market: PredictionMarketQuote | undefined, side: PredictionSide) {
  if (!market) return 0.5;
  const yesProb = clamp(
    market.yesAsk ?? market.lastPrice ?? (market.noBid !== null ? 1 - market.noBid : null) ?? market.yesBid ?? 0.5,
    0.01,
    0.99,
  );
  return side === "YES" ? yesProb : Number((1 - yesProb).toFixed(6));
}

function orderEntryProbability(order: KalshiOrderLite, side: PredictionSide) {
  const direct = side === "YES" ? order.yes_price : order.no_price;
  if (typeof direct === "number" && Number.isFinite(direct)) return clamp(direct / 100, 0.01, 0.99);
  const complement = side === "YES" ? order.no_price : order.yes_price;
  if (typeof complement === "number" && Number.isFinite(complement)) return clamp(1 - complement / 100, 0.01, 0.99);
  return 0.5;
}

function positionEntryProbability(position: KalshiPositionLite, side: PredictionSide) {
  const qty = Math.max(0.01, Math.abs(Number(position.position_fp)));
  const totalTraded = Number(position.total_traded_dollars ?? position.market_exposure_dollars ?? 0);
  if (Number.isFinite(totalTraded) && totalTraded > 0) {
    return clamp(totalTraded / qty, 0.01, 0.99);
  }
  return side === "YES" ? 0.55 : 0.45;
}

function inferredStakeUsd(entryProb: number, count: number) {
  return Number((Math.max(0.01, entryProb) * Math.max(0.01, count)).toFixed(4));
}

function orderAgeHours(order: KalshiOrderLite) {
  const ts = order.last_update_time ?? order.created_time;
  if (!ts) return 0;
  const age = (Date.now() - new Date(ts).getTime()) / 3_600_000;
  return Number(clamp(Number.isFinite(age) ? age : 0, 0, 72).toFixed(4));
}

function candidateUtility(candidate: PredictionCandidate, additionalClusterRiskPenalty = 0) {
  const edge = candidate.executionAdjustedEdge ?? candidate.edge;
  const capitalTime = Math.max(0.05, candidate.capitalTimeDays ?? candidate.timeToCloseDays ?? 1);
  const stake = Math.max(0.01, candidate.recommendedStakeUsd || (candidate.limitPriceCents / 100) * Math.max(1, candidate.recommendedContracts));
  const alphaPerRisk = (candidate.netAlphaUsd ?? edge * Math.max(1, candidate.recommendedContracts)) / stake;
  const utility =
    edge * 2.4 +
    alphaPerRisk * 0.7 +
    Math.max(-0.25, Math.min(0.4, candidate.compositeScore ?? 0)) * 12 -
    Math.max(0, candidate.liquidationCVaR ?? 0) * 1.75 -
    Math.max(0, candidate.toxicityScore ?? 0) * 0.85 -
    Math.max(0, candidate.uncertaintyWidth ?? 0) * 1.05 -
    (capitalTime - 1) * 0.08 -
    additionalClusterRiskPenalty;
  return Number(utility.toFixed(6));
}

function incumbentUtility(incumbent: IncumbentExposure, challenger: PredictionCandidate, additionalClusterRiskPenalty = 0) {
  const markEdge = incumbent.currentProb - incumbent.entryProb;
  const notional = Math.max(0.01, incumbent.stakeUsd);
  const alphaPerRisk = (markEdge * Math.max(0.01, incumbent.count)) / notional;
  const queueValue = incumbent.source === "ORDER" ? Math.max(0, 0.025 - incumbent.queuePriorityAgeHours * 0.0015) : 0;
  const utility =
    markEdge * 2.1 +
    alphaPerRisk * 0.65 +
    queueValue -
    Math.max(0, challenger.liquidationCVaR ?? 0) * (incumbent.source === "POSITION" ? 1.4 : 0.8) -
    Math.max(0, challenger.toxicityScore ?? 0) * 0.4 -
    additionalClusterRiskPenalty;
  return Number(utility.toFixed(6));
}

function replacementCost(challenger: PredictionCandidate, incumbent: IncumbentExposure) {
  const cancelReplace = incumbent.source === "ORDER" ? Math.max(0.01, challenger.feeEstimateUsd ?? 0) * 0.35 : 0;
  const unwind = incumbent.source === "POSITION" ? Math.max(0.01, incumbent.stakeUsd) * Math.max(0.01, challenger.liquidationCVaR ?? 0.04) : 0;
  return Number((cancelReplace + unwind).toFixed(6));
}

function queueResetPenalty(incumbent: IncumbentExposure) {
  if (incumbent.source !== "ORDER") return 0;
  const penalty = Math.max(0.001, incumbent.remainingCount * 0.0008 + Math.max(0, 0.02 - incumbent.queuePriorityAgeHours * 0.0005));
  return Number(penalty.toFixed(6));
}

function clusterRiskPenalty(challenger: PredictionCandidate, incumbent: IncumbentExposure) {
  if (!challenger.riskCluster || !incumbent.riskCluster || challenger.riskCluster !== incumbent.riskCluster) return 0;
  const sameSide = challenger.side === incumbent.side;
  return Number((sameSide ? 0.015 : 0.006).toFixed(6));
}

export function buildOpenExposureConstraint(
  positions: KalshiPositionLite[],
  orders: KalshiOrderLite[],
  marketsByTicker: Map<string, PredictionMarketQuote>,
  riskClusterByTicker?: Map<string, string>,
): OpenExposureConstraint {
  const tickers = new Set<string>();
  const sameSideKeys = new Set<string>();
  const orderTickers = new Set<string>();
  const orderSideKeys = new Set<string>();
  const incumbentsByCandidateKey = new Map<string, IncumbentExposure[]>();

  function pushIncumbent(key: string, incumbent: IncumbentExposure) {
    const bucket = incumbentsByCandidateKey.get(key) ?? [];
    bucket.push(incumbent);
    incumbentsByCandidateKey.set(key, bucket);
  }

  for (const position of positions) {
    const ticker = position.ticker.toUpperCase();
    const side = normalizePositionSide(position.position_fp);
    if (!ticker || side === null) continue;
    const count = Math.abs(Number(position.position_fp)) || 0;
    const market = marketsByTicker.get(ticker);
    const currentProb = quoteSideProbability(market, side);
    const entryProb = positionEntryProbability(position, side);
    const incumbent: IncumbentExposure = {
      source: "POSITION",
      conflictType: "SAME_SIDE_POSITION",
      ticker,
      side,
      count,
      remainingCount: count,
      entryProb,
      currentProb,
      stakeUsd: inferredStakeUsd(entryProb, count),
      riskCluster: riskClusterByTicker?.get(ticker),
      queuePriorityAgeHours: 0,
      restingOrdersCount: position.resting_orders_count,
    };
    tickers.add(ticker);
    sameSideKeys.add(`${ticker}:${side}`);
    pushIncumbent(`${ticker}:${side}`, incumbent);
    pushIncumbent(`${ticker}:${side === "YES" ? "NO" : "YES"}`, {
      ...incumbent,
      conflictType: "MARKET_POSITION",
    });
  }

  for (const order of orders) {
    if (!shouldBlockRepeatOrder(order)) continue;
    const ticker = order.ticker.toUpperCase();
    const side = normalizeOrderSide(order.side);
    const count = Math.max(0.01, order.remaining_count ?? order.count);
    const market = marketsByTicker.get(ticker);
    const currentProb = quoteSideProbability(market, side);
    const entryProb = orderEntryProbability(order, side);
    const incumbent: IncumbentExposure = {
      source: "ORDER",
      conflictType: "SAME_SIDE_ORDER",
      ticker,
      side,
      orderId: order.order_id,
      title: order.title,
      count,
      remainingCount: count,
      entryProb,
      currentProb,
      stakeUsd: inferredStakeUsd(entryProb, count),
      riskCluster: riskClusterByTicker?.get(ticker),
      queuePriorityAgeHours: orderAgeHours(order),
    };
    orderTickers.add(ticker);
    orderSideKeys.add(`${ticker}:${side}`);
    pushIncumbent(`${ticker}:${side}`, incumbent);
    pushIncumbent(`${ticker}:${side === "YES" ? "NO" : "YES"}`, {
      ...incumbent,
      conflictType: "MARKET_ORDER",
    });
  }

  return { tickers, sameSideKeys, orderTickers, orderSideKeys, incumbentsByCandidateKey };
}

export function evaluateReplacementDecision(args: {
  challenger: PredictionCandidate;
  incumbents: IncumbentExposure[];
  controls: ReplacementControlConfig;
}): ReplacementDecision {
  const incumbent = [...args.incumbents].sort((left, right) => {
    const rightUtility = incumbentUtility(right, args.challenger, clusterRiskPenalty(args.challenger, right));
    const leftUtility = incumbentUtility(left, args.challenger, clusterRiskPenalty(args.challenger, left));
    return rightUtility - leftUtility;
  })[0];

  const additionalClusterRiskPenalty = clusterRiskPenalty(args.challenger, incumbent);
  const challengerUtility = candidateUtility(args.challenger, additionalClusterRiskPenalty);
  const incumbentScore = incumbentUtility(incumbent, args.challenger, additionalClusterRiskPenalty);
  const replaceCost = replacementCost(args.challenger, incumbent);
  const queuePenalty = queueResetPenalty(incumbent);
  const delta = Number((challengerUtility - incumbentScore - replaceCost - queuePenalty - additionalClusterRiskPenalty).toFixed(6));
  const accepted =
    args.controls.enabled &&
    delta >= args.controls.minDelta &&
    (args.challenger.executionAdjustedEdge ?? args.challenger.edge) > 0 &&
    (args.challenger.toxicityScore ?? 0) < 0.9 &&
    !(args.challenger.rulebookProbLower !== undefined &&
      args.challenger.rulebookProbUpper !== undefined &&
      args.challenger.rulebookProbLower <= args.challenger.marketProb &&
      args.challenger.rulebookProbUpper >= args.challenger.marketProb &&
      (args.challenger.uncertaintyWidth ?? 0) >= 0.08);

  const action: ReplacementDecision["action"] = !accepted
    ? "KEEP_INCUMBENT"
    : incumbent.source === "ORDER"
      ? "REPLACE_ORDER"
      : "RECOMMEND_POSITION_SWAP";

  return {
    candidateKey: `${args.challenger.ticker}:${args.challenger.side}`,
    ticker: args.challenger.ticker,
    title: args.challenger.title,
    category: args.challenger.category,
    side: args.challenger.side,
    incumbentSource: incumbent.source,
    incumbentConflictType: incumbent.conflictType,
    incumbentTicker: incumbent.ticker,
    incumbentSide: incumbent.side,
    incumbentOrderId: incumbent.orderId,
    incumbentUtility: incumbentScore,
    challengerUtility,
    replacementCost: replaceCost,
    queueResetPenalty: queuePenalty,
    additionalClusterRiskPenalty,
    replacementScoreDelta: delta,
    threshold: args.controls.minDelta,
    accepted,
    action,
    reason: accepted
      ? incumbent.source === "ORDER"
        ? `Challenger beats incumbent order by ${delta.toFixed(4)} utility after queue reset and replacement cost.`
        : `Challenger materially dominates incumbent position by ${delta.toFixed(4)} utility; recommend swap, but keep live position protection.`
      : `Incumbent remains better after replacement friction (${delta.toFixed(4)} utility delta).`,
    clusterKey: args.challenger.riskCluster,
  };
}
