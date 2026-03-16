"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type MonthlyMetricView, monthlyMetricValue } from "@/lib/metrics";
import { type MonthlyPerformance } from "@/lib/types";
import { cn, formatCurrency, formatPct } from "@/lib/utils";
import { useDashboardStore } from "@/store/dashboard-store";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function displayValue(row: MonthlyPerformance, metric: MonthlyMetricView): string {
  if (metric === "RR") return `${row.rr.toFixed(2)} R:R`;
  if (metric === "NET") return formatPct(row.netPercent);
  if (metric === "PROFIT") return formatCurrency(row.profit);
  return formatPct(row.strikeRate);
}

function metricTone(row: MonthlyPerformance, metric: MonthlyMetricView): "pos" | "neg" | "flat" {
  const value = monthlyMetricValue(row, metric);
  if (metric === "STRIKE") {
    if (value >= 0.6) return "pos";
    if (value <= 0.45) return "neg";
    return "flat";
  }
  if (value > 0) return "pos";
  if (value < 0) return "neg";
  return "flat";
}

export function MonthlyStatsGrid({ data }: { data: MonthlyPerformance[] }) {
  const monthlyMetricView = useDashboardStore((s) => s.monthlyMetricView);
  const setMonthlyMetricView = useDashboardStore((s) => s.setMonthlyMetricView);

  const years = Array.from(new Set(data.map((d) => d.year))).sort();

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">Monthly Stats</CardTitle>
        <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/80 p-1 text-xs">
          {(["RR", "NET", "PROFIT", "STRIKE"] as MonthlyMetricView[]).map((metric) => (
            <button
              key={metric}
              onClick={() => setMonthlyMetricView(metric)}
              className={cn(
                "rounded-md px-2 py-1 transition-all",
                monthlyMetricView === metric ? "bg-sky-500/20 text-sky-300" : "text-slate-400 hover:text-slate-200",
              )}
            >
              {metric === "NET" ? "Net %" : metric === "STRIKE" ? "Strike Rate" : metric}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="min-w-[1120px] w-full border-separate border-spacing-y-1 text-xs">
          <thead>
            <tr className="text-slate-400">
              <th className="px-2 py-2 text-left">Year</th>
              {months.map((month) => (
                <th key={month} className="px-2 py-2 text-left">
                  {month}
                </th>
              ))}
              <th className="px-2 py-2 text-left">Total</th>
            </tr>
          </thead>
          <tbody>
            {years.map((year) => {
              const rowData = data.filter((m) => m.year === year);
              const totalVal = rowData.reduce((sum, row) => sum + monthlyMetricValue(row, monthlyMetricView), 0);
              const totalTrades = rowData.reduce((sum, row) => sum + row.trades, 0);

              return (
                <tr key={year}>
                  <td className="rounded-l-md border border-slate-800 bg-slate-900/45 px-2 py-2 font-semibold text-slate-200">{year}</td>
                  {months.map((_, idx) => {
                    const month = idx + 1;
                    const item = rowData.find((r) => r.month === month);
                    if (!item) {
                      return <td key={`${year}-${month}`} className="border border-slate-800 bg-slate-950/50 px-2 py-2 text-slate-600">-</td>;
                    }
                    const tone = metricTone(item, monthlyMetricView);
                    return (
                      <td
                        key={`${year}-${month}`}
                        className={cn(
                          "border border-slate-800 px-2 py-2",
                          tone === "pos" && "bg-emerald-500/8 text-emerald-300",
                          tone === "neg" && "bg-red-500/8 text-red-300",
                          tone === "flat" && "bg-amber-500/8 text-amber-300",
                        )}
                      >
                        <div className="font-medium">{displayValue(item, monthlyMetricView)}</div>
                        <div className="text-[10px] text-slate-500">{item.trades} trades</div>
                      </td>
                    );
                  })}
                  <td className="rounded-r-md border border-slate-700 bg-slate-900/70 px-2 py-2">
                    <div className="font-semibold text-slate-100">
                      {monthlyMetricView === "PROFIT"
                        ? formatCurrency(totalVal)
                        : monthlyMetricView === "STRIKE"
                          ? formatPct(totalTrades ? totalVal / 12 : 0)
                          : monthlyMetricView === "NET"
                            ? formatPct(totalVal)
                            : `${totalVal.toFixed(2)} R:R`}
                    </div>
                    <div className="text-[10px] text-slate-500">{totalTrades} trades</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
