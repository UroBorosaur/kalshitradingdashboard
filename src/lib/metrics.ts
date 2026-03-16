import {
  type CoreMetrics,
  type EquitySnapshot,
  type KpiCardMetrics,
  type KpiPeriod,
  type MonthlyPerformance,
  type SetupKey,
  type StreakStatistics,
  type Trade,
} from "@/lib/types";

export type TimeRange = "H" | "D" | "W" | "M" | "3M" | "Y";

export interface TradeFilters {
  accountType: "ALL" | "DEMO" | "MAIN" | "MISSED";
  setup: "ALL" | SetupKey;
  symbol: "ALL" | string;
  direction: "ALL" | "LONG" | "SHORT";
  regime: "ALL" | Trade["marketRegime"];
  dateFrom: string;
  dateTo: string;
}

function toDate(input: string): Date {
  return new Date(`${input}T00:00:00.000Z`);
}

function startForPeriod(maxDate: Date, period: KpiPeriod): Date {
  const out = new Date(maxDate);
  if (period === "WEEK") out.setUTCDate(out.getUTCDate() - 7);
  if (period === "MONTH") out.setUTCMonth(out.getUTCMonth() - 1);
  if (period === "YEAR") out.setUTCFullYear(out.getUTCFullYear() - 1);
  if (period === "ALL_TIME") out.setUTCFullYear(1970);
  return out;
}

function startForRange(maxDate: Date, range: TimeRange): Date {
  const out = new Date(maxDate);
  switch (range) {
    case "H":
      out.setUTCDate(out.getUTCDate() - 2);
      break;
    case "D":
      out.setUTCDate(out.getUTCDate() - 14);
      break;
    case "W":
      out.setUTCDate(out.getUTCDate() - 60);
      break;
    case "M":
      out.setUTCMonth(out.getUTCMonth() - 6);
      break;
    case "3M":
      out.setUTCMonth(out.getUTCMonth() - 12);
      break;
    case "Y":
      out.setUTCFullYear(out.getUTCFullYear() - 2);
      break;
  }
  return out;
}

export function applyTradeFilters(trades: Trade[], filters: TradeFilters): Trade[] {
  return trades.filter((trade) => {
    if (filters.accountType === "DEMO" && trade.accountType !== "DEMO") return false;
    if (filters.accountType === "MAIN" && trade.accountType !== "MAIN") return false;
    if (filters.accountType === "MISSED" && trade.status !== "MISSED") return false;
    if (filters.setup !== "ALL" && trade.setup !== filters.setup) return false;
    if (filters.symbol !== "ALL" && trade.symbol !== filters.symbol) return false;
    if (filters.direction !== "ALL" && trade.direction !== filters.direction) return false;
    if (filters.regime !== "ALL" && trade.marketRegime !== filters.regime) return false;

    const tradeDate = trade.exitDate ?? trade.entryDate;
    if (filters.dateFrom && tradeDate < filters.dateFrom) return false;
    if (filters.dateTo && tradeDate > filters.dateTo) return false;
    return true;
  });
}

export function splitOpenClosed(trades: Trade[]): { open: Trade[]; closed: Trade[]; missed: Trade[] } {
  return {
    open: trades.filter((t) => t.status === "OPEN"),
    closed: trades.filter((t) => t.status === "CLOSED"),
    missed: trades.filter((t) => t.status === "MISSED"),
  };
}

export function computeKpiForPeriod(trades: Trade[], period: KpiPeriod): KpiCardMetrics {
  const closed = trades.filter((t) => t.status === "CLOSED" && t.exitDate);
  const maxDate = closed.length
    ? toDate(closed[closed.length - 1].exitDate as string)
    : new Date("2025-12-31T00:00:00.000Z");
  const start = startForPeriod(maxDate, period);

  const windowed = closed.filter((t) => toDate(t.exitDate as string) >= start);

  const pnl = windowed.reduce((sum, t) => sum + t.pnl, 0);
  const rr = windowed.reduce((sum, t) => sum + t.rr, 0);
  const wins = windowed.filter((t) => t.pnl > 0).length;
  const losses = windowed.filter((t) => t.pnl < 0).length;
  const breakeven = windowed.length - wins - losses;
  const returnPct = windowed.length ? windowed.reduce((sum, t) => sum + t.pnlPercent, 0) : 0;

  return {
    period,
    label:
      period === "WEEK"
        ? "This Week"
        : period === "MONTH"
          ? "This Month"
          : period === "YEAR"
            ? "This Year"
            : "All Time",
    rr,
    returnPct,
    pnl,
    winRate: windowed.length ? wins / windowed.length : 0,
    wins,
    losses,
    breakeven,
    trades: windowed.length,
  };
}

function calcStreaks(trades: Trade[]): StreakStatistics {
  let current = 0;
  let maxWin = 0;
  let maxLoss = 0;

  for (const t of trades) {
    if (t.pnl > 0) {
      current = current >= 0 ? current + 1 : 1;
      maxWin = Math.max(maxWin, current);
    } else if (t.pnl < 0) {
      current = current <= 0 ? current - 1 : -1;
      maxLoss = Math.max(maxLoss, Math.abs(current));
    }
  }

  return {
    maxWinStreak: maxWin,
    maxLossStreak: maxLoss,
    currentStreak: current,
  };
}

function calcMaxDrawdown(equity: EquitySnapshot[]): number {
  const sorted = [...equity].sort((a, b) => a.date.localeCompare(b.date));
  let peak = Number.NEGATIVE_INFINITY;
  let maxDd = 0;

  for (const row of sorted) {
    peak = Math.max(peak, row.balance);
    const dd = peak > 0 ? (peak - row.balance) / peak : 0;
    maxDd = Math.max(maxDd, dd);
  }

  return maxDd;
}

function rollingSharpeLike(pnls: number[]): number {
  if (!pnls.length) return 0;
  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const variance = pnls.reduce((acc, v) => acc + (v - mean) ** 2, 0) / Math.max(1, pnls.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (mean / std) * Math.sqrt(252);
}

export function computeCoreMetrics(trades: Trade[], equity: EquitySnapshot[]): CoreMetrics {
  const closed = trades
    .filter((t) => t.status === "CLOSED")
    .sort((a, b) => (a.exitDate ?? "").localeCompare(b.exitDate ?? ""));

  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl < 0);
  const breakeven = closed.filter((t) => t.pnl === 0);

  const total = Math.max(1, closed.length);
  const avgWin = wins.length ? wins.reduce((a, b) => a + b.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, b) => a + Math.abs(b.pnl), 0) / losses.length : 0;
  const grossProfit = wins.reduce((a, b) => a + b.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b.pnl, 0));

  const setupKeys: SetupKey[] = [
    "BREAKOUT",
    "PULLBACK",
    "MEAN_REVERSION",
    "MOMENTUM_CONTINUATION",
    "NEWS_FADE",
  ];

  const setupExpectancy = setupKeys.reduce<Record<SetupKey, number>>(
    (acc, key) => {
      const subset = closed.filter((t) => t.setup === key);
      const exp = subset.length ? subset.reduce((sum, t) => sum + t.pnl, 0) / subset.length : 0;
      acc[key] = exp;
      return acc;
    },
    {
      BREAKOUT: 0,
      PULLBACK: 0,
      MEAN_REVERSION: 0,
      MOMENTUM_CONTINUATION: 0,
      NEWS_FADE: 0,
    },
  );

  const regimeAdjustedExpectancy = closed.length
    ? closed.reduce((sum, t) => sum + t.pnl * (1 - t.regimeTransitionDamage * 0.25), 0) / closed.length
    : 0;

  const disciplineComponents = closed.map((t) => {
    const followStopPenalty = t.executionScore < 60 ? 12 : 0;
    const revengePenalty = t.tags.includes("revenge") ? 16 : 0;
    const overtradePenalty = t.overusePenalty * 18;
    return 100 - followStopPenalty - revengePenalty - overtradePenalty;
  });

  const disciplineScore =
    disciplineComponents.length > 0
      ? disciplineComponents.reduce((a, b) => a + b, 0) / disciplineComponents.length
      : 0;

  const exploitabilityScore = Math.min(
    100,
    Math.max(
      0,
      45 +
        closed.reduce((sum, t) => sum + t.overusePenalty * 25 + Math.max(0, t.slippage - 0.8) * 20, 0) / Math.max(1, closed.length),
    ),
  );

  const uncertaintyScore = Math.min(
    100,
    Math.max(
      0,
      40 +
        closed.reduce((sum, t) => sum + t.regimeTransitionDamage * 40 + (1 - t.confidenceScore) * 20, 0) /
          Math.max(1, closed.length),
    ),
  );

  return {
    winRate: wins.length / total,
    lossRate: losses.length / total,
    breakevenRate: breakeven.length / total,
    expectancy: closed.length ? closed.reduce((a, b) => a + b.rr, 0) / closed.length : 0,
    averageRR: closed.length ? closed.reduce((a, b) => a + b.rr, 0) / closed.length : 0,
    averageWin: avgWin,
    averageLoss: avgLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : 0,
    maxDrawdown: calcMaxDrawdown(equity),
    rollingSharpeLike: rollingSharpeLike(equity.map((e) => e.dailyPnl)),
    streaks: calcStreaks(closed),
    regimeAdjustedExpectancy,
    setupExpectancy,
    disciplineScore,
    exploitabilityScore,
    uncertaintyScore,
  };
}

export function sliceEquityByRange(equity: EquitySnapshot[], range: TimeRange): EquitySnapshot[] {
  if (!equity.length) return [];
  const sorted = [...equity].sort((a, b) => a.date.localeCompare(b.date));
  const maxDate = toDate(sorted[sorted.length - 1].date);
  const minDate = startForRange(maxDate, range);
  return sorted.filter((e) => toDate(e.date) >= minDate);
}

export interface RewardRiskBucket {
  label: string;
  rr: number;
  cumulativeRR: number;
  trades: number;
}

export function buildRewardRiskBuckets(trades: Trade[]): RewardRiskBucket[] {
  const closed = trades.filter((t) => t.status === "CLOSED" && t.exitDate);
  const byMonth = new Map<string, { rr: number; trades: number }>();

  for (const trade of closed) {
    const d = new Date(`${trade.exitDate}T00:00:00.000Z`);
    const label = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const curr = byMonth.get(label) ?? { rr: 0, trades: 0 };
    curr.rr += trade.rr;
    curr.trades += 1;
    byMonth.set(label, curr);
  }

  const labels = [...byMonth.keys()].sort();
  let cum = 0;

  return labels.map((label) => {
    const row = byMonth.get(label) ?? { rr: 0, trades: 0 };
    cum += row.rr;
    return {
      label,
      rr: Number(row.rr.toFixed(2)),
      cumulativeRR: Number(cum.toFixed(2)),
      trades: row.trades,
    };
  });
}

export type MonthlyMetricView = "RR" | "NET" | "PROFIT" | "STRIKE";

export function monthlyMetricValue(row: MonthlyPerformance, metric: MonthlyMetricView): number {
  if (metric === "RR") return row.rr;
  if (metric === "NET") return row.netPercent;
  if (metric === "PROFIT") return row.profit;
  return row.strikeRate;
}

export function buildKpiCards(trades: Trade[]): KpiCardMetrics[] {
  return [
    computeKpiForPeriod(trades, "WEEK"),
    computeKpiForPeriod(trades, "MONTH"),
    computeKpiForPeriod(trades, "YEAR"),
    computeKpiForPeriod(trades, "ALL_TIME"),
  ];
}

export function deriveMonthlyPerformanceFromTrades(trades: Trade[]): MonthlyPerformance[] {
  const closed = trades.filter((t) => t.status === "CLOSED");
  if (!closed.length) return [];

  const grouped = new Map<string, { rr: number; pnl: number; wins: number; trades: number }>();
  for (const trade of closed) {
    const date = trade.exitDate ?? trade.entryDate;
    const d = new Date(`${date}T00:00:00.000Z`);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
    const row = grouped.get(key) ?? { rr: 0, pnl: 0, wins: 0, trades: 0 };
    row.rr += trade.rr;
    row.pnl += trade.pnl;
    row.wins += trade.pnl > 0 ? 1 : 0;
    row.trades += 1;
    grouped.set(key, row);
  }

  const years = Array.from(
    new Set(closed.map((t) => Number((t.exitDate ?? t.entryDate).slice(0, 4))).filter((y) => Number.isFinite(y))),
  ).sort();

  const out: MonthlyPerformance[] = [];
  for (const year of years) {
    for (let month = 1; month <= 12; month += 1) {
      const key = `${year}-${month}`;
      const row = grouped.get(key) ?? { rr: 0, pnl: 0, wins: 0, trades: 0 };
      out.push({
        year,
        month,
        rr: Number(row.rr.toFixed(2)),
        netPercent: row.trades ? Number((row.pnl / 100000).toFixed(4)) : 0,
        profit: Number(row.pnl.toFixed(2)),
        strikeRate: row.trades ? Number((row.wins / row.trades).toFixed(4)) : 0,
        trades: row.trades,
      });
    }
  }

  return out;
}
