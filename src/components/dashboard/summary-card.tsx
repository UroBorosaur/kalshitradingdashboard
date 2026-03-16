import { motion } from "framer-motion";

import { CircularTradeCounters } from "@/components/dashboard/circular-trade-counters";
import { WinRateGauge } from "@/components/dashboard/win-rate-gauge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { KpiCardMetrics } from "@/lib/types";
import { cn, formatCurrency, formatPct } from "@/lib/utils";

interface SummaryCardProps {
  metric: KpiCardMetrics;
}

export function SummaryCard({ metric }: SummaryCardProps) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24 }}>
      <Card className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-slate-200">{metric.label}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">R:R</p>
              <p className={cn("text-lg font-semibold", metric.rr >= 0 ? "text-emerald-300" : "text-red-300")}>{metric.rr.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Return</p>
              <p className={cn("text-lg font-semibold", metric.returnPct >= 0 ? "text-emerald-300" : "text-red-300")}>
                {formatPct(metric.returnPct, 2)}
              </p>
            </div>
            <div className="col-span-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">PnL</p>
              <p className={cn("text-lg font-semibold", metric.pnl >= 0 ? "text-emerald-300" : "text-red-300")}>
                {formatCurrency(metric.pnl)}
              </p>
            </div>
          </div>
          <div className="flex items-end justify-between gap-2 pt-1">
            <WinRateGauge value={metric.winRate} />
            <CircularTradeCounters wins={metric.wins} breakeven={metric.breakeven} losses={metric.losses} />
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
