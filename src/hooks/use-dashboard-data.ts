"use client";

import { useMemo } from "react";

import { useLiveBrokerData } from "@/hooks/use-live-broker-data";
import { computeGameTheoryState } from "@/lib/game-theory";
import {
  mapAlpacaAccount,
  mapAlpacaEquityHistory,
  mapAlpacaOrdersToTrades,
  mapKalshiOrdersToTrades,
  mapKalshiPositionsToTrades,
} from "@/lib/live/mappers";
import {
  applyTradeFilters,
  buildKpiCards,
  buildRewardRiskBuckets,
  computeCoreMetrics,
  deriveMonthlyPerformanceFromTrades,
  monthlyMetricValue,
  sliceEquityByRange,
  splitOpenClosed,
} from "@/lib/metrics";
import { mockData } from "@/lib/mock-data";
import type { MonthlyMetricView, TradeFilters } from "@/lib/metrics";
import type { SetupKey, Trade } from "@/lib/types";
import { useDashboardStore } from "@/store/dashboard-store";

export function useDashboardData() {
  const {
    accountPill,
    dataMode,
    setupFilter,
    symbolFilter,
    directionFilter,
    regimeFilter,
    dateFrom,
    dateTo,
    equityRange,
    rewardRiskRange,
    monthlyMetricView,
    selectedTradeId,
  } = useDashboardStore();

  const live = useLiveBrokerData(dataMode === "LIVE");

  const liveAccounts = useMemo(() => mapAlpacaAccount(live.snapshot.account), [live.snapshot.account]);
  const liveEquity = useMemo(() => mapAlpacaEquityHistory(live.snapshot.equityHistory), [live.snapshot.equityHistory]);
  const kalshiTitlesByTicker = useMemo(
    () =>
      live.snapshot.kalshi.orders.reduce<Record<string, string>>((acc, order) => {
        const ticker = String(order.ticker ?? "").toUpperCase().trim();
        const title = order.title?.trim();
        if (ticker && title && !acc[ticker]) acc[ticker] = title;
        return acc;
      }, {}),
    [live.snapshot.kalshi.orders],
  );
  const liveTrades = useMemo(
    () =>
      mapAlpacaOrdersToTrades(
        live.snapshot.orders,
        live.snapshot.positions,
        live.snapshot.activities,
        Number(live.snapshot.account?.equity ?? 0),
      ),
    [live.snapshot.orders, live.snapshot.positions, live.snapshot.activities, live.snapshot.account],
  );
  const kalshiPositionTrades = useMemo(
    () =>
      mapKalshiPositionsToTrades(
        live.snapshot.kalshi.positions,
        live.snapshot.kalshi.quotes,
        Number(
          live.snapshot.kalshi.portfolioUsd ??
            live.snapshot.kalshi.balanceUsd ??
            live.snapshot.kalshi.cashUsd ??
            live.snapshot.account?.equity ??
            0,
        ),
        kalshiTitlesByTicker,
      ),
    [
      live.snapshot.kalshi.positions,
      live.snapshot.kalshi.quotes,
      live.snapshot.kalshi.portfolioUsd,
      live.snapshot.kalshi.balanceUsd,
      live.snapshot.kalshi.cashUsd,
      kalshiTitlesByTicker,
      live.snapshot.account,
    ],
  );

  const kalshiOrderHistoryTrades = useMemo(
    () =>
      mapKalshiOrdersToTrades(
        live.snapshot.kalshi.orders,
        live.snapshot.kalshi.fills,
        live.snapshot.kalshi.quotes,
        Number(
          live.snapshot.kalshi.portfolioUsd ??
            live.snapshot.kalshi.balanceUsd ??
            live.snapshot.kalshi.cashUsd ??
            live.snapshot.account?.equity ??
            0,
        ),
      ).filter((trade) => trade.status !== "OPEN"),
    [
      live.snapshot.kalshi.orders,
      live.snapshot.kalshi.fills,
      live.snapshot.kalshi.quotes,
      live.snapshot.kalshi.portfolioUsd,
      live.snapshot.kalshi.balanceUsd,
      live.snapshot.kalshi.cashUsd,
      live.snapshot.account,
    ],
  );

  const liveModeEnabled = dataMode === "LIVE";
  const liveConnected = live.snapshot.connected;
  const usingLiveData = liveModeEnabled && liveConnected;

  // When Live mode is selected, never silently fall back to mock data.
  // This makes data-source state explicit and easier to debug.
  const sourceTrades = useMemo(
    () => (liveModeEnabled ? [...liveTrades, ...kalshiPositionTrades, ...kalshiOrderHistoryTrades] : mockData.trades),
    [liveModeEnabled, liveTrades, kalshiPositionTrades, kalshiOrderHistoryTrades],
  );
  const sourceEquity = useMemo(() => (liveModeEnabled ? liveEquity : mockData.equity), [liveModeEnabled, liveEquity]);
  const sourceAccounts = useMemo(
    () => (liveModeEnabled ? liveAccounts : mockData.accounts),
    [liveModeEnabled, liveAccounts],
  );

  const filters = useMemo<TradeFilters>(
    () => ({
      // In Live mode, Alpaca paper activity is mapped as DEMO-like account flow.
      // Treat MAIN/DEMO pills as aliases so persisted UI state doesn't hide live trades.
      accountType: liveModeEnabled && (accountPill === "MAIN" || accountPill === "DEMO") ? "DEMO" : accountPill,
      setup: setupFilter,
      symbol: symbolFilter,
      direction: directionFilter,
      regime: regimeFilter,
      dateFrom,
      dateTo,
    }),
    [liveModeEnabled, accountPill, setupFilter, symbolFilter, directionFilter, regimeFilter, dateFrom, dateTo],
  );

  const filteredTrades = useMemo(() => applyTradeFilters(sourceTrades, filters), [sourceTrades, filters]);

  const scopedEquity = useMemo(() => {
    if (liveModeEnabled && (accountPill === "MAIN" || accountPill === "DEMO")) {
      return sourceEquity.filter((e) => e.accountType === "DEMO");
    }
    if (accountPill === "MAIN") return sourceEquity.filter((e) => e.accountType === "MAIN");
    if (accountPill === "DEMO") return sourceEquity.filter((e) => e.accountType === "DEMO");
    return sourceEquity;
  }, [liveModeEnabled, accountPill, sourceEquity]);

  const { open, closed, missed } = useMemo(() => splitOpenClosed(filteredTrades), [filteredTrades]);

  const kpiCards = useMemo(() => buildKpiCards(filteredTrades), [filteredTrades]);

  const coreMetrics = useMemo(() => computeCoreMetrics(filteredTrades, scopedEquity), [filteredTrades, scopedEquity]);

  const gameTheory = useMemo(
    () => computeGameTheoryState(filteredTrades, coreMetrics, mockData.riskEvents),
    [filteredTrades, coreMetrics],
  );

  const equitySeries = useMemo(() => sliceEquityByRange(scopedEquity, equityRange), [scopedEquity, equityRange]);

  const rewardRiskSeries = useMemo(() => {
    const buckets = buildRewardRiskBuckets(filteredTrades);
    if (rewardRiskRange === "Y") return buckets.slice(-24);
    if (rewardRiskRange === "3M") return buckets.slice(-12);
    if (rewardRiskRange === "M") return buckets.slice(-6);
    if (rewardRiskRange === "W") return buckets.slice(-3);
    if (rewardRiskRange === "D") return buckets.slice(-2);
    return buckets.slice(-1);
  }, [filteredTrades, rewardRiskRange]);

  const monthlySource = useMemo(() => {
    if (liveModeEnabled) {
      const derived = deriveMonthlyPerformanceFromTrades(sourceTrades);
      return derived;
    }
    return mockData.monthlyPerformance;
  }, [liveModeEnabled, sourceTrades]);

  const monthlyGrid = useMemo(() => {
    return monthlySource.map((row) => ({
      ...row,
      value: monthlyMetricValue(row, monthlyMetricView as MonthlyMetricView),
    }));
  }, [monthlyMetricView, monthlySource]);

  const selectedTrade = useMemo(
    () => filteredTrades.find((trade) => trade.id === selectedTradeId) ?? null,
    [filteredTrades, selectedTradeId],
  );

  const symbols = useMemo<("ALL" | string)[]>(() => ["ALL", ...Array.from(new Set(sourceTrades.map((t) => t.symbol))).sort()], [sourceTrades]);

  const setups = useMemo<("ALL" | SetupKey)[]>(() => ["ALL", ...mockData.setups.map((s) => s.key)], []);
  const regimes = useMemo<("ALL" | Trade["marketRegime"])[]>(() => [
    "ALL",
    ...Array.from(new Set(sourceTrades.map((t) => t.marketRegime))),
  ], [sourceTrades]);

  return {
    accounts: sourceAccounts,
    setupsDefinitions: mockData.setups,
    filteredTrades,
    openTrades: open,
    closedTrades: closed,
    missedTrades: missed,
    kpiCards,
    coreMetrics,
    gameTheory,
    equitySeries,
    rewardRiskSeries,
    monthlyGrid,
    symbols,
    setups,
    regimes,
    selectedTrade,
    dataMode,
    liveModeEnabled,
    liveConnected,
    usingLiveData,
    liveStatus: live.snapshot,
    liveLoading: live.loading,
    refreshLive: live.refresh,
    placePaperOrder: live.placePaperOrder,
    closePosition: live.closePosition,
  };
}
