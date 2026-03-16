"use client";

import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { type Trade } from "@/lib/types";
import { formatCurrency, formatPct, formatPrice, formatQuantity } from "@/lib/utils";
import { useDashboardStore } from "@/store/dashboard-store";

interface TradeDetailDrawerProps {
  trade: Trade | null;
}

function scoreTone(score: number): string {
  if (score >= 70) return "text-emerald-300";
  if (score <= 45) return "text-red-300";
  return "text-amber-300";
}

export function TradeDetailDrawer({ trade }: TradeDetailDrawerProps) {
  const setSelectedTradeId = useDashboardStore((s) => s.setSelectedTradeId);

  return (
    <Dialog open={Boolean(trade)} onOpenChange={(open) => !open && setSelectedTradeId(null)}>
      <DialogContent>
        {trade ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {trade.symbol}
                <Badge variant={trade.direction === "LONG" ? "positive" : "negative"}>{trade.direction}</Badge>
                <Badge variant="info">{trade.status}</Badge>
              </DialogTitle>
              <DialogDescription>{trade.setup.replaceAll("_", " ")}</DialogDescription>
            </DialogHeader>

            <div className="mt-5 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-800 bg-slate-900/55 p-3">
                  <p className="text-xs text-slate-500">PnL</p>
                  <p className={trade.pnl >= 0 ? "font-semibold text-emerald-300" : "font-semibold text-red-300"}>
                    {formatCurrency(trade.pnl)}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/55 p-3">
                  <p className="text-xs text-slate-500">R:R</p>
                  <p className={trade.rr >= 0 ? "font-semibold text-emerald-300" : "font-semibold text-red-300"}>{trade.rr.toFixed(2)}</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/55 p-3">
                  <p className="text-xs text-slate-500">Net %</p>
                  <p className={trade.pnlPercent >= 0 ? "font-semibold text-emerald-300" : "font-semibold text-red-300"}>
                    {formatPct(trade.pnlPercent)}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/55 p-3">
                  <p className="text-xs text-slate-500">Slippage</p>
                  <p className="font-semibold text-amber-300">{trade.slippage.toFixed(2)} ticks</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/55 p-3">
                  <p className="text-xs text-slate-500">Quantity</p>
                  <p className="font-semibold text-slate-200">{formatQuantity(trade.quantity)}</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/55 p-3">
                  <p className="text-xs text-slate-500">Price</p>
                  <p className="font-semibold text-slate-200">{formatPrice(trade.price)}</p>
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/45 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Execution Timeline</p>
                <p className="mt-1 text-slate-300">
                  {trade.entryDate} <ChevronRight className="mx-1 inline h-3.5 w-3.5" /> {trade.exitDate ?? "Open"}
                </p>
                <p className="mt-1 text-xs text-slate-400">Opponent profile: {trade.opponentProfile}</p>
              </div>

              <Separator />

              <div>
                <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Trade Quality Decomposition</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["Thesis", trade.quality.thesisQuality],
                    ["Timing", trade.quality.timingQuality],
                    ["Execution", trade.quality.executionQuality],
                    ["Regime Fit", trade.quality.regimeFit],
                    ["Sizing", trade.quality.sizingQuality],
                    ["Exit", trade.quality.exitQuality],
                  ].map(([label, score]) => (
                    <div key={label as string} className="rounded-lg border border-slate-800 bg-slate-900/55 p-2">
                      <p className="text-[11px] text-slate-500">{label as string}</p>
                      <p className={`text-sm font-semibold ${scoreTone(score as number)}`}>{score as number}/100</p>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              <div className="space-y-1 text-xs text-slate-300">
                <p>
                  <span className="text-slate-500">Confidence:</span> {Math.round(trade.confidenceScore * 100)}%
                </p>
                <p>
                  <span className="text-slate-500">Regime transition damage:</span> {(trade.regimeTransitionDamage * 100).toFixed(1)}%
                </p>
                <p>
                  <span className="text-slate-500">Overuse penalty:</span> {(trade.overusePenalty * 100).toFixed(1)}%
                </p>
                <p className="pt-1 text-slate-400">{trade.notes}</p>
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
