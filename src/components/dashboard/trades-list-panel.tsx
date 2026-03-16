"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type Trade } from "@/lib/types";
import { cn, formatCurrency, formatPct, formatPrice, formatQuantity } from "@/lib/utils";
import { useDashboardStore } from "@/store/dashboard-store";

interface TradesListPanelProps {
  openTrades: Trade[];
  closedTrades: Trade[];
}

type TradeSourceFilter = "ALL" | "ALPACA" | "KALSHI";
const OPEN_PAGE_SIZE = 12;
const CLOSED_PAGE_SIZE = 12;

function directionVariant(direction: Trade["direction"]) {
  return direction === "LONG" ? "positive" : "negative";
}

function inferSource(trade: Trade): TradeSourceFilter {
  if (trade.tags.includes("kalshi-demo")) return "KALSHI";
  if (trade.tags.includes("alpaca-paper")) return "ALPACA";
  return "ALL";
}

function TradeRow({ trade }: { trade: Trade }) {
  const setSelectedTradeId = useDashboardStore((s) => s.setSelectedTradeId);
  const source = inferSource(trade);

  return (
    <motion.button
      layout
      onClick={() => setSelectedTradeId(trade.id)}
      className="w-full rounded-lg border border-transparent p-3 text-left transition-all hover:border-slate-700 hover:bg-slate-900/60"
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-base font-semibold text-slate-100">{trade.symbol}</p>
        <div className="flex items-center gap-2">
          <Badge variant="default">{source === "KALSHI" ? "Kalshi" : source === "ALPACA" ? "Alpaca" : "Other"}</Badge>
          <Badge variant={directionVariant(trade.direction)}>{trade.direction}</Badge>
        </div>
      </div>
      <p className="text-xs text-slate-400">{trade.setup.replaceAll("_", " ")}</p>
      <p className="mt-1 text-[11px] text-slate-500">
        {trade.entryDate} {trade.exitDate ? `-> ${trade.exitDate}` : "(open)"}
      </p>

      <div className="mt-2 grid grid-cols-5 gap-2 text-xs">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Qty</p>
          <p className="font-semibold text-slate-200">{formatQuantity(trade.quantity)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Price</p>
          <p className="font-semibold text-slate-200">{formatPrice(trade.price)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">R:R</p>
          <p className={cn("font-semibold", trade.rr >= 0 ? "text-emerald-300" : "text-red-300")}>{trade.rr.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">%</p>
          <p className={cn("font-semibold", trade.pnlPercent >= 0 ? "text-emerald-300" : "text-red-300")}>{formatPct(trade.pnlPercent)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">PnL</p>
          <p className={cn("font-semibold", trade.pnl >= 0 ? "text-emerald-300" : "text-red-300")}>{formatCurrency(trade.pnl)}</p>
        </div>
      </div>
    </motion.button>
  );
}

export function TradesListPanel({ openTrades, closedTrades }: TradesListPanelProps) {
  const tradesTab = useDashboardStore((s) => s.tradesTab);
  const setTradesTab = useDashboardStore((s) => s.setTradesTab);
  const [sourceFilter, setSourceFilter] = useState<TradeSourceFilter>("ALL");
  const [openPage, setOpenPage] = useState(1);
  const [closedPage, setClosedPage] = useState(1);

  const filteredOpen = useMemo(
    () =>
      sourceFilter === "ALL"
        ? openTrades
        : openTrades.filter((trade) => inferSource(trade) === sourceFilter),
    [openTrades, sourceFilter],
  );

  const filteredClosed = useMemo(
    () =>
      sourceFilter === "ALL"
        ? closedTrades
        : closedTrades.filter((trade) => inferSource(trade) === sourceFilter),
    [closedTrades, sourceFilter],
  );
  const orderedClosed = useMemo(() => filteredClosed.slice().reverse(), [filteredClosed]);

  const openTotalPages = Math.max(1, Math.ceil(filteredOpen.length / OPEN_PAGE_SIZE));
  const closedTotalPages = Math.max(1, Math.ceil(orderedClosed.length / CLOSED_PAGE_SIZE));
  const safeOpenPage = Math.min(openPage, openTotalPages);
  const safeClosedPage = Math.min(closedPage, closedTotalPages);

  const pagedOpen = useMemo(() => {
    const start = (safeOpenPage - 1) * OPEN_PAGE_SIZE;
    return filteredOpen.slice(start, start + OPEN_PAGE_SIZE);
  }, [filteredOpen, safeOpenPage]);

  const pagedClosed = useMemo(() => {
    const start = (safeClosedPage - 1) * CLOSED_PAGE_SIZE;
    return orderedClosed.slice(start, start + CLOSED_PAGE_SIZE);
  }, [orderedClosed, safeClosedPage]);

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Trades</CardTitle>
      </CardHeader>
      <CardContent className="h-[660px] overflow-hidden">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Source</span>
          {(["ALL", "ALPACA", "KALSHI"] as TradeSourceFilter[]).map((source) => (
            <button
              key={source}
              onClick={() => {
                setSourceFilter(source);
                setOpenPage(1);
                setClosedPage(1);
              }}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                sourceFilter === source
                  ? "border-sky-500/50 bg-sky-500/15 text-sky-200"
                  : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600 hover:text-slate-200",
              )}
            >
              {source}
            </button>
          ))}
        </div>

        <Tabs value={tradesTab} onValueChange={(value) => setTradesTab(value as "OPEN" | "CLOSED")} className="h-full">
          <TabsList>
            <TabsTrigger value="OPEN">Open</TabsTrigger>
            <TabsTrigger value="CLOSED">Closed</TabsTrigger>
          </TabsList>

          <TabsContent value="OPEN" className="mt-2 h-[600px] pr-1">
            {filteredOpen.length === 0 ? (
              <p className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">No open trades.</p>
            ) : (
              <div className="flex h-full flex-col">
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                  {pagedOpen.map((trade) => (
                    <TradeRow key={trade.id} trade={trade} />
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-slate-800 pt-2 text-[11px] text-slate-400">
                  <span>
                    {filteredOpen.length} open trades • page {safeOpenPage} of {openTotalPages}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setOpenPage(Math.max(1, safeOpenPage - 1))}
                      disabled={safeOpenPage <= 1}
                      className={cn(
                        "rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide",
                        safeOpenPage <= 1
                          ? "cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600"
                          : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600",
                      )}
                    >
                      Prev
                    </button>
                    <button
                      onClick={() => setOpenPage(Math.min(openTotalPages, safeOpenPage + 1))}
                      disabled={safeOpenPage >= openTotalPages}
                      className={cn(
                        "rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide",
                        safeOpenPage >= openTotalPages
                          ? "cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600"
                          : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600",
                      )}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="CLOSED" className="mt-2 h-[600px] pr-1">
            {filteredClosed.length === 0 ? (
              <p className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">No closed trades.</p>
            ) : (
              <div className="flex h-full flex-col">
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                  {pagedClosed.map((trade) => (
                    <TradeRow key={trade.id} trade={trade} />
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-slate-800 pt-2 text-[11px] text-slate-400">
                  <span>
                    {orderedClosed.length} closed trades • page {safeClosedPage} of {closedTotalPages}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setClosedPage(Math.max(1, safeClosedPage - 1))}
                      disabled={safeClosedPage <= 1}
                      className={cn(
                        "rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide",
                        safeClosedPage <= 1
                          ? "cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600"
                          : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600",
                      )}
                    >
                      Prev
                    </button>
                    <button
                      onClick={() => setClosedPage(Math.min(closedTotalPages, safeClosedPage + 1))}
                      disabled={safeClosedPage >= closedTotalPages}
                      className={cn(
                        "rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide",
                        safeClosedPage >= closedTotalPages
                          ? "cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600"
                          : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600",
                      )}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
