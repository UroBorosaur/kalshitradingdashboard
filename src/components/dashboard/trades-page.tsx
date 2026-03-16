"use client";

import { useMemo, useState } from "react";

import { FilterBar } from "@/components/dashboard/filter-bar";
import { TradeDetailDrawer } from "@/components/dashboard/trade-detail-drawer";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import { formatCurrency, formatPct, formatPrice, formatQuantity } from "@/lib/utils";
import { useDashboardStore } from "@/store/dashboard-store";

type TradeSourceFilter = "ALL" | "ALPACA" | "KALSHI";
const TRADES_PAGE_SIZE = 75;

function inferSource(tags: string[]): TradeSourceFilter {
  if (tags.includes("kalshi-demo")) return "KALSHI";
  if (tags.includes("alpaca-paper")) return "ALPACA";
  return "ALL";
}

export function TradesPage() {
  const { filteredTrades, symbols, setups, regimes, selectedTrade, coreMetrics } = useDashboardData();
  const setSelectedTradeId = useDashboardStore((s) => s.setSelectedTradeId);
  const [sourceFilter, setSourceFilter] = useState<TradeSourceFilter>("ALL");
  const [page, setPage] = useState(1);

  const sorted = useMemo(
    () =>
      filteredTrades
        .filter((trade) => (sourceFilter === "ALL" ? true : inferSource(trade.tags) === sourceFilter))
        .slice()
        .sort((a, b) => (b.exitDate ?? b.entryDate).localeCompare(a.exitDate ?? a.entryDate)),
    [filteredTrades, sourceFilter],
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / TRADES_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const pagedTrades = useMemo(() => {
    const start = (safePage - 1) * TRADES_PAGE_SIZE;
    return sorted.slice(start, start + TRADES_PAGE_SIZE);
  }, [sorted, safePage]);

  return (
    <div className="space-y-4">
      <FilterBar symbols={symbols} setups={setups} regimes={regimes} />

      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-xs text-slate-400">Expectancy</CardTitle>
          </CardHeader>
          <CardContent className={coreMetrics.expectancy >= 0 ? "text-lg font-semibold text-emerald-300" : "text-lg font-semibold text-red-300"}>
            {coreMetrics.expectancy.toFixed(2)} R
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs text-slate-400">Profit Factor</CardTitle>
          </CardHeader>
          <CardContent className="text-lg font-semibold text-sky-300">{coreMetrics.profitFactor.toFixed(2)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs text-slate-400">Avg Win</CardTitle>
          </CardHeader>
          <CardContent className="text-lg font-semibold text-emerald-300">{formatCurrency(coreMetrics.averageWin)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs text-slate-400">Avg Loss</CardTitle>
          </CardHeader>
          <CardContent className="text-lg font-semibold text-red-300">-{formatCurrency(coreMetrics.averageLoss)}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trade Ledger</CardTitle>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Source</span>
            {(["ALL", "ALPACA", "KALSHI"] as TradeSourceFilter[]).map((source) => (
              <button
                key={source}
                onClick={() => {
                  setSourceFilter(source);
                  setPage(1);
                }}
                className={
                  sourceFilter === source
                    ? "rounded-full border border-sky-500/50 bg-sky-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-sky-200"
                    : "rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
                }
              >
                {source}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[1360px] text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="px-2 py-2 text-left">Trade</th>
                <th className="px-2 py-2 text-left">Source</th>
                <th className="px-2 py-2 text-left">Setup</th>
                <th className="px-2 py-2 text-left">Regime</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2 text-right">Price</th>
                <th className="px-2 py-2 text-left">Dates</th>
                <th className="px-2 py-2 text-right">R:R</th>
                <th className="px-2 py-2 text-right">PnL %</th>
                <th className="px-2 py-2 text-right">PnL $</th>
                <th className="px-2 py-2 text-right">Exec</th>
                <th className="px-2 py-2 text-right">Thesis</th>
            </tr>
          </thead>
            <tbody>
              {pagedTrades.map((trade) => (
                <tr
                  key={trade.id}
                  className="cursor-pointer border-t border-slate-800/80 transition-colors hover:bg-slate-900/50"
                  onClick={() => setSelectedTradeId(trade.id)}
                >
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-200">{trade.symbol}</span>
                      <Badge variant={trade.direction === "LONG" ? "positive" : "negative"}>{trade.direction}</Badge>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-slate-300">
                    {inferSource(trade.tags) === "KALSHI" ? "Kalshi" : inferSource(trade.tags) === "ALPACA" ? "Alpaca" : "Other"}
                  </td>
                  <td className="px-2 py-2 text-slate-300">{trade.setup.replaceAll("_", " ")}</td>
                  <td className="px-2 py-2 text-slate-400">{trade.marketRegime.replaceAll("_", " ")}</td>
                  <td className="px-2 py-2 text-right text-slate-300">{formatQuantity(trade.quantity)}</td>
                  <td className="px-2 py-2 text-right text-slate-300">{formatPrice(trade.price)}</td>
                  <td className="px-2 py-2 text-slate-400">
                    {trade.entryDate} {"->"} {trade.exitDate ?? "Open"}
                  </td>
                  <td className={trade.rr >= 0 ? "px-2 py-2 text-right font-semibold text-emerald-300" : "px-2 py-2 text-right font-semibold text-red-300"}>
                    {trade.rr.toFixed(2)}
                  </td>
                  <td
                    className={
                      trade.pnlPercent >= 0
                        ? "px-2 py-2 text-right font-semibold text-emerald-300"
                        : "px-2 py-2 text-right font-semibold text-red-300"
                    }
                  >
                    {formatPct(trade.pnlPercent)}
                  </td>
                  <td className={trade.pnl >= 0 ? "px-2 py-2 text-right font-semibold text-emerald-300" : "px-2 py-2 text-right font-semibold text-red-300"}>
                    {formatCurrency(trade.pnl)}
                  </td>
                  <td className="px-2 py-2 text-right text-slate-300">{trade.executionScore}</td>
                  <td className="px-2 py-2 text-right text-slate-300">{trade.thesisQuality}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex items-center justify-between border-t border-slate-800 pt-3 text-xs text-slate-400">
            <span>
              {sorted.length} trades • page {safePage} of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(Math.max(1, safePage - 1))}
                disabled={safePage <= 1}
                className={
                  safePage <= 1
                    ? "cursor-not-allowed rounded-md border border-slate-800 bg-slate-900/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600"
                    : "rounded-md border border-slate-700 bg-slate-900 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-300 hover:border-slate-600"
                }
              >
                Prev
              </button>
              <button
                onClick={() => setPage(Math.min(totalPages, safePage + 1))}
                disabled={safePage >= totalPages}
                className={
                  safePage >= totalPages
                    ? "cursor-not-allowed rounded-md border border-slate-800 bg-slate-900/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600"
                    : "rounded-md border border-slate-700 bg-slate-900 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-300 hover:border-slate-600"
                }
              >
                Next
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      <TradeDetailDrawer trade={selectedTrade} />
    </div>
  );
}
