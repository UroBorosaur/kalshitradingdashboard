"use client";

import { useMemo, useState } from "react";

import { FilterBar } from "@/components/dashboard/filter-bar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import type { Trade } from "@/lib/types";
import { formatCurrency, formatPct, formatPrice, formatQuantity } from "@/lib/utils";

type SourceFilter = "ALL" | "ALPACA" | "KALSHI";

interface PositionRow {
  key: string;
  symbol: string;
  source: SourceFilter;
  direction: Trade["direction"];
  status: Trade["status"];
  openQuantity: number;
  averageEntryPrice: number;
  markPrice: number;
  costBasis: number;
  marketValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalPnl: number;
  totalPnlPercent: number;
  openTrades: number;
  closedTrades: number;
}

interface PositionAccumulator {
  key: string;
  symbol: string;
  source: SourceFilter;
  direction: Trade["direction"];
  openQuantity: number;
  closedQuantity: number;
  costBasis: number;
  marketValue: number;
  markValueWeighted: number;
  closedCostBasis: number;
  closedMarketValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalPnl: number;
  openTrades: number;
  closedTrades: number;
}

function inferSource(tags: string[]): SourceFilter {
  if (tags.includes("kalshi-demo")) return "KALSHI";
  if (tags.includes("alpaca-paper")) return "ALPACA";
  return "ALL";
}

function markFromTrade(trade: Trade) {
  if (trade.quantity <= 0) return trade.price;
  return trade.price + trade.pnl / trade.quantity;
}

export function PositionsPage() {
  const { filteredTrades, symbols, setups, regimes } = useDashboardData();
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("ALL");
  const [showClosed, setShowClosed] = useState(false);

  const rows = useMemo<PositionRow[]>(() => {
    const grouped = new Map<string, PositionAccumulator>();

    for (const trade of filteredTrades) {
      const source = inferSource(trade.tags);
      if (sourceFilter !== "ALL" && source !== sourceFilter) continue;
      if (trade.status === "MISSED") continue;

      const key = `${trade.symbol}::${trade.direction}::${source}`;
      const row = grouped.get(key) ?? {
        key,
        symbol: trade.symbol,
        source,
        direction: trade.direction,
        openQuantity: 0,
        closedQuantity: 0,
        costBasis: 0,
        marketValue: 0,
        markValueWeighted: 0,
        closedCostBasis: 0,
        closedMarketValue: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
        totalPnl: 0,
        openTrades: 0,
        closedTrades: 0,
      };

      if (trade.status === "OPEN") {
        const qty = Math.max(0, trade.quantity);
        const mark = markFromTrade(trade);
        row.openQuantity += qty;
        row.costBasis += qty * trade.price;
        row.markValueWeighted += qty * mark;
        row.marketValue += qty * mark;
        row.unrealizedPnl += trade.pnl;
        row.openTrades += 1;
      } else {
        const qty = Math.max(0, trade.quantity);
        const closedCostBasis = qty * trade.price;
        row.realizedPnl += trade.pnl;
        row.closedQuantity += qty;
        row.closedCostBasis += closedCostBasis;
        row.closedMarketValue += closedCostBasis + trade.pnl;
        row.closedTrades += 1;
      }

      grouped.set(key, row);
    }

    return [...grouped.values()]
      .map((row) => {
        const qtyForPricing = row.openQuantity > 0 ? row.openQuantity : row.closedQuantity;
        const averageEntryPrice = row.openQuantity > 0
          ? row.costBasis / row.openQuantity
          : row.closedQuantity > 0
            ? row.closedCostBasis / row.closedQuantity
            : 0;
        const markPrice = row.openQuantity > 0
          ? row.markValueWeighted / row.openQuantity
          : row.closedQuantity > 0
            ? row.closedMarketValue / row.closedQuantity
            : averageEntryPrice;
        const displayCostBasis = row.openQuantity > 0 ? row.costBasis : row.closedCostBasis;
        const displayMarketValue = row.openQuantity > 0 ? row.marketValue : row.closedMarketValue;
        const totalPnl = row.realizedPnl + row.unrealizedPnl;
        const pnlDenominator = row.costBasis + row.closedCostBasis;
        const totalPnlPercent = pnlDenominator > 0 ? totalPnl / pnlDenominator : 0;

        return {
          key: row.key,
          symbol: row.symbol,
          source: row.source,
          direction: row.direction,
          status: (row.openQuantity > 0 ? "OPEN" : "CLOSED") as Trade["status"],
          openQuantity: qtyForPricing,
          averageEntryPrice,
          markPrice,
          costBasis: displayCostBasis,
          marketValue: displayMarketValue,
          unrealizedPnl: row.unrealizedPnl,
          realizedPnl: row.realizedPnl,
          totalPnl,
          totalPnlPercent,
          openTrades: row.openTrades,
          closedTrades: row.closedTrades,
        };
      })
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "OPEN" ? -1 : 1;
        return Math.abs(b.totalPnl) - Math.abs(a.totalPnl);
      });
  }, [filteredTrades, sourceFilter]);

  const summary = useMemo(() => {
    const scoped = showClosed ? rows : rows.filter((row) => row.status === "OPEN");
    const open = scoped.filter((row) => row.status === "OPEN");
    return {
      openPositions: open.length,
      grossExposure: open.reduce((sum, row) => sum + row.costBasis, 0),
      unrealized: open.reduce((sum, row) => sum + row.unrealizedPnl, 0),
      realized: scoped.reduce((sum, row) => sum + row.realizedPnl, 0),
      total: scoped.reduce((sum, row) => sum + row.totalPnl, 0),
    };
  }, [rows, showClosed]);

  const visibleRows = useMemo(
    () => (showClosed ? rows : rows.filter((row) => row.status === "OPEN")),
    [rows, showClosed],
  );

  return (
    <div className="space-y-4">
      <FilterBar symbols={symbols} setups={setups} regimes={regimes} />

      <div className="grid gap-3 md:grid-cols-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-xs text-slate-400">Open Positions</CardTitle>
          </CardHeader>
          <CardContent className="text-lg font-semibold text-sky-300">{summary.openPositions}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs text-slate-400">Gross Exposure</CardTitle>
          </CardHeader>
          <CardContent className="text-lg font-semibold text-slate-100">{formatCurrency(summary.grossExposure)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs text-slate-400">Unrealized PnL</CardTitle>
          </CardHeader>
          <CardContent className={summary.unrealized >= 0 ? "text-lg font-semibold text-emerald-300" : "text-lg font-semibold text-red-300"}>
            {formatCurrency(summary.unrealized)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs text-slate-400">Realized PnL</CardTitle>
          </CardHeader>
          <CardContent className={summary.realized >= 0 ? "text-lg font-semibold text-emerald-300" : "text-lg font-semibold text-red-300"}>
            {formatCurrency(summary.realized)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs text-slate-400">Total PnL</CardTitle>
          </CardHeader>
          <CardContent className={summary.total >= 0 ? "text-lg font-semibold text-emerald-300" : "text-lg font-semibold text-red-300"}>
            {formatCurrency(summary.total)}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Position Summary</CardTitle>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Source</span>
            {(["ALL", "ALPACA", "KALSHI"] as SourceFilter[]).map((source) => (
              <button
                key={source}
                onClick={() => setSourceFilter(source)}
                className={
                  sourceFilter === source
                    ? "rounded-full border border-sky-500/50 bg-sky-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-sky-200"
                    : "rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
                }
              >
                {source}
              </button>
            ))}

            <button
              onClick={() => setShowClosed((value) => !value)}
              className={
                showClosed
                  ? "rounded-full border border-amber-500/50 bg-amber-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-200"
                  : "rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
              }
            >
              {showClosed ? "Hide Closed" : "Show Closed"}
            </button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[1320px] text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="px-2 py-2 text-left">Position</th>
                <th className="px-2 py-2 text-left">Source</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2 text-right">Avg Entry</th>
                <th className="px-2 py-2 text-right">Mark</th>
                <th className="px-2 py-2 text-right">Cost Basis</th>
                <th className="px-2 py-2 text-right">Market Value</th>
                <th className="px-2 py-2 text-right">Unrealized $</th>
                <th className="px-2 py-2 text-right">Realized $</th>
                <th className="px-2 py-2 text-right">Total PnL $</th>
                <th className="px-2 py-2 text-right">Total PnL %</th>
                <th className="px-2 py-2 text-right">Open Trades</th>
                <th className="px-2 py-2 text-right">Closed Trades</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.key} className="border-t border-slate-800/80">
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-200">{row.symbol}</span>
                      <Badge variant={row.direction === "LONG" ? "positive" : "negative"}>{row.direction}</Badge>
                      <Badge variant={row.status === "OPEN" ? "info" : "default"}>{row.status}</Badge>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-slate-300">
                    {row.source === "KALSHI" ? "Kalshi" : row.source === "ALPACA" ? "Alpaca" : "Other"}
                  </td>
                  <td className="px-2 py-2 text-right text-slate-300">{formatQuantity(row.openQuantity)}</td>
                  <td className="px-2 py-2 text-right text-slate-300">{formatPrice(row.averageEntryPrice)}</td>
                  <td className="px-2 py-2 text-right text-slate-300">{formatPrice(row.markPrice)}</td>
                  <td className="px-2 py-2 text-right text-slate-300">{formatCurrency(row.costBasis)}</td>
                  <td className="px-2 py-2 text-right text-slate-300">{formatCurrency(row.marketValue)}</td>
                  <td className={row.unrealizedPnl >= 0 ? "px-2 py-2 text-right font-semibold text-emerald-300" : "px-2 py-2 text-right font-semibold text-red-300"}>
                    {formatCurrency(row.unrealizedPnl)}
                  </td>
                  <td className={row.realizedPnl >= 0 ? "px-2 py-2 text-right font-semibold text-emerald-300" : "px-2 py-2 text-right font-semibold text-red-300"}>
                    {formatCurrency(row.realizedPnl)}
                  </td>
                  <td className={row.totalPnl >= 0 ? "px-2 py-2 text-right font-semibold text-emerald-300" : "px-2 py-2 text-right font-semibold text-red-300"}>
                    {formatCurrency(row.totalPnl)}
                  </td>
                  <td className={row.totalPnlPercent >= 0 ? "px-2 py-2 text-right font-semibold text-emerald-300" : "px-2 py-2 text-right font-semibold text-red-300"}>
                    {formatPct(row.totalPnlPercent)}
                  </td>
                  <td className="px-2 py-2 text-right text-slate-300">{row.openTrades}</td>
                  <td className="px-2 py-2 text-right text-slate-300">{row.closedTrades}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {!visibleRows.length ? (
            <p className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
              No positions match the current filters.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
