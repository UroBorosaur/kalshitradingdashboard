"use client";

import { useEffect, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type RewardRiskBucket, type TimeRange } from "@/lib/metrics";
import { cn } from "@/lib/utils";

const ranges: TimeRange[] = ["H", "D", "W", "M", "3M", "Y"];

interface RewardRiskChartProps {
  data: RewardRiskBucket[];
  range: TimeRange;
  onRangeChange: (range: TimeRange) => void;
}

export function RewardRiskChart({ data, range, onRangeChange }: RewardRiskChartProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">Reward:Risk</CardTitle>
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
            <ComposedChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={{ stroke: "#1e293b" }} tickLine={false} />
              <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={{ stroke: "#1e293b" }} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: "#020817",
                  border: "1px solid #1e293b",
                  borderRadius: "8px",
                  color: "#e2e8f0",
                }}
                formatter={(value, name) => {
                  const numeric = typeof value === "number" ? value : Number(value ?? 0);
                  return [numeric.toFixed(2), String(name)];
                }}
              />
              <Bar dataKey="rr" fill="#38bdf8" radius={[6, 6, 0, 0]} barSize={20} />
              <Line type="monotone" dataKey="cumulativeRR" stroke="#22c55e" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full animate-pulse rounded-lg bg-slate-900/60" />
        )}
      </CardContent>
    </Card>
  );
}
