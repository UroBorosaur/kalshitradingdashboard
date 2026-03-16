"use client";

import { useMemo } from "react";

import { BayesianBeliefCard } from "@/components/dashboard/bayesian-belief-card";
import { ExploitabilityMatrix } from "@/components/dashboard/exploitability-matrix";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import { formatCurrency } from "@/lib/utils";

export function SetupsPage() {
  const { filteredTrades, coreMetrics, gameTheory } = useDashboardData();

  const setupRows = useMemo(() => {
    const keys = ["BREAKOUT", "PULLBACK", "MEAN_REVERSION", "MOMENTUM_CONTINUATION", "NEWS_FADE"] as const;
    return keys.map((key) => {
      const set = filteredTrades.filter((t) => t.setup === key && t.status === "CLOSED");
      const n = set.length;
      const winRate = n ? set.filter((t) => t.pnl > 0).length / n : 0;
      const avgRR = n ? set.reduce((sum, t) => sum + t.rr, 0) / n : 0;
      const avgPnl = n ? set.reduce((sum, t) => sum + t.pnl, 0) / n : 0;
      const slippage = n ? set.reduce((sum, t) => sum + t.slippage, 0) / n : 0;
      const decay = n > 12 ? set.slice(-6).reduce((s, t) => s + t.rr, 0) / 6 - set.slice(0, 6).reduce((s, t) => s + t.rr, 0) / 6 : 0;
      return { key, n, winRate, avgRR, avgPnl, slippage, decay };
    });
  }, [filteredTrades]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Setup Performance & Edge Stability</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-2 text-left">Setup</th>
                  <th className="py-2 text-right">Trades</th>
                  <th className="py-2 text-right">Win Rate</th>
                  <th className="py-2 text-right">Avg RR</th>
                  <th className="py-2 text-right">Avg PnL</th>
                  <th className="py-2 text-right">Slippage</th>
                  <th className="py-2 text-right">Edge Decay</th>
                </tr>
              </thead>
              <tbody>
                {setupRows.map((row) => (
                  <tr key={row.key} className="border-t border-slate-800">
                    <td className="py-2 text-slate-200">{row.key.replaceAll("_", " ")}</td>
                    <td className="py-2 text-right text-slate-400">{row.n}</td>
                    <td className="py-2 text-right text-slate-300">{(row.winRate * 100).toFixed(1)}%</td>
                    <td className={row.avgRR >= 0 ? "py-2 text-right text-emerald-300" : "py-2 text-right text-red-300"}>{row.avgRR.toFixed(2)}</td>
                    <td className={row.avgPnl >= 0 ? "py-2 text-right text-emerald-300" : "py-2 text-right text-red-300"}>{formatCurrency(row.avgPnl)}</td>
                    <td className="py-2 text-right text-slate-300">{row.slippage.toFixed(2)}</td>
                    <td className={row.decay >= 0 ? "py-2 text-right text-emerald-300" : "py-2 text-right text-red-300"}>{row.decay.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Setup-specific Expectancy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {Object.entries(coreMetrics.setupExpectancy).map(([setup, val]) => (
              <div key={setup} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/45 px-3 py-2">
                <span className="text-slate-400">{setup.replaceAll("_", " ")}</span>
                <span className={val >= 0 ? "font-semibold text-emerald-300" : "font-semibold text-red-300"}>{formatCurrency(val)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <BayesianBeliefCard beliefs={gameTheory.beliefs} />
        <ExploitabilityMatrix recommendations={gameTheory.setupRecommendations} />
      </div>
    </div>
  );
}
