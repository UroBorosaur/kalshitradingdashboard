import "server-only";

function normalizeAlpacaTradingBase(raw: string | undefined): string {
  const base = (raw ?? "https://paper-api.alpaca.markets").replace(/\/+$/, "");
  return base.endsWith("/v2") ? base.slice(0, -3) : base;
}

const TRADING_BASE = normalizeAlpacaTradingBase(process.env.ALPACA_BASE_URL);
const DATA_BASE = (process.env.ALPACA_DATA_BASE_URL ?? "https://data.alpaca.markets").replace(/\/+$/, "");

const KEY = process.env.ALPACA_API_KEY ?? "";
const SECRET = process.env.ALPACA_API_SECRET ?? "";

export interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  currency: string;
  buying_power: string;
  equity: string;
  last_equity: string;
  cash: string;
  multiplier: string;
  daytrade_count: number;
}

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  created_at: string;
  submitted_at: string;
  filled_at: string | null;
  expired_at: string | null;
  canceled_at: string | null;
  failed_at: string | null;
  replaced_at: string | null;
  replaced_by: string | null;
  replaces: string | null;
  asset_id: string;
  symbol: string;
  asset_class: string;
  notional: string | null;
  qty: string;
  filled_qty: string;
  filled_avg_price: string | null;
  order_class: string;
  order_type: string;
  type: string;
  side: "buy" | "sell";
  time_in_force: string;
  limit_price: string | null;
  stop_price: string | null;
  status: string;
}

export interface AlpacaPosition {
  asset_id: string;
  symbol: string;
  exchange: string;
  asset_class: string;
  avg_entry_price: string;
  qty: string;
  side: "long" | "short";
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
}

export interface AlpacaPortfolioHistory {
  timestamp: number[];
  equity: number[];
  profit_loss: number[];
  profit_loss_pct: number[];
  base_value: number;
  timeframe: string;
}

export interface AlpacaActivityFill {
  id: string;
  activity_type: string;
  transaction_time: string;
  type: string;
  price: string;
  qty: string;
  side: "buy" | "sell";
  symbol: string;
  leaves_qty: string;
  order_id: string;
  cum_qty: string;
}

export interface AlpacaOptionSnapshot {
  latestQuote?: {
    ap?: number;
    as?: number;
    bp?: number;
    bs?: number;
    c?: string[];
    t?: string;
  };
  latestTrade?: {
    p?: number;
    s?: number;
    t?: string;
  };
  minuteBar?: {
    c?: number;
    h?: number;
    l?: number;
    n?: number;
    o?: number;
    t?: string;
    v?: number;
    vw?: number;
  };
}

function hasCredentials() {
  return Boolean(KEY && SECRET);
}

function authHeaders() {
  return {
    "APCA-API-KEY-ID": KEY,
    "APCA-API-SECRET-KEY": SECRET,
  };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  if (!hasCredentials()) {
    throw new Error("Missing Alpaca credentials");
  }

  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Alpaca request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

export function alpacaConnectionStatus() {
  return {
    connected: hasCredentials(),
    provider: "alpaca-paper",
  };
}

export async function getAlpacaAccount() {
  return requestJson<AlpacaAccount>(`${TRADING_BASE}/v2/account`);
}

export async function getAlpacaOrders(status: "open" | "closed" | "all" = "all", limit = 200) {
  const params = new URLSearchParams({
    status,
    direction: "desc",
    limit: String(limit),
    nested: "true",
  });
  return requestJson<AlpacaOrder[]>(`${TRADING_BASE}/v2/orders?${params.toString()}`);
}

export async function getAlpacaPositions() {
  return requestJson<AlpacaPosition[]>(`${TRADING_BASE}/v2/positions`);
}

export async function getAlpacaPortfolioHistory(period = "1A", timeframe = "1D") {
  const normalizedPeriod = period.trim().toUpperCase();
  const safePeriod = normalizedPeriod.endsWith("Y")
    ? `${normalizedPeriod.slice(0, -1) || "1"}A`
    : (normalizedPeriod || "1A");

  const params = new URLSearchParams({
    period: safePeriod,
    timeframe,
    extended_hours: "true",
  });
  return requestJson<AlpacaPortfolioHistory>(`${TRADING_BASE}/v2/account/portfolio/history?${params.toString()}`);
}

export async function getAlpacaActivities(pageSize = 100) {
  const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
  const params = new URLSearchParams({
    activity_types: "FILL",
    direction: "desc",
    page_size: String(safePageSize),
  });
  return requestJson<AlpacaActivityFill[]>(`${TRADING_BASE}/v2/account/activities?${params.toString()}`);
}

export async function placeAlpacaPaperOrder(input: {
  symbol: string;
  qty: number;
  side: "buy" | "sell";
  type?: "market" | "limit";
  time_in_force?: "day" | "gtc";
  limit_price?: number;
}) {
  const payload = {
    symbol: input.symbol,
    qty: String(input.qty),
    side: input.side,
    type: input.type ?? "market",
    time_in_force: input.time_in_force ?? "day",
    ...(input.limit_price ? { limit_price: String(input.limit_price) } : {}),
  };

  return requestJson<AlpacaOrder>(`${TRADING_BASE}/v2/orders`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function closeAlpacaPosition(symbol: string) {
  return requestJson<unknown>(`${TRADING_BASE}/v2/positions/${encodeURIComponent(symbol)}`, {
    method: "DELETE",
  });
}

export async function getStockSnapshots(symbols: string[]) {
  if (!symbols.length) return {};
  const params = new URLSearchParams({
    symbols: symbols.join(","),
    feed: "iex",
  });
  return requestJson<Record<string, unknown>>(`${DATA_BASE}/v2/stocks/snapshots?${params.toString()}`);
}

export async function getCryptoLatestQuotes(symbols: string[]) {
  if (!symbols.length) return {};
  const params = new URLSearchParams({ symbols: symbols.join(",") });
  return requestJson<Record<string, unknown>>(`${DATA_BASE}/v1beta3/crypto/us/latest/quotes?${params.toString()}`);
}

export async function getOptionChainSnapshots(underlyingSymbol: string, limit = 1000, maxPages = 4) {
  const snapshots: Record<string, AlpacaOptionSnapshot> = {};
  let nextPageToken: string | null = null;
  let pages = 0;

  do {
    const params = new URLSearchParams({
      limit: String(Math.min(1000, Math.max(1, Math.floor(limit)))),
    });
    if (nextPageToken) params.set("page_token", nextPageToken);

    const response = await requestJson<{
      next_page_token?: string | null;
      snapshots?: Record<string, AlpacaOptionSnapshot>;
    }>(`${DATA_BASE}/v1beta1/options/snapshots/${encodeURIComponent(underlyingSymbol)}?${params.toString()}`);

    Object.assign(snapshots, response.snapshots ?? {});
    nextPageToken = response.next_page_token ?? null;
    pages += 1;
  } while (nextPageToken && pages < maxPages);

  return snapshots;
}
