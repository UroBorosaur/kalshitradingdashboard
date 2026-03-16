"use client";

import { useState } from "react";
import { Loader2, RefreshCw, Send, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LiveBrokerSnapshot } from "@/lib/live/types";

interface LiveBrokerPanelProps {
  dataMode: "MOCK" | "LIVE";
  usingLiveData: boolean;
  status: LiveBrokerSnapshot;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onPlaceOrder: (input: {
    symbol: string;
    qty: number;
    side: "buy" | "sell";
    type?: "market" | "limit";
    timeInForce?: "day" | "gtc";
    limitPrice?: number;
  }) => Promise<unknown>;
  onClosePosition: (symbol: string) => Promise<unknown>;
}

export function LiveBrokerPanel({
  dataMode,
  usingLiveData,
  status,
  loading,
  onRefresh,
  onPlaceOrder,
  onClosePosition,
}: LiveBrokerPanelProps) {
  const [symbol, setSymbol] = useState("AAPL");
  const [qty, setQty] = useState(1);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [limitPrice, setLimitPrice] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const connected = usingLiveData && status.connected;

  async function submitOrder() {
    setSubmitting(true);
    setMessage(null);
    try {
      await onPlaceOrder({
        symbol: symbol.trim().toUpperCase(),
        qty,
        side,
        type: limitPrice ? "limit" : "market",
        timeInForce: "day",
        limitPrice: limitPrice ? Number(limitPrice) : undefined,
      });
      setMessage("Paper order submitted.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function closeFirstPosition() {
    if (!status.positions.length) return;
    setSubmitting(true);
    setMessage(null);
    try {
      await onClosePosition(status.positions[0].symbol);
      setMessage(`Closed ${status.positions[0].symbol} position.`);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Live Broker Connection</span>
          <Badge variant={connected ? "positive" : dataMode === "LIVE" ? "warning" : "default"}>
            {connected ? "Connected" : dataMode === "LIVE" ? "Not Connected" : "Mock Mode"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="flex items-center justify-between text-slate-400">
          <span>Provider</span>
          <span className="text-slate-200">{status.provider}</span>
        </div>
        <div className="flex items-center justify-between text-slate-400">
          <span>Last Sync</span>
          <span className="text-slate-200">{status.lastSync ? new Date(status.lastSync).toLocaleTimeString() : "-"}</span>
        </div>

        <Button variant="secondary" className="w-full" onClick={() => void onRefresh()} disabled={loading || dataMode !== "LIVE"}>
          {loading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
          Refresh Live Data
        </Button>

        <div className="grid grid-cols-3 gap-2">
          <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Symbol" />
          <Input
            type="number"
            value={qty}
            min={1}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value || 1)))}
            placeholder="Qty"
          />
          <Select value={side} onValueChange={(value) => setSide(value as "buy" | "sell")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="buy">BUY</SelectItem>
              <SelectItem value="sell">SELL</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Input value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} placeholder="Optional limit price" />

        <div className="grid grid-cols-2 gap-2">
          <Button className="w-full" onClick={() => void submitOrder()} disabled={!connected || submitting}>
            <Send className="mr-1 h-3.5 w-3.5" />
            Send Paper Order
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => void closeFirstPosition()} disabled={!connected || submitting || !status.positions.length}>
            <XCircle className="mr-1 h-3.5 w-3.5" />
            Close 1st Position
          </Button>
        </div>

        {status.error ? <p className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-red-300">{status.error}</p> : null}
        {message ? <p className="rounded-md border border-slate-700 bg-slate-900/70 p-2 text-slate-300">{message}</p> : null}
      </CardContent>
    </Card>
  );
}
