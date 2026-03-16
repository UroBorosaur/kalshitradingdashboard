"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDashboardData } from "@/hooks/use-dashboard-data";

export function RegimeAnalysisPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(id);
  }, []);

  const { filteredTrades, gameTheory } = useDashboardData();

  const regimeStats = useMemo(() => {
    const grouped = new Map<string, { trades: number; pnl: number; avgRR: number; rrSum: number }>();
    for (const t of filteredTrades.filter((x) => x.status === "CLOSED")) {
      const key = t.marketRegime;
      const row = grouped.get(key) ?? { trades: 0, pnl: 0, avgRR: 0, rrSum: 0 };
      row.trades += 1;
      row.pnl += t.pnl;
      row.rrSum += t.rr;
      grouped.set(key, row);
    }

    return [...grouped.entries()].map(([regime, row]) => ({
      regime,
      trades: row.trades,
      pnl: Number(row.pnl.toFixed(2)),
      avgRR: Number((row.rrSum / Math.max(1, row.trades)).toFixed(2)),
    }));
  }, [filteredTrades]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Regime PnL Attribution</CardTitle>
          </CardHeader>
          <CardContent className="h-[330px]">
            {mounted ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={regimeStats}>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="regime"
                    tick={{ fill: "#64748b", fontSize: 10 }}
                    axisLine={{ stroke: "#1e293b" }}
                    tickFormatter={(v) => v.replaceAll("_", " ")}
                  />
                  <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={{ stroke: "#1e293b" }} />
                  <Tooltip
                    contentStyle={{ background: "#020817", border: "1px solid #1e293b", borderRadius: "8px", color: "#e2e8f0" }}
                  />
                  <Bar dataKey="pnl" fill="#38bdf8" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full animate-pulse rounded-lg bg-slate-900/60" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Current Opponent Model</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-lg border border-slate-800 bg-slate-900/45 p-3">
              <p className="text-xs text-slate-500">Inferred Regime</p>
              <p className="font-semibold text-sky-300">{gameTheory.regimeDetection.regime.replaceAll("_", " ")}</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/45 p-3">
              <p className="text-xs text-slate-500">Confidence</p>
              <p className="font-semibold text-emerald-300">{(gameTheory.regimeDetection.confidence * 100).toFixed(1)}%</p>
            </div>
            <p className="text-xs text-slate-400">{gameTheory.regimeDetection.rationale}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Regime Transition Damage & Strategic Drift</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-slate-800 bg-slate-900/45 p-3">
            <p className="text-xs text-slate-500">Damaging transitions</p>
            <p className="mt-1 text-slate-300">{gameTheory.metaAnalytics.damagingTransitions.join(" | ")}</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/45 p-3">
            <p className="text-xs text-slate-500">Drift months</p>
            <p className="mt-1 text-slate-300">{gameTheory.metaAnalytics.strategicDriftMonths.join(", ")}</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/45 p-3">
            <p className="text-xs text-slate-500">Setups failing when overused</p>
            <p className="mt-1 text-slate-300">{gameTheory.metaAnalytics.failsWhenOverused.join(", ")}</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/45 p-3">
            <p className="text-xs text-slate-500">Too predictable setups</p>
            <p className="mt-1 text-slate-300">{gameTheory.metaAnalytics.tooPredictable.join(", ")}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
