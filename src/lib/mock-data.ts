import {
  type Account,
  type AccountType,
  type DashboardData,
  type EquitySnapshot,
  type MarketRegime,
  type MonthlyPerformance,
  type RiskEvent,
  type SetupDefinition,
  type SetupKey,
  type StreakStatistics,
  type Trade,
  type TradeDirection,
  type TradeStatus,
} from "@/lib/types";
import { toISODate } from "@/lib/utils";

interface Rng {
  next: () => number;
  normal: (mean?: number, stdev?: number) => number;
  int: (min: number, max: number) => number;
  pick: <T>(items: T[]) => T;
}

function createRng(seed = 101): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const normal = (mean = 0, stdev = 1) => {
    const u1 = Math.max(next(), 1e-9);
    const u2 = Math.max(next(), 1e-9);
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * stdev;
  };
  const int = (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min;
  const pick = <T,>(items: T[]) => items[int(0, items.length - 1)];
  return { next, normal, int, pick };
}

const setups: SetupDefinition[] = [
  { key: "BREAKOUT", label: "Breakout", archetype: "trend", baseEdge: 0.11, color: "#38bdf8" },
  { key: "PULLBACK", label: "Pullback", archetype: "trend", baseEdge: 0.08, color: "#22d3ee" },
  { key: "MEAN_REVERSION", label: "Mean Reversion", archetype: "reversion", baseEdge: 0.05, color: "#f59e0b" },
  {
    key: "MOMENTUM_CONTINUATION",
    label: "Momentum Continuation",
    archetype: "trend",
    baseEdge: 0.1,
    color: "#34d399",
  },
  { key: "NEWS_FADE", label: "News Fade", archetype: "event", baseEdge: 0.03, color: "#f472b6" },
];

const symbols = ["AAPL", "MSFT", "EURUSD", "GBPUSD", "USDCAD", "ES", "NQ", "BTCUSD", "ETHUSD"];

const symbolReferencePrice: Record<string, number> = {
  AAPL: 192,
  MSFT: 418,
  EURUSD: 1.09,
  GBPUSD: 1.27,
  USDCAD: 1.35,
  ES: 5180,
  NQ: 18350,
  BTCUSD: 68800,
  ETHUSD: 3350,
};

const regimeMap: Record<MarketRegime, number> = {
  TREND_FOLLOWER: 0.16,
  MEAN_REVERSION: 0.07,
  HIGH_VOL_ADVERSARIAL: -0.18,
  NEWS_SHOCK: -0.06,
  LOW_LIQUIDITY_TRAP: -0.12,
};

const regimePool: MarketRegime[] = [
  "TREND_FOLLOWER",
  "TREND_FOLLOWER",
  "MEAN_REVERSION",
  "HIGH_VOL_ADVERSARIAL",
  "NEWS_SHOCK",
  "LOW_LIQUIDITY_TRAP",
];

const setupTagMap: Record<SetupKey, string[]> = {
  BREAKOUT: ["range-expansion", "trend-day"],
  PULLBACK: ["mean-entry", "trend-resume"],
  MEAN_REVERSION: ["counter-trend", "fade"],
  MOMENTUM_CONTINUATION: ["impulse", "follow-through"],
  NEWS_FADE: ["event-vol", "headline"],
};

function accountRiskUnit(type: AccountType): number {
  return type === "MAIN" ? 165 : 90;
}

function statusFromRng(rng: Rng): TradeStatus {
  const roll = rng.next();
  if (roll < 0.73) return "CLOSED";
  if (roll < 0.9) return "OPEN";
  return "MISSED";
}

function assetClassFromSymbol(symbol: string): Trade["assetClass"] {
  if (["AAPL", "MSFT"].includes(symbol)) return "EQUITY";
  if (["EURUSD", "GBPUSD", "USDCAD"].includes(symbol)) return "FX";
  if (["ES", "NQ"].includes(symbol)) return "INDEX_FUTURE";
  return "CRYPTO";
}

function quantityForTrade(assetClass: Trade["assetClass"], rng: Rng): number {
  if (assetClass === "EQUITY") return rng.int(1, 75);
  if (assetClass === "FX") return rng.int(1, 25) * 1000;
  if (assetClass === "INDEX_FUTURE") return rng.int(1, 8);
  return Number((0.05 + rng.next() * 1.95).toFixed(3));
}

function priceForTrade(symbol: string, assetClass: Trade["assetClass"], rng: Rng): number {
  const ref = symbolReferencePrice[symbol] ?? 100;
  const stdev = assetClass === "FX" ? 0.008 : assetClass === "CRYPTO" ? 0.05 : 0.03;
  const raw = ref * (1 + rng.normal(0, stdev));
  const bounded = Math.max(assetClass === "FX" ? 0.5 : 0.01, raw);
  if (assetClass === "FX") return Number(bounded.toFixed(4));
  if (assetClass === "CRYPTO") return Number(bounded.toFixed(2));
  return Number(bounded.toFixed(2));
}

function generateTrades(startDate: Date, endDate: Date, rng: Rng): Trade[] {
  const days = Math.max(1, Math.floor((endDate.getTime() - startDate.getTime()) / 86400000));
  const out: Trade[] = [];

  for (let i = 0; i < 340; i += 1) {
    const accountType: AccountType = rng.next() < 0.58 ? "MAIN" : "DEMO";
    const setup = rng.pick(setups).key;
    const symbol = rng.pick(symbols);
    const regime = rng.pick(regimePool);
    const status = statusFromRng(rng);
    const direction: TradeDirection = rng.next() < 0.51 ? "LONG" : "SHORT";
    const assetClass = assetClassFromSymbol(symbol);
    const quantity = quantityForTrade(assetClass, rng);
    const price = priceForTrade(symbol, assetClass, rng);

    const entryOffset = rng.int(0, days - 3);
    const entry = new Date(startDate.getTime() + entryOffset * 86400000);

    let exit: Date | null = null;
    if (status === "CLOSED") {
      exit = new Date(entry.getTime() + rng.int(1, 6) * 86400000);
      if (exit > endDate) exit = new Date(endDate);
    }

    const setupDef = setups.find((s) => s.key === setup);
    const baseEdge = setupDef ? setupDef.baseEdge : 0;
    const regimeAdj = regimeMap[regime];
    const qualityFactor = rng.normal(0, 0.22);
    const rrRaw = baseEdge + regimeAdj + qualityFactor;

    const rr = status === "MISSED" ? 0 : Number((rrRaw * 2.2).toFixed(2));
    const riskUnit = accountRiskUnit(accountType);
    const pnl = status === "MISSED" ? 0 : Number((rr * riskUnit).toFixed(2));

    const accountBase = accountType === "MAIN" ? 18000 : 10000;
    const pnlPercent = Number((pnl / accountBase).toFixed(4));

    const thesisQuality = Math.max(35, Math.min(98, Math.round(65 + (baseEdge * 90) + rng.normal(0, 14))));
    const executionScore = Math.max(30, Math.min(99, Math.round(70 + rng.normal(0, 13))));

    out.push({
      id: `T-${String(i + 1).padStart(4, "0")}`,
      symbol,
      assetClass,
      quantity,
      price,
      direction,
      setup,
      entryDate: toISODate(entry),
      exitDate: exit ? toISODate(exit) : null,
      pnl,
      pnlPercent,
      rr,
      status,
      accountType,
      tags: setupTagMap[setup],
      confidenceScore: Math.max(0.2, Math.min(0.98, Number((0.55 + baseEdge + rng.normal(0, 0.12)).toFixed(2)))),
      marketRegime: regime,
      notes:
        status === "MISSED"
          ? "Setup validated but skipped due to event risk window."
          : "Executed according to plan with adaptive stop management.",
      executionScore,
      slippage: Number((Math.abs(rng.normal(0.4, 0.55))).toFixed(2)),
      thesisQuality,
      opponentProfile:
        regime === "HIGH_VOL_ADVERSARIAL"
          ? "Liquidity-hunting spoof flow"
          : regime === "NEWS_SHOCK"
            ? "Information asymmetry burst"
            : regime === "LOW_LIQUIDITY_TRAP"
              ? "Thin-book fake breakout"
              : regime === "MEAN_REVERSION"
                ? "Dealer gamma pin"
                : "Systematic trend follower",
      regimeTransitionDamage: Number(Math.max(0, rng.normal(0.35, 0.28)).toFixed(2)),
      overusePenalty: Number(Math.max(0, rng.normal(0.28, 0.24)).toFixed(2)),
      quality: {
        thesisQuality,
        timingQuality: Math.max(30, Math.min(99, Math.round(68 + rng.normal(0, 15)))),
        executionQuality: executionScore,
        regimeFit: Math.max(25, Math.min(99, Math.round(66 + rng.normal(0, 14)))),
        sizingQuality: Math.max(28, Math.min(99, Math.round(67 + rng.normal(0, 14)))),
        exitQuality: Math.max(25, Math.min(99, Math.round(64 + rng.normal(0, 16)))),
      },
    });
  }

  return out.sort((a, b) => a.entryDate.localeCompare(b.entryDate));
}

function generateEquitySeries(
  accountType: AccountType,
  trades: Trade[],
  startDate: Date,
  endDate: Date,
  rng: Rng,
): EquitySnapshot[] {
  const closed = trades.filter((t) => t.accountType === accountType && t.status === "CLOSED" && t.exitDate);
  const byDate = new Map<string, number>();
  for (const trade of closed) {
    const key = trade.exitDate as string;
    byDate.set(key, (byDate.get(key) ?? 0) + trade.pnl);
  }

  const out: EquitySnapshot[] = [];
  let balance = accountType === "MAIN" ? 18000 : 9800;
  let peak = balance;

  for (let d = new Date(startDate); d <= endDate; d = new Date(d.getTime() + 86400000)) {
    const date = toISODate(d);
    const realized = byDate.get(date) ?? 0;
    const drift = accountType === "MAIN" ? rng.normal(7.2, 42) : rng.normal(3.8, 24);
    const dailyPnl = Number((realized + drift).toFixed(2));

    balance = Number((balance + dailyPnl).toFixed(2));
    peak = Math.max(peak, balance);
    const drawdown = peak === 0 ? 0 : Number(((peak - balance) / peak).toFixed(4));

    out.push({
      date,
      balance,
      dailyPnl,
      drawdown,
      accountType,
    });
  }

  return out;
}

function computeMonthlyPerformance(trades: Trade[]): MonthlyPerformance[] {
  const closed = trades.filter((t) => t.status === "CLOSED" && t.exitDate);
  const grouped = new Map<string, { rr: number; pnl: number; wins: number; trades: number }>();

  for (const t of closed) {
    const dt = new Date(t.exitDate as string);
    const key = `${dt.getUTCFullYear()}-${dt.getUTCMonth() + 1}`;
    const curr = grouped.get(key) ?? { rr: 0, pnl: 0, wins: 0, trades: 0 };
    curr.rr += t.rr;
    curr.pnl += t.pnl;
    curr.wins += t.pnl > 0 ? 1 : 0;
    curr.trades += 1;
    grouped.set(key, curr);
  }

  const out: MonthlyPerformance[] = [];
  const years = [2024, 2025];

  for (const year of years) {
    for (let month = 1; month <= 12; month += 1) {
      const key = `${year}-${month}`;
      const g = grouped.get(key) ?? { rr: 0, pnl: 0, wins: 0, trades: 0 };
      const strikeRate = g.trades ? g.wins / g.trades : 0;
      const netPercent = g.trades ? g.pnl / (year === 2024 ? 24000 : 26000) : 0;
      out.push({
        year,
        month,
        rr: Number(g.rr.toFixed(2)),
        netPercent: Number(netPercent.toFixed(4)),
        profit: Number(g.pnl.toFixed(2)),
        strikeRate: Number(strikeRate.toFixed(4)),
        trades: g.trades,
      });
    }
  }

  return out;
}

function computeStreaks(trades: Trade[]): StreakStatistics {
  const closed = trades
    .filter((t) => t.status === "CLOSED" && t.exitDate)
    .sort((a, b) => (a.exitDate as string).localeCompare(b.exitDate as string));

  let current = 0;
  let maxWin = 0;
  let maxLoss = 0;

  for (const trade of closed) {
    if (trade.pnl > 0) {
      current = current >= 0 ? current + 1 : 1;
      maxWin = Math.max(maxWin, current);
    } else if (trade.pnl < 0) {
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

function buildAccounts(equity: EquitySnapshot[], streaks: StreakStatistics): Account[] {
  const latestMain = equity.filter((e) => e.accountType === "MAIN").slice(-1)[0];
  const latestDemo = equity.filter((e) => e.accountType === "DEMO").slice(-1)[0];
  const maxDdMain = Math.max(...equity.filter((e) => e.accountType === "MAIN").map((e) => e.drawdown));
  const maxDdDemo = Math.max(...equity.filter((e) => e.accountType === "DEMO").map((e) => e.drawdown));

  return [
    {
      id: "acct-main",
      name: "Main",
      type: "MAIN",
      balance: latestMain?.balance ?? 0,
      riskPercent: 0.01,
      riskValue: Number(((latestMain?.balance ?? 0) * 0.01).toFixed(2)),
      currentStreak: streaks.currentStreak,
      maxDrawdown: Number(maxDdMain.toFixed(4)),
    },
    {
      id: "acct-demo",
      name: "Demo Account",
      type: "DEMO",
      balance: latestDemo?.balance ?? 0,
      riskPercent: 0.012,
      riskValue: Number(((latestDemo?.balance ?? 0) * 0.012).toFixed(2)),
      currentStreak: Math.round(streaks.currentStreak * 0.6),
      maxDrawdown: Number(maxDdDemo.toFixed(4)),
    },
  ];
}

function generateRiskEvents(startDate: Date, endDate: Date, rng: Rng): RiskEvent[] {
  const types: RiskEvent["type"][] = ["FOMC", "EARNINGS_CLUSTER", "LIQUIDITY_DRAIN", "VOL_EXPANSION", "MACRO_DATA"];
  const out: RiskEvent[] = [];

  const days = Math.max(1, Math.floor((endDate.getTime() - startDate.getTime()) / 86400000));
  for (let i = 0; i < 28; i += 1) {
    const date = new Date(startDate.getTime() + rng.int(0, days) * 86400000);
    const type = rng.pick(types);
    out.push({
      id: `R-${String(i + 1).padStart(3, "0")}`,
      date: toISODate(date),
      type,
      severity: Number(Math.max(0.2, Math.min(1, rng.normal(0.58, 0.22))).toFixed(2)),
      description:
        type === "FOMC"
          ? "Policy decision window with elevated repricing risk."
          : type === "EARNINGS_CLUSTER"
            ? "Concentrated earnings releases increase gap risk."
            : type === "LIQUIDITY_DRAIN"
              ? "Holiday/overnight liquidity thinning across books."
              : type === "VOL_EXPANSION"
                ? "Unexpected volatility expansion beyond trailing bands."
                : "Macro release with potential information asymmetry.",
    });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function buildMockData(): DashboardData {
  const rng = createRng(20260309);
  const startDate = new Date("2024-01-01T00:00:00.000Z");
  const endDate = new Date("2025-12-31T00:00:00.000Z");

  const trades = generateTrades(startDate, endDate, rng);
  const mainEquity = generateEquitySeries("MAIN", trades, startDate, endDate, rng);
  const demoEquity = generateEquitySeries("DEMO", trades, startDate, endDate, rng);
  const equity = [...mainEquity, ...demoEquity].sort((a, b) => a.date.localeCompare(b.date));

  const monthlyPerformance = computeMonthlyPerformance(trades);
  const streakStats = computeStreaks(trades);

  const accounts = buildAccounts(equity, streakStats);
  const riskEvents = generateRiskEvents(startDate, endDate, rng);

  return {
    accounts,
    trades,
    equity,
    monthlyPerformance,
    setups,
    strategyTags: ["opening-drive", "mean-reversion", "event-vol", "late-session", "news-reactive", "trend-day"],
    riskEvents,
    streakStats,
  };
}

export const mockData: DashboardData = buildMockData();
