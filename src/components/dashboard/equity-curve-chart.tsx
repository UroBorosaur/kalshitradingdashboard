"use client";

import { useEffect, useState } from "react";
import { Area, AreaChart, Brush, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type EquitySnapshot } from "@/lib/types";
import { type TimeRange } from "@/lib/metrics";
import { cn, formatCurrency } from "@/lib/utils";

const ranges: TimeRange[] = ["H", "D", "W", "M", "3M", "Y"];

interface EquityCurveChartProps {
  data: EquitySnapshot[];
  range: TimeRange;
  onRangeChange: (range: TimeRange) => void;
}

export function EquityCurveChart({ data, range, onRangeChange }: EquityCurveChartProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(id);
  }, []);

  const chartData = data.map((row) => ({
    date: row.date.slice(5),
    fullDate: row.date,
    balance: row.balance,
    drawdown: row.drawdown,
  }));

  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">Account Balance</CardTitle>
        <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/80 p-1">
          {ranges.map((item) => (
            <button
              key={item}
              onClick={() => onRangeChange(item)}
              className={cn(
                "rounded-md px-2 py-1 text-[10px] font-medium transition-all",
                item === range ? "bg-sky-500/20 text-sky-300" : "text-slate-400 hover:text-slate-200",
              )}
            >
              {item}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="h-[340px]">
        {mounted ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.45} />
                  <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={{ stroke: "#1e293b" }} tickLine={false} />
              <YAxis
                tick={{ fill: "#64748b", fontSize: 11 }}
                axisLine={{ stroke: "#1e293b" }}
                tickLine={false}
                tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`}
              />
              <Tooltip
                contentStyle={{
                  background: "#020817",
                  border: "1px solid #1e293b",
                  borderRadius: "8px",
                  color: "#e2e8f0",
                }}
                formatter={(value, name) => {
                  const numeric = typeof value === "number" ? value : Number(value ?? 0);
                  return [name === "balance" ? formatCurrency(numeric) : `${(numeric * 100).toFixed(2)}%`, String(name)];
                }}
                labelFormatter={(label) => `Date: ${label}`}
              />
              <Area type="monotone" dataKey="balance" stroke="#38bdf8" strokeWidth={2.4} fill="url(#equityFill)" />
              <Brush dataKey="date" height={20} stroke="#334155" travellerWidth={8} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full animate-pulse rounded-lg bg-slate-900/60" />
        )}
      </CardContent>
    </Card>
  );
}
