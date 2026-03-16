"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { LiveBrokerSnapshot } from "@/lib/live/types";

const initialSnapshot: LiveBrokerSnapshot = {
  connected: false,
  provider: "alpaca-paper",
  account: null,
  orders: [],
  positions: [],
  equityHistory: null,
  activities: [],
  kalshi: {
    connected: false,
    provider: "kalshi-demo",
    balanceUsd: null,
    cashUsd: null,
    portfolioUsd: null,
    orders: [],
    fills: [],
    positions: [],
    quotes: {},
    error: null,
  },
  lastSync: null,
  error: null,
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export function useLiveBrokerData(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<LiveBrokerSnapshot>(initialSnapshot);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;

    setLoading(true);
    try {
      const status = await getJson<{ connected: boolean; provider: string }>("/api/live/status");

      if (!status.connected) {
        setSnapshot({
          ...initialSnapshot,
          connected: false,
          provider: status.provider,
          error: "Live mode selected but Alpaca credentials are missing.",
        });
        return;
      }

      const [accountRes, ordersRes, positionsRes, equityRes, activitiesRes, kalshiRes] = await Promise.all([
        getJson<{ ok: boolean; account: LiveBrokerSnapshot["account"]; error?: string }>("/api/live/account"),
        getJson<{ ok: boolean; orders: LiveBrokerSnapshot["orders"]; error?: string }>("/api/live/orders?status=all&limit=500"),
        getJson<{ ok: boolean; positions: LiveBrokerSnapshot["positions"]; error?: string }>("/api/live/positions"),
        getJson<{ ok: boolean; history: LiveBrokerSnapshot["equityHistory"]; error?: string }>("/api/live/equity?period=1A&timeframe=1D"),
        getJson<{ ok: boolean; activities: LiveBrokerSnapshot["activities"]; error?: string }>("/api/live/activities?pageSize=100"),
        getJson<{
          ok: boolean;
          connected: boolean;
          provider: string;
          balanceUsd: number | null;
          cashUsd?: number | null;
          portfolioUsd?: number | null;
          orders: LiveBrokerSnapshot["kalshi"]["orders"];
          fills: LiveBrokerSnapshot["kalshi"]["fills"];
          positions?: LiveBrokerSnapshot["kalshi"]["positions"];
          quotes?: LiveBrokerSnapshot["kalshi"]["quotes"];
          error?: string | null;
        }>("/api/live/kalshi/summary"),
      ]);

      setSnapshot({
        connected: true,
        provider: status.provider,
        account: accountRes.ok ? accountRes.account : null,
        orders: ordersRes.ok ? ordersRes.orders : [],
        positions: positionsRes.ok ? positionsRes.positions : [],
        equityHistory: equityRes.ok ? equityRes.history : null,
        activities: activitiesRes.ok ? activitiesRes.activities : [],
        kalshi: {
          connected: Boolean(kalshiRes.connected),
          provider: kalshiRes.provider,
          balanceUsd: typeof kalshiRes.balanceUsd === "number" ? kalshiRes.balanceUsd : null,
          cashUsd: typeof kalshiRes.cashUsd === "number" ? kalshiRes.cashUsd : null,
          portfolioUsd: typeof kalshiRes.portfolioUsd === "number" ? kalshiRes.portfolioUsd : null,
          orders: kalshiRes.orders ?? [],
          fills: kalshiRes.fills ?? [],
          positions: kalshiRes.positions ?? [],
          quotes: kalshiRes.quotes ?? {},
          error: kalshiRes.error ?? null,
        },
        lastSync: new Date().toISOString(),
        error: [accountRes.error, ordersRes.error, positionsRes.error, equityRes.error, activitiesRes.error, kalshiRes.error]
          .filter(Boolean)
          .join(" | ") || null,
      });
    } catch (error) {
      setSnapshot((prev) => ({
        ...prev,
        connected: false,
        error: (error as Error).message,
      }));
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setSnapshot(initialSnapshot);
      return;
    }

    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, 30000);

    return () => window.clearInterval(id);
  }, [enabled, refresh]);

  const actions = useMemo(
    () => ({
      refresh,
      async placePaperOrder(input: {
        symbol: string;
        qty: number;
        side: "buy" | "sell";
        type?: "market" | "limit";
        timeInForce?: "day" | "gtc";
        limitPrice?: number;
      }) {
        const response = await fetch("/api/live/paper-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const json = await response.json();
        if (!response.ok || !json.ok) throw new Error(json.error ?? "Order failed");
        await refresh();
        return json.order;
      },
      async closePosition(symbol: string) {
        const response = await fetch("/api/live/close-position", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol }),
        });
        const json = await response.json();
        if (!response.ok || !json.ok) throw new Error(json.error ?? "Close failed");
        await refresh();
        return json.result;
      },
    }),
    [refresh],
  );

  return {
    snapshot,
    loading,
    ...actions,
  };
}
