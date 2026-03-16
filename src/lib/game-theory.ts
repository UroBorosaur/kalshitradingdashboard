import {
  type BayesianBelief,
  type CoreMetrics,
  type GameTheoryState,
  type MarketRegime,
  type RiskEvent,
  type SetupKey,
  type SetupRecommendation,
  type StrategyMixWeight,
  type Trade,
} from "@/lib/types";

const setupPriors: Record<SetupKey, number> = {
  BREAKOUT: 0.08,
  PULLBACK: 0.06,
  MEAN_REVERSION: 0.04,
  MOMENTUM_CONTINUATION: 0.07,
  NEWS_FADE: 0.03,
};

function inferRegime(trades: Trade[]): { regime: MarketRegime; confidence: number; rationale: string } {
  const recent = trades
    .filter((t) => t.status === "CLOSED" && t.exitDate)
    .sort((a, b) => (a.exitDate ?? "").localeCompare(b.exitDate ?? ""))
    .slice(-30);

  if (!recent.length) {
    return {
      regime: "MEAN_REVERSION",
      confidence: 0.4,
      rationale: "Insufficient recent closed trades, defaulting to neutral reversion regime.",
    };
  }

  const regimeScores = new Map<MarketRegime, number>();
  for (const trade of recent) {
    const curr = regimeScores.get(trade.marketRegime) ?? 0;
    regimeScores.set(trade.marketRegime, curr + Math.abs(trade.rr) + trade.confidenceScore);
  }

  const ranked = [...regimeScores.entries()].sort((a, b) => b[1] - a[1]);
  const [regime, topScore] = ranked[0];
  const total = ranked.reduce((sum, item) => sum + item[1], 0);
  const confidence = Math.min(0.96, Math.max(0.35, topScore / Math.max(1, total)));

  let rationale = "Order-flow remains mixed with no dominant adversary.";
  if (regime === "HIGH_VOL_ADVERSARIAL") rationale = "Volatility clusters and stop-runs indicate adversarial microstructure.";
  if (regime === "TREND_FOLLOWER") rationale = "Persistent directional continuation favors trend-following opponents.";
  if (regime === "NEWS_SHOCK") rationale = "Event-driven jumps indicate information asymmetry and fast repricing.";
  if (regime === "LOW_LIQUIDITY_TRAP") rationale = "Frequent failed breaks with slippage indicates thin-book liquidity traps.";
  if (regime === "MEAN_REVERSION") rationale = "Directional attempts fade quickly, consistent with inventory mean-reversion flows.";

  return { regime, confidence, rationale };
}

function buildStrategyMix(
  regime: MarketRegime,
  confidence: number,
  core: CoreMetrics,
): { mix: StrategyMixWeight[]; noTradeWeight: number } {
  const base = {
    BREAKOUT: 0.2,
    PULLBACK: 0.2,
    MEAN_REVERSION: 0.2,
    MOMENTUM_CONTINUATION: 0.2,
    NEWS_FADE: 0.2,
  };

  if (regime === "TREND_FOLLOWER") {
    base.BREAKOUT += 0.15;
    base.MOMENTUM_CONTINUATION += 0.12;
    base.MEAN_REVERSION -= 0.16;
  }

  if (regime === "MEAN_REVERSION") {
    base.MEAN_REVERSION += 0.2;
    base.BREAKOUT -= 0.1;
  }

  if (regime === "HIGH_VOL_ADVERSARIAL") {
    base.NEWS_FADE += 0.08;
    base.PULLBACK += 0.05;
    base.BREAKOUT -= 0.08;
    base.MOMENTUM_CONTINUATION -= 0.08;
  }

  if (regime === "NEWS_SHOCK") {
    base.NEWS_FADE += 0.15;
    base.PULLBACK -= 0.05;
  }

  if (regime === "LOW_LIQUIDITY_TRAP") {
    base.PULLBACK += 0.06;
    base.MEAN_REVERSION += 0.08;
    base.BREAKOUT -= 0.12;
  }

  // Mixed-strategy control: never let one setup dominate allocation.
  // We explicitly downweight trend-heavy setups when uncertainty rises.
  const persistencePenalty = Math.max(0, (core.uncertaintyScore - 50) / 200);
  base.BREAKOUT -= persistencePenalty;
  base.MOMENTUM_CONTINUATION -= persistencePenalty * 0.7;
  base.MEAN_REVERSION += persistencePenalty * 0.6;

  const clipped = Object.entries(base).map(([setup, weight]) => [setup, Math.max(0.02, weight)] as const);
  const sum = clipped.reduce((acc, [, value]) => acc + value, 0);

  // Optionality is a first-class action. Increase NO_TRADE weight under poor signal quality.
  const noTradeWeight = Math.max(0.05, (core.uncertaintyScore / 100) * 0.3 + (1 - confidence) * 0.25);
  const tradableWeight = Math.max(0.1, 1 - noTradeWeight);

  const normalized = clipped.map(([setup, weight]) => ({
    setup: setup as SetupKey,
    weight: (weight / sum) * tradableWeight,
  }));

  return {
    mix: [...normalized, { setup: "NO_TRADE", weight: noTradeWeight }],
    noTradeWeight,
  };
}

function buildBeliefs(trades: Trade[]): BayesianBelief[] {
  const keys: SetupKey[] = ["BREAKOUT", "PULLBACK", "MEAN_REVERSION", "MOMENTUM_CONTINUATION", "NEWS_FADE"];

  return keys.map((setup) => {
    const subset = trades.filter((t) => t.status === "CLOSED" && t.setup === setup);
    const n = subset.length;
    const prior = setupPriors[setup];

    const observed = n ? subset.reduce((sum, t) => sum + t.rr, 0) / n / 2 : 0;
    const k = n;
    const posterior = (prior * 20 + observed * k) / (20 + k);

    const variance = n
      ? subset.reduce((sum, t) => sum + (t.rr / 2 - observed) ** 2, 0) / Math.max(1, n - 1)
      : 0.08;
    const stdErr = Math.sqrt(variance / Math.max(1, n));

    return {
      setup,
      priorEdge: Number(prior.toFixed(4)),
      posteriorEdge: Number(posterior.toFixed(4)),
      sampleSize: n,
      confidenceLow: Number((posterior - 1.96 * stdErr).toFixed(4)),
      confidenceHigh: Number((posterior + 1.96 * stdErr).toFixed(4)),
    };
  });
}

function classifyRiskPosture(core: CoreMetrics, regimeConfidence: number): GameTheoryState["robustRiskPosture"] {
  // Minimax-inspired stress score: favor survival under adversarial/uncertain conditions.
  const stress = core.maxDrawdown * 100 + core.uncertaintyScore * 0.45 + (1 - regimeConfidence) * 35;

  if (stress > 62) return "CAPITAL_PRESERVATION";
  if (stress > 49) return "DEFENSIVE";
  if (stress > 34) return "BALANCED";
  return "AGGRESSIVE";
}

function infoDisadvantage(
  riskEvents: RiskEvent[],
  latestDate: string,
  regime: MarketRegime,
): GameTheoryState["infoDisadvantageRisk"] {
  const latest = new Date(`${latestDate}T00:00:00.000Z`);
  const windowStart = new Date(latest);
  windowStart.setUTCDate(windowStart.getUTCDate() - 3);

  const pressure = riskEvents
    .filter((event) => {
      const d = new Date(`${event.date}T00:00:00.000Z`);
      return d >= windowStart && d <= latest;
    })
    .reduce((sum, event) => sum + event.severity, 0);

  const regimePenalty = regime === "NEWS_SHOCK" ? 0.8 : regime === "HIGH_VOL_ADVERSARIAL" ? 0.55 : 0.2;
  const score = pressure + regimePenalty;

  if (score >= 2.2) return "HIGH";
  if (score >= 1.2) return "MEDIUM";
  return "LOW";
}

function setupRecommendations(
  beliefs: BayesianBelief[],
  trades: Trade[],
  regime: MarketRegime,
): SetupRecommendation[] {
  const recs: SetupRecommendation[] = [];

  for (const belief of beliefs) {
    const subset = trades.filter((t) => t.status === "CLOSED" && t.setup === belief.setup).slice(-20);
    const avgSlippage = subset.length ? subset.reduce((s, t) => s + t.slippage, 0) / subset.length : 0;
    const edgeDecay = subset.length
      ? subset.slice(-8).reduce((s, t) => s + t.rr, 0) / 8 - subset.slice(0, 8).reduce((s, t) => s + t.rr, 0) / 8
      : 0;

    let action: SetupRecommendation["action"] = "PLAY_BALANCED";
    let rationale = "Edge appears stable; continue baseline allocation.";

    if (belief.posteriorEdge > 0.1 && edgeDecay >= -0.1 && avgSlippage < 0.8) {
      action = "EXPLOIT_AGGRESSIVELY";
      rationale = "Posterior edge is strong and decay is limited with manageable slippage.";
    } else if (belief.posteriorEdge < 0.015 || avgSlippage > 1.15) {
      action = "STOP_DEPLOYING";
      rationale = "Edge collapsed or execution friction dominates expected edge.";
    } else if (edgeDecay < -0.25 || (regime === "HIGH_VOL_ADVERSARIAL" && belief.setup === "BREAKOUT")) {
      action = "REDUCE_EXPOSURE";
      rationale = "Recent decay or poor regime fit suggests reducing deployment until revalidated.";
    }

    recs.push({ setup: belief.setup, action, rationale });
  }

  return recs;
}

function metaAnalytics(trades: Trade[]): GameTheoryState["metaAnalytics"] {
  const closed = trades.filter((t) => t.status === "CLOSED");

  const setupsAfterLoss = new Map<SetupKey, { pnl: number; count: number }>();
  const bySetup = new Map<SetupKey, Trade[]>();

  for (const trade of closed) {
    const arr = bySetup.get(trade.setup) ?? [];
    arr.push(trade);
    bySetup.set(trade.setup, arr);
  }

  const sorted = [...closed].sort((a, b) => (a.exitDate ?? "").localeCompare(b.exitDate ?? ""));
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (prev.pnl < 0) {
      const key = curr.setup;
      const row = setupsAfterLoss.get(key) ?? { pnl: 0, count: 0 };
      row.pnl += curr.pnl;
      row.count += 1;
      setupsAfterLoss.set(key, row);
    }
  }

  const bestAfterLosses = [...setupsAfterLoss.entries()]
    .map(([setup, row]) => [setup, row.count ? row.pnl / row.count : -999] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map((entry) => entry[0]);

  const failsWhenOverused = [...bySetup.entries()]
    .filter(([, arr]) => arr.length > 40)
    .map(([setup, arr]) => {
      const tail = arr.slice(-15).reduce((s, t) => s + t.rr, 0) / 15;
      return [setup, tail] as const;
    })
    .sort((a, b) => a[1] - b[1])
    .slice(0, 2)
    .map((entry) => entry[0]);

  const tooPredictable = [...bySetup.entries()]
    .map(([setup, arr]) => {
      const avgSlippage = arr.reduce((s, t) => s + t.slippage, 0) / Math.max(1, arr.length);
      return [setup, avgSlippage] as const;
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map((entry) => entry[0]);

  const transitionScores = new Map<string, number>();
  for (const trade of closed) {
    const key = `${trade.marketRegime}->${trade.setup}`;
    transitionScores.set(key, (transitionScores.get(key) ?? 0) + trade.regimeTransitionDamage);
  }

  const damagingTransitions = [...transitionScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map((x) => x[0]);

  const byMonth = new Map<string, number[]>();
  for (const trade of closed) {
    const monthKey = (trade.exitDate ?? trade.entryDate).slice(0, 7);
    const arr = byMonth.get(monthKey) ?? [];
    arr.push(trade.rr);
    byMonth.set(monthKey, arr);
  }

  const strategicDriftMonths = [...byMonth.entries()]
    .map(([month, rr]) => [month, rr.reduce((s, v) => s + v, 0) / rr.length] as const)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map((entry) => entry[0]);

  return {
    bestAfterLosses: bestAfterLosses.length ? bestAfterLosses : ["PULLBACK"],
    failsWhenOverused: failsWhenOverused.length ? failsWhenOverused : ["NEWS_FADE"],
    tooPredictable: tooPredictable.length ? tooPredictable : ["BREAKOUT"],
    damagingTransitions,
    strategicDriftMonths,
  };
}

export function computeGameTheoryState(
  trades: Trade[],
  core: CoreMetrics,
  riskEvents: RiskEvent[],
): GameTheoryState {
  const closed = trades.filter((t) => t.status === "CLOSED");
  const latestDate = closed.length ? (closed[closed.length - 1].exitDate ?? closed[closed.length - 1].entryDate) : "2025-12-31";

  const regimeDetection = inferRegime(trades);
  const { mix: strategyMix, noTradeWeight } = buildStrategyMix(regimeDetection.regime, regimeDetection.confidence, core);
  const beliefs = buildBeliefs(trades);
  const robustRiskPosture = classifyRiskPosture(core, regimeDetection.confidence);
  const infoDisadvantageRisk = infoDisadvantage(riskEvents, latestDate, regimeDetection.regime);
  const setupRecommendationsList = setupRecommendations(beliefs, trades, regimeDetection.regime);

  const noTradeRecommended =
    noTradeWeight > 0.24 || robustRiskPosture === "CAPITAL_PRESERVATION" || infoDisadvantageRisk === "HIGH";

  const noTradeReason = noTradeRecommended
    ? "Information asymmetry and regime instability are elevated; preserving optionality has higher expected utility than forcing trades."
    : "Regime confidence and execution conditions support selective deployment.";

  return {
    regimeDetection,
    strategyMix,
    robustRiskPosture,
    beliefs,
    infoDisadvantageRisk,
    setupRecommendations: setupRecommendationsList,
    repeatedGameDisciplineScore: Number(core.disciplineScore.toFixed(1)),
    noTradeRecommended,
    noTradeReason,
    metaAnalytics: metaAnalytics(trades),
  };
}
