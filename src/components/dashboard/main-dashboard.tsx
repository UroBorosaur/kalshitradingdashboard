"use client";

import { motion } from "framer-motion";

import { AccountSummaryPanel } from "@/components/dashboard/account-summary-panel";
import { BayesianBeliefCard } from "@/components/dashboard/bayesian-belief-card";
import { DisciplineScoreCard } from "@/components/dashboard/discipline-score-card";
import { EquityCurveChart } from "@/components/dashboard/equity-curve-chart";
import { ExploitabilityMatrix } from "@/components/dashboard/exploitability-matrix";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { InformationRiskCard } from "@/components/dashboard/information-risk-card";
import { LiveBrokerPanel } from "@/components/dashboard/live-broker-panel";
import { MetaStrategyPanel } from "@/components/dashboard/meta-strategy-panel";
import { MonthlyStatsGrid } from "@/components/dashboard/monthly-stats-grid";
import { OptionalityCard } from "@/components/dashboard/optionality-card";
import { RegimeDetectionCard } from "@/components/dashboard/regime-detection-card";
import { RewardRiskChart } from "@/components/dashboard/reward-risk-chart";
import { RobustRiskCard } from "@/components/dashboard/robust-risk-card";
import { StrategyMixCard } from "@/components/dashboard/strategy-mix-card";
import { SummaryCard } from "@/components/dashboard/summary-card";
import { TradeDetailDrawer } from "@/components/dashboard/trade-detail-drawer";
import { TradesListPanel } from "@/components/dashboard/trades-list-panel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import { useDashboardStore } from "@/store/dashboard-store";

export function MainDashboard() {
  const {
    accounts,
    symbols,
    setups,
    regimes,
    kpiCards,
    equitySeries,
    rewardRiskSeries,
    openTrades,
    closedTrades,
    monthlyGrid,
    gameTheory,
    selectedTrade,
    dataMode,
    liveModeEnabled,
    liveConnected,
    usingLiveData,
    liveStatus,
    liveLoading,
    refreshLive,
    placePaperOrder,
    closePosition,
  } = useDashboardData();

  const accountPill = useDashboardStore((s) => s.accountPill);
  const equityRange = useDashboardStore((s) => s.equityRange);
  const setEquityRange = useDashboardStore((s) => s.setEquityRange);
  const rewardRiskRange = useDashboardStore((s) => s.rewardRiskRange);
  const setRewardRiskRange = useDashboardStore((s) => s.setRewardRiskRange);

  const selectedAccount =
    accountPill === "MAIN"
      ? accounts.find((a) => a.type === "MAIN")
      : accountPill === "DEMO"
        ? accounts.find((a) => a.type === "DEMO")
        : accounts.find((a) => a.type === "MAIN") ?? accounts.find((a) => a.type === "DEMO") ?? accounts[0];

  return (
    <div className="space-y-4">
      <FilterBar symbols={symbols} setups={setups} regimes={regimes} />

      {liveModeEnabled ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs text-slate-300">
            <Badge variant={liveConnected ? "positive" : "warning"}>
              {liveConnected ? "Live Data Connected" : "Live Data Disconnected"}
            </Badge>
            <Badge variant="default">Provider: {liveStatus.provider}</Badge>
            <Badge variant="default">Orders: {liveStatus.orders.length}</Badge>
            <Badge variant="default">Positions: {liveStatus.positions.length}</Badge>
            <Badge variant="default">Activities: {liveStatus.activities.length}</Badge>
            <Badge variant={liveStatus.kalshi.connected ? "positive" : "warning"}>
              Kalshi: {liveStatus.kalshi.connected ? "Connected" : "Not Connected"}
            </Badge>
            <Badge variant="default">Kalshi Orders: {liveStatus.kalshi.orders.length}</Badge>
            <Badge variant="default">Kalshi Positions: {liveStatus.kalshi.positions.length}</Badge>
            <Badge variant="default">
              Kalshi Balance:{" "}
              {typeof liveStatus.kalshi.balanceUsd === "number"
                ? `$${liveStatus.kalshi.balanceUsd.toLocaleString()}`
                : "n/a"}
            </Badge>
            <Badge variant="default">
              Kalshi Portfolio:{" "}
              {typeof liveStatus.kalshi.portfolioUsd === "number"
                ? `$${liveStatus.kalshi.portfolioUsd.toLocaleString()}`
                : "n/a"}
            </Badge>
            <span className="text-slate-500">
              Last Sync: {liveStatus.lastSync ? new Date(liveStatus.lastSync).toLocaleTimeString() : "Not yet"}
            </span>
            {liveStatus.error ? <span className="text-red-300">Error: {liveStatus.error}</span> : null}
            {liveStatus.kalshi.error ? <span className="text-red-300">Kalshi: {liveStatus.kalshi.error}</span> : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 2xl:grid-cols-[1fr_370px]">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {kpiCards.map((metric) => (
              <SummaryCard key={metric.period} metric={metric} />
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <EquityCurveChart data={equitySeries} range={equityRange} onRangeChange={setEquityRange} />
            <RewardRiskChart data={rewardRiskSeries} range={rewardRiskRange} onRangeChange={setRewardRiskRange} />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <RegimeDetectionCard state={gameTheory} />
            <StrategyMixCard mix={gameTheory.strategyMix} />
            <RobustRiskCard state={gameTheory} />
            <BayesianBeliefCard beliefs={gameTheory.beliefs} />
            <DisciplineScoreCard score={gameTheory.repeatedGameDisciplineScore} />
            <InformationRiskCard state={gameTheory} />
          </div>

          <MetaStrategyPanel state={gameTheory} />

          <div className="grid gap-3 xl:grid-cols-2">
            <ExploitabilityMatrix recommendations={gameTheory.setupRecommendations} />
            <OptionalityCard noTradeRecommended={gameTheory.noTradeRecommended} reason={gameTheory.noTradeReason} />
          </div>

          <MonthlyStatsGrid data={monthlyGrid} />
        </div>

        <div className="space-y-4">
          <LiveBrokerPanel
            dataMode={dataMode}
            usingLiveData={usingLiveData}
            status={liveStatus}
            loading={liveLoading}
            onRefresh={refreshLive}
            onPlaceOrder={placePaperOrder}
            onClosePosition={closePosition}
          />
          {selectedAccount ? <AccountSummaryPanel account={selectedAccount} /> : null}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
            <TradesListPanel openTrades={openTrades} closedTrades={closedTrades} />
          </motion.div>
        </div>
      </div>

      <TradeDetailDrawer trade={selectedTrade} />
    </div>
  );
}
