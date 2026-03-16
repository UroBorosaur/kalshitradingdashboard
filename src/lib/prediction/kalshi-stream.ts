import "@/lib/server-only";

import WebSocket from "ws";

import type { KalshiStreamStatus } from "@/lib/live/types";
import {
  normalizeKalshiPriceRanges,
  normalizeKalshiTickSizeCents,
  parseKalshiContractCount,
  parseKalshiNumber,
  parseKalshiProbability,
  probabilityToCents,
} from "@/lib/prediction/fixed-point";
import {
  getKalshiDemoBalancesUsd,
  getKalshiDemoFills,
  getKalshiDemoOrders,
  getKalshiDemoPositions,
  getKalshiMarketQuotes,
  getKalshiOpenMarkets,
  getKalshiSignedHeaders,
  getKalshiWebSocketBaseUrl,
  kalshiConnectionStatus,
} from "@/lib/prediction/kalshi";
import { persistStreamEvents } from "@/lib/storage/prediction-store";
import type { StoredKalshiStreamEvent } from "@/lib/storage/types";
import type {
  KalshiFillLite,
  KalshiOrderGroupLite,
  KalshiOrderLite,
  KalshiPositionLite,
  KalshiQuoteLite,
  PredictionCategory,
  PredictionMarketQuote,
} from "@/lib/prediction/types";

const PUBLIC_SEED_TTL_MS = 5 * 60_000;
const PRIVATE_SEED_TTL_MS = 60_000;
const CONNECT_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 25_000;
const MAX_RECONNECT_DELAY_MS = 15_000;
const RECONNECT_BASE_DELAY_MS = 1_000;
const STREAM_PERSIST_FLUSH_MS = 250;
const STREAM_PERSIST_BATCH_SIZE = 100;

type KalshiStreamChannel = "ticker" | "orderbook_delta" | "user_orders" | "fill" | "market_positions" | "order_group_updates";

interface WsCommandResult {
  id?: number;
  msg?: string;
  sid?: number;
  channel?: string;
  market_tickers?: string[];
}

interface StreamSubscriptionState {
  channel: KalshiStreamChannel;
  sid: number | null;
  marketTickers: Set<string>;
  lastSeq: number | null;
}

interface StreamMarketState {
  market: PredictionMarketQuote;
  yesBook: Map<number, number>;
  noBook: Map<number, number>;
  updatedAtMs: number;
}

interface StreamPrivateStateSnapshot {
  orders: KalshiOrderLite[];
  fills: KalshiFillLite[];
  positions: KalshiPositionLite[];
  quotes: Record<string, KalshiQuoteLite>;
}

interface StreamSummarySnapshot extends StreamPrivateStateSnapshot {
  connected: boolean;
  provider: string;
  balanceUsd: number | null;
  cashUsd: number | null;
  portfolioUsd: number | null;
  stream: KalshiStreamStatus;
  error: string | null;
}

function toNumber(value: unknown): number | null {
  return parseKalshiNumber(value);
}

function toProbability(value: unknown): number | null {
  return parseKalshiProbability(value);
}

function toContractCount(value: unknown): number | null {
  return parseKalshiContractCount(value);
}

function toSignedContractCount(value: unknown): number | null {
  const parsed = toNumber(value);
  if (parsed === null || !Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(6));
}

function firstDefinedNumber(...values: Array<number | null | undefined>) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function firstDefinedProb(...values: unknown[]) {
  for (const value of values) {
    const parsed = toProbability(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function firstDefinedCount(...values: unknown[]) {
  for (const value of values) {
    const parsed = toContractCount(value);
    if (parsed !== null) return parsed;
  }
  return undefined;
}

function clampProbability(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(Math.min(0.9999, Math.max(0.0001, value)).toFixed(4));
}

function mapPriceLevels(rawLevels: unknown): Map<number, number> {
  const out = new Map<number, number>();
  if (!Array.isArray(rawLevels)) return out;

  for (const level of rawLevels) {
    if (!Array.isArray(level) || level.length < 2) continue;
    const price = toProbability(level[0]);
    const size = toContractCount(level[1]);
    if (price === null || size === null || size <= 0) continue;
    out.set(price, size);
  }

  return out;
}

function bestBid(book: Map<number, number>) {
  let bestPrice: number | null = null;
  let bestSize = 0;
  for (const [price, size] of book.entries()) {
    if (size <= 0) continue;
    if (bestPrice === null || price > bestPrice) {
      bestPrice = price;
      bestSize = size;
    }
  }
  return {
    price: bestPrice,
    size: bestPrice === null ? 0 : bestSize,
  };
}

function toIsoTime(value: unknown) {
  if (typeof value === "string" && value.trim()) return value;
  const raw = toNumber(value);
  if (raw === null) return undefined;
  if (raw > 10_000_000_000) return new Date(raw).toISOString();
  if (raw > 1_000_000_000) return new Date(raw * 1000).toISOString();
  return undefined;
}

function sortByTimestampDesc<T>(rows: T[], timestampFn: (row: T) => string | undefined) {
  return [...rows].sort((left, right) => {
    const leftTs = timestampFn(left) ? new Date(timestampFn(left)!).getTime() : 0;
    const rightTs = timestampFn(right) ? new Date(timestampFn(right)!).getTime() : 0;
    return rightTs - leftTs;
  });
}

function firstDefinedString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function normalizeStreamEvent(message: Record<string, unknown>): StoredKalshiStreamEvent {
  const nestedPayload =
    message.msg && typeof message.msg === "object" && !Array.isArray(message.msg)
      ? (message.msg as Record<string, unknown>)
      : null;
  const payload = nestedPayload ?? message;
  const marketTicker = firstDefinedString(
    payload.market_ticker,
    payload.ticker,
    message.market_ticker,
    message.ticker,
  )?.toUpperCase();
  const marketTickers = Array.isArray(message.market_tickers)
    ? message.market_tickers.filter((value): value is string => typeof value === "string").map((value) => value.toUpperCase())
    : Array.isArray(payload.market_tickers)
      ? payload.market_tickers.filter((value): value is string => typeof value === "string").map((value) => value.toUpperCase())
      : undefined;

  return {
    eventType: firstDefinedString(message.type, payload.type) ?? "unknown",
    channel: firstDefinedString(message.channel, payload.channel),
    sid: toNumber(message.sid ?? payload.sid) ?? undefined,
    seq: toNumber(message.seq ?? payload.seq) ?? undefined,
    marketTicker,
    marketTickers,
    raw: message,
  };
}

class KalshiStreamService {
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatStarted = false;
  private pendingRequests = new Map<number, {
    resolve: (value: WsCommandResult) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private nextRequestId = 1;
  private reconnectAttempt = 0;
  private reconnectCount = 0;
  private desyncCount = 0;
  private lastResyncAtMs = 0;
  private lastMessageAtMs = 0;
  private lastHeartbeatAtMs = 0;
  private lastControlPingAtMs = 0;
  private lastControlPongAtMs = 0;
  private lastError: string | null = null;
  private publicPrimedAtMs = 0;
  private privatePrimedAtMs = 0;
  private requestedCategories = new Set<PredictionCategory>();
  private desiredMarketTickers = new Set<string>();
  private subscriptions = new Map<KalshiStreamChannel, StreamSubscriptionState>([
    ["ticker", { channel: "ticker", sid: null, marketTickers: new Set(), lastSeq: null }],
    ["orderbook_delta", { channel: "orderbook_delta", sid: null, marketTickers: new Set(), lastSeq: null }],
    ["user_orders", { channel: "user_orders", sid: null, marketTickers: new Set(), lastSeq: null }],
    ["fill", { channel: "fill", sid: null, marketTickers: new Set(), lastSeq: null }],
    ["market_positions", { channel: "market_positions", sid: null, marketTickers: new Set(), lastSeq: null }],
    ["order_group_updates", { channel: "order_group_updates", sid: null, marketTickers: new Set(), lastSeq: null }],
  ]);
  private marketStates = new Map<string, StreamMarketState>();
  private orders = new Map<string, KalshiOrderLite>();
  private fills = new Map<string, KalshiFillLite>();
  private positions = new Map<string, KalshiPositionLite>();
  private orderGroups = new Map<string, KalshiOrderGroupLite>();
  private streamEventBuffer: StoredKalshiStreamEvent[] = [];
  private streamPersistTimer: NodeJS.Timeout | null = null;
  private streamPersistPromise: Promise<void> = Promise.resolve();

  private websocketUrl() {
    return getKalshiWebSocketBaseUrl();
  }

  private createSocket() {
    const url = this.websocketUrl();
    return new WebSocket(url, {
      headers: getKalshiSignedHeaders("GET", new URL(url).pathname),
    });
  }

  private setLastMessageNow() {
    const now = Date.now();
    this.lastMessageAtMs = now;
    this.lastHeartbeatAtMs = now;
  }

  private clearPendingRequests(message: string) {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
      this.pendingRequests.delete(id);
    }
  }

  private startHeartbeat() {
    if (this.heartbeatStarted) return;
    this.heartbeatStarted = true;
    this.heartbeatTimer = setInterval(() => {
      void this.runHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat() {
    this.heartbeatStarted = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async runHeartbeat() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    const silenceMs = Date.now() - Math.max(this.lastMessageAtMs, this.lastHeartbeatAtMs);
    if (silenceMs > HEARTBEAT_TIMEOUT_MS) {
      this.scheduleReconnect(`heartbeat timeout after ${silenceMs}ms`);
      return;
    }

    try {
      await this.sendCommand("list_subscriptions");
      this.lastHeartbeatAtMs = Date.now();
    } catch (error) {
      this.scheduleReconnect(`heartbeat failed: ${(error as Error).message}`);
    }
  }

  private scheduleReconnect(reason: string) {
    this.lastError = reason;
    this.lastResyncAtMs = Date.now();
    this.reconnectCount += 1;
    this.desyncCount += /sequence gap/i.test(reason) ? 1 : 0;
    this.clearSocket();

    if (this.reconnectTimer) return;

    const delay = Math.min(MAX_RECONNECT_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** Math.min(this.reconnectAttempt, 4));
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnected().catch((error) => {
        this.lastError = (error as Error).message;
        this.scheduleReconnect(this.lastError);
      });
    }, delay);
  }

  private clearSocket() {
    this.stopHeartbeat();
    void this.flushStreamEventBuffer();
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // ignore
      }
    }
    this.socket = null;
    this.connectPromise = null;
    for (const subscription of this.subscriptions.values()) {
      subscription.sid = null;
      subscription.lastSeq = null;
    }
    this.clearPendingRequests("Kalshi websocket disconnected.");
  }

  private onOpen() {
    this.setLastMessageNow();
    this.reconnectAttempt = 0;
    this.startHeartbeat();
  }

  private onClose() {
    this.scheduleReconnect("socket closed");
  }

  private onError(error: Error) {
    this.lastError = error.message;
    this.scheduleReconnect(`socket error: ${error.message}`);
  }

  private queueStreamEvent(event: StoredKalshiStreamEvent) {
    this.streamEventBuffer.push(event);
    if (this.streamEventBuffer.length >= STREAM_PERSIST_BATCH_SIZE) {
      void this.flushStreamEventBuffer();
      return;
    }
    if (this.streamPersistTimer) return;
    this.streamPersistTimer = setTimeout(() => {
      this.streamPersistTimer = null;
      void this.flushStreamEventBuffer();
    }, STREAM_PERSIST_FLUSH_MS);
  }

  private async flushStreamEventBuffer() {
    if (this.streamPersistTimer) {
      clearTimeout(this.streamPersistTimer);
      this.streamPersistTimer = null;
    }
    if (!this.streamEventBuffer.length) return;

    const batch = this.streamEventBuffer.splice(0, this.streamEventBuffer.length);
    this.streamPersistPromise = this.streamPersistPromise
      .then(async () => {
        await persistStreamEvents({
          source: "kalshi-stream/ws",
          events: batch,
        });
      })
      .catch((error) => {
        this.lastError = `stream event persistence failed: ${(error as Error).message}`;
      });

    await this.streamPersistPromise;
  }

  private parseJson(data: WebSocket.RawData): Record<string, unknown> | null {
    try {
      const text = typeof data === "string" ? data : data.toString("utf8");
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private resolvePending(id: number, payload: WsCommandResult) {
    const pending = this.pendingRequests.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(id);
    pending.resolve(payload);
  }

  private rejectPending(id: number, error: string) {
    const pending = this.pendingRequests.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(id);
    pending.reject(new Error(error));
  }

  private upsertMarket(partial: Partial<PredictionMarketQuote> & Pick<PredictionMarketQuote, "ticker">) {
    const ticker = partial.ticker.toUpperCase();
    const existing = this.marketStates.get(ticker);
    const fallback: PredictionMarketQuote = existing?.market ?? {
      ticker,
      title: ticker,
      category: "OTHER",
      closeTime: null,
      yesBid: null,
      yesAsk: null,
      noBid: null,
      noAsk: null,
      yesBidSize: 0,
      yesAskSize: 0,
      noBidSize: 0,
      noAskSize: 0,
      lastPrice: null,
      volume: 0,
      openInterest: 0,
      liquidityDollars: 0,
      tickSize: 1,
      settlementTimerSeconds: 0,
      canCloseEarly: false,
      status: "active",
    };

    const merged: PredictionMarketQuote = {
      ...fallback,
      ...partial,
      ticker,
      title: partial.title ?? fallback.title,
      category: partial.category ?? fallback.category,
      closeTime: partial.closeTime ?? fallback.closeTime,
      yesBid: partial.yesBid ?? fallback.yesBid,
      yesAsk: partial.yesAsk ?? fallback.yesAsk,
      noBid: partial.noBid ?? fallback.noBid,
      noAsk: partial.noAsk ?? fallback.noAsk,
      yesBidSize: partial.yesBidSize ?? fallback.yesBidSize,
      yesAskSize: partial.yesAskSize ?? fallback.yesAskSize,
      noBidSize: partial.noBidSize ?? fallback.noBidSize,
      noAskSize: partial.noAskSize ?? fallback.noAskSize,
      lastPrice: partial.lastPrice ?? fallback.lastPrice,
      volume: partial.volume ?? fallback.volume,
      openInterest: partial.openInterest ?? fallback.openInterest,
      liquidityDollars: partial.liquidityDollars ?? fallback.liquidityDollars,
      tickSize: partial.tickSize ?? fallback.tickSize,
      settlementTimerSeconds: partial.settlementTimerSeconds ?? fallback.settlementTimerSeconds,
      canCloseEarly: partial.canCloseEarly ?? fallback.canCloseEarly,
      status: partial.status ?? fallback.status,
    };

    this.marketStates.set(ticker, {
      market: merged,
      yesBook: existing?.yesBook ?? new Map(),
      noBook: existing?.noBook ?? new Map(),
      updatedAtMs: Date.now(),
    });
  }

  private syncTopOfBookFromOrderbook(ticker: string) {
    const state = this.marketStates.get(ticker);
    if (!state) return;

    const yes = bestBid(state.yesBook);
    const no = bestBid(state.noBook);
    this.upsertMarket({
      ticker,
      yesBid: yes.price,
      noBid: no.price,
      yesAsk: no.price !== null ? clampProbability(1 - no.price) : state.market.yesAsk,
      noAsk: yes.price !== null ? clampProbability(1 - yes.price) : state.market.noAsk,
      yesBidSize: yes.size,
      noBidSize: no.size,
      yesAskSize: no.size,
      noAskSize: yes.size,
    });
  }

  private applyTickerMessage(message: Record<string, unknown>) {
    const ticker = String(message.market_ticker ?? message.ticker ?? "").toUpperCase();
    if (!ticker) return;

    this.upsertMarket({
      ticker,
      title: typeof message.title === "string" ? message.title : undefined,
      yesBid: firstDefinedProb(message.yes_bid_dollars, message.yes_bid, message.best_bid_yes),
      yesAsk: firstDefinedProb(message.yes_ask_dollars, message.yes_ask, message.best_ask_yes),
      noBid: firstDefinedProb(message.no_bid_dollars, message.no_bid, message.best_bid_no),
      noAsk: firstDefinedProb(message.no_ask_dollars, message.no_ask, message.best_ask_no),
      yesBidSize: firstDefinedCount(message.yes_bid_size_fp, message.best_bid_yes_size) ?? undefined,
      yesAskSize: firstDefinedCount(message.yes_ask_size_fp, message.best_ask_yes_size) ?? undefined,
      noBidSize: firstDefinedCount(message.no_bid_size_fp, message.best_bid_no_size) ?? undefined,
      noAskSize: firstDefinedCount(message.no_ask_size_fp, message.best_ask_no_size) ?? undefined,
      lastPrice: firstDefinedProb(message.price_dollars, message.last_price_dollars, message.last_price),
      volume: firstDefinedNumber(toNumber(message.volume_fp), toNumber(message.volume), undefined) ?? undefined,
      openInterest: firstDefinedNumber(toNumber(message.open_interest_fp), toNumber(message.open_interest), undefined) ?? undefined,
      tickSize: message.tick_size !== undefined || message.tick_size_dollars !== undefined
        ? normalizeKalshiTickSizeCents(message.tick_size_dollars ?? message.tick_size)
        : undefined,
      priceLevelStructure: typeof message.price_level_structure === "string" ? message.price_level_structure : undefined,
      priceRanges: normalizeKalshiPriceRanges(message.price_ranges),
      fractionalTradingEnabled:
        message.fractional_trading_enabled === true
          ? true
          : message.fractional_trading_enabled === false
            ? false
            : undefined,
    });
  }

  private applyOrderbookSnapshot(message: Record<string, unknown>) {
    const ticker = String(message.market_ticker ?? message.ticker ?? "").toUpperCase();
    const sid = toNumber(message.sid);
    const seq = toNumber(message.seq);
    if (!ticker || sid === null) return;

    const subscription = this.subscriptions.get("orderbook_delta");
    if (subscription) {
      subscription.sid = sid;
      subscription.lastSeq = seq;
      subscription.marketTickers.add(ticker);
    }

    const existing = this.marketStates.get(ticker);
    this.marketStates.set(ticker, {
      market: existing?.market ?? {
        ticker,
        title: ticker,
        category: "OTHER",
        closeTime: null,
        yesBid: null,
        yesAsk: null,
        noBid: null,
        noAsk: null,
        yesBidSize: 0,
        yesAskSize: 0,
        noBidSize: 0,
        noAskSize: 0,
        lastPrice: null,
        volume: 0,
        openInterest: 0,
        liquidityDollars: 0,
        tickSize: 1,
        settlementTimerSeconds: 0,
        canCloseEarly: false,
        status: "active",
      },
      yesBook: mapPriceLevels(message.yes_dollars_fp),
      noBook: mapPriceLevels(message.no_dollars_fp),
      updatedAtMs: Date.now(),
    });
    this.syncTopOfBookFromOrderbook(ticker);
  }

  private applyOrderbookDelta(message: Record<string, unknown>) {
    const ticker = String(message.market_ticker ?? message.ticker ?? "").toUpperCase();
    const sid = toNumber(message.sid);
    const seq = toNumber(message.seq);
    if (!ticker || sid === null || seq === null) return;

    const subscription = this.subscriptions.get("orderbook_delta");
    if (!subscription) return;

    if (subscription.sid !== null && subscription.sid !== sid) {
      subscription.sid = sid;
      subscription.lastSeq = seq;
    } else if (subscription.lastSeq !== null && seq !== subscription.lastSeq + 1) {
      this.scheduleReconnect(`orderbook sequence gap: expected ${subscription.lastSeq + 1}, received ${seq}`);
      return;
    }

    subscription.sid = sid;
    subscription.lastSeq = seq;
    subscription.marketTickers.add(ticker);

    const state = this.marketStates.get(ticker);
    if (!state) {
      this.scheduleReconnect(`orderbook delta received before snapshot for ${ticker}`);
      return;
    }

    const side = String(message.side ?? message.book_side ?? "").toLowerCase() === "no" ? "no" : "yes";
    const price = toProbability(firstDefinedNumber(toNumber(message.price_dollars), toNumber(message.price), null));
    const delta = toSignedContractCount(firstDefinedNumber(toNumber(message.delta_fp), toNumber(message.delta), null));
    if (price === null || delta === null) return;

    const book = side === "yes" ? state.yesBook : state.noBook;
    const nextSize = Number(((book.get(price) ?? 0) + delta).toFixed(6));
    if (nextSize <= 0) book.delete(price);
    else book.set(price, nextSize);
    state.updatedAtMs = Date.now();
    this.syncTopOfBookFromOrderbook(ticker);
  }

  private applyUserOrderMessage(message: Record<string, unknown>) {
    const orderId = String(message.order_id ?? message.id ?? "").trim();
    const ticker = String(message.market_ticker ?? message.ticker ?? "").toUpperCase();
    if (!orderId || !ticker) return;

    const side = String(message.side ?? "").toLowerCase() === "no" ? "no" : "yes";
    const genericPrice = toNumber(message.price_dollars) ?? toNumber(message.price);
    const yesPrice = side === "yes"
      ? firstDefinedNumber(toNumber(message.yes_price), toNumber(message.yes_price_dollars), genericPrice)
      : firstDefinedNumber(toNumber(message.yes_price), toNumber(message.yes_price_dollars), genericPrice !== null ? 100 - genericPrice : null);
    const noPrice = side === "no"
      ? firstDefinedNumber(toNumber(message.no_price), toNumber(message.no_price_dollars), genericPrice)
      : firstDefinedNumber(toNumber(message.no_price), toNumber(message.no_price_dollars), genericPrice !== null ? 100 - genericPrice : null);

    this.orders.set(orderId, {
      order_id: orderId,
      client_order_id: typeof message.client_order_id === "string" ? message.client_order_id : undefined,
      order_group_id: typeof message.order_group_id === "string" ? message.order_group_id : undefined,
      ticker,
      title: this.marketStates.get(ticker)?.market.title,
      market_status: typeof message.market_status === "string" ? message.market_status : this.marketStates.get(ticker)?.market.status,
      side,
      action: typeof message.action === "string" ? message.action : "buy",
      status: typeof message.status === "string" ? message.status : String(message.type ?? "open"),
      type: typeof message.order_type === "string" ? message.order_type : (typeof message.type === "string" ? message.type : undefined),
      count: firstDefinedCount(message.count_fp, message.count, message.initial_count_fp, message.initial_count, message.quantity) ?? 0,
      remaining_count: firstDefinedCount(message.remaining_count, message.remaining_count_fp, message.remaining_quantity),
      yes_price: typeof yesPrice === "number" ? probabilityToCents(yesPrice <= 1 ? yesPrice : yesPrice / 100) : undefined,
      no_price: typeof noPrice === "number" ? probabilityToCents(noPrice <= 1 ? noPrice : noPrice / 100) : undefined,
      created_time: toIsoTime(message.created_time ?? message.ts),
      expiration_time: toIsoTime(message.expiration_time),
      last_update_time: toIsoTime(message.updated_time ?? message.ts),
    });
  }

  private applyFillMessage(message: Record<string, unknown>) {
    const fillId = String(message.fill_id ?? message.trade_id ?? message.id ?? "").trim();
    const orderId = String(message.order_id ?? "").trim();
    const ticker = String(message.market_ticker ?? message.ticker ?? "").toUpperCase();
    if (!fillId || !orderId || !ticker) return;

    const side = String(message.side ?? "").toLowerCase() === "no" ? "no" : "yes";
    const genericPrice = toNumber(message.price_dollars) ?? toNumber(message.price);
    const yesPrice = side === "yes"
      ? firstDefinedNumber(toNumber(message.yes_price), toNumber(message.yes_price_dollars), genericPrice)
      : firstDefinedNumber(toNumber(message.yes_price), toNumber(message.yes_price_dollars), genericPrice !== null ? 100 - genericPrice : null);
    const noPrice = side === "no"
      ? firstDefinedNumber(toNumber(message.no_price), toNumber(message.no_price_dollars), genericPrice)
      : firstDefinedNumber(toNumber(message.no_price), toNumber(message.no_price_dollars), genericPrice !== null ? 100 - genericPrice : null);

    this.fills.set(fillId, {
      fill_id: fillId,
      order_id: orderId,
      ticker,
      side,
      action: typeof message.action === "string" ? message.action : "buy",
      count: firstDefinedCount(message.count_fp, message.count, message.quantity, message.fill_count_fp, message.fill_count) ?? 0,
      yes_price: typeof yesPrice === "number" ? probabilityToCents(yesPrice <= 1 ? yesPrice : yesPrice / 100) : undefined,
      no_price: typeof noPrice === "number" ? probabilityToCents(noPrice <= 1 ? noPrice : noPrice / 100) : undefined,
      created_time: toIsoTime(message.created_time ?? message.ts),
    });
  }

  private applyPositionMessage(message: Record<string, unknown>) {
    const ticker = String(message.market_ticker ?? message.ticker ?? "").toUpperCase();
    if (!ticker) return;

    const positionFp = String(message.position_fp ?? message.position ?? "").trim();
    if (!positionFp) return;

    this.positions.set(ticker, {
      ticker,
      position_fp: positionFp,
      market_exposure_dollars: typeof message.market_exposure_dollars === "string" ? message.market_exposure_dollars : undefined,
      total_traded_dollars: typeof message.total_traded_dollars === "string" ? message.total_traded_dollars : undefined,
      realized_pnl_dollars: typeof message.realized_pnl_dollars === "string" ? message.realized_pnl_dollars : undefined,
      fees_paid_dollars: typeof message.fees_paid_dollars === "string" ? message.fees_paid_dollars : undefined,
      last_updated_ts: String(message.last_updated_ts ?? toNumber(message.ts) ?? ""),
      resting_orders_count: Math.max(0, Math.floor(toNumber(message.resting_orders_count) ?? 0)),
    });
  }

  private applyOrderGroupUpdate(message: Record<string, unknown>) {
    const orderGroupId = String(message.order_group_id ?? message.id ?? "").trim();
    if (!orderGroupId) return;

    this.orderGroups.set(orderGroupId, {
      order_group_id: orderGroupId,
      contracts_limit: Math.max(0, Math.floor(toNumber(message.contracts_limit ?? message.limit) ?? 0)),
      is_auto_cancel_enabled: message.is_auto_cancel_enabled !== false,
      status: typeof message.status === "string" ? message.status : undefined,
      order_ids: Array.isArray(message.order_ids)
        ? message.order_ids.filter((value): value is string => typeof value === "string")
        : undefined,
    });
  }

  private handleMessage(raw: Record<string, unknown>) {
    const type = String(raw.type ?? "").toLowerCase();
    const id = toNumber(raw.id);
    const nestedPayload =
      raw.msg && typeof raw.msg === "object" && !Array.isArray(raw.msg)
        ? (raw.msg as Record<string, unknown>)
        : null;
    const payload = nestedPayload
      ? {
          ...nestedPayload,
          sid: raw.sid ?? nestedPayload.sid,
          seq: raw.seq ?? nestedPayload.seq,
          channel: raw.channel ?? nestedPayload.channel,
          market_tickers: raw.market_tickers ?? nestedPayload.market_tickers,
        }
      : raw;
    this.setLastMessageNow();

    if (id !== null && (type === "subscribed" || type === "updated_subscription" || type === "ok" || type === "list_subscriptions")) {
      this.resolvePending(id, {
        id,
        msg: typeof raw.msg === "string" ? raw.msg : undefined,
        sid: toNumber(raw.sid) ?? undefined,
        channel: typeof raw.channel === "string" ? raw.channel : undefined,
        market_tickers: Array.isArray(raw.market_tickers) ? raw.market_tickers.filter((value): value is string => typeof value === "string") : undefined,
      });
    } else if (id !== null && type === "error") {
      this.rejectPending(id, typeof raw.msg === "string" ? raw.msg : "Kalshi websocket error");
      return;
    }

    if (type === "subscribed") {
      const channel = String(raw.channel ?? "") as KalshiStreamChannel;
      const subscription = this.subscriptions.get(channel);
      if (subscription) {
        subscription.sid = toNumber(raw.sid);
        subscription.lastSeq = null;
        if (Array.isArray(raw.market_tickers)) {
          subscription.marketTickers = new Set(raw.market_tickers.filter((value): value is string => typeof value === "string").map((value) => value.toUpperCase()));
        }
      }
      return;
    }

    switch (type) {
      case "ticker":
        this.applyTickerMessage(payload);
        return;
      case "orderbook_snapshot":
        this.applyOrderbookSnapshot(payload);
        return;
      case "orderbook_delta":
        this.applyOrderbookDelta(payload);
        return;
      case "user_order":
        this.applyUserOrderMessage(payload);
        return;
      case "fill":
        this.applyFillMessage(payload);
        return;
      case "market_position":
        this.applyPositionMessage(payload);
        return;
      case "order_group_update":
      case "order_group_updates":
        this.applyOrderGroupUpdate(payload);
        return;
      default:
        return;
    }
  }

  private async sendCommand(cmd: string, params?: Record<string, unknown>): Promise<WsCommandResult> {
    await this.ensureConnected();
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Kalshi websocket is not connected.");
    }

    const id = this.nextRequestId++;
    const payload = JSON.stringify({ id, cmd, ...(params ? { params } : {}) });

    return new Promise<WsCommandResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Kalshi websocket command timed out: ${cmd}`));
      }, 7_500);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      this.socket?.send(payload, (error) => {
        if (error) {
          clearTimeout(timeout);
          this.pendingRequests.delete(id);
          reject(error);
        }
      });
    });
  }

  private async subscribeChannel(channel: KalshiStreamChannel, marketTickers?: string[]) {
    const params: Record<string, unknown> = {
      channels: [channel],
    };
    if (marketTickers?.length) params.market_tickers = marketTickers;
    const result = await this.sendCommand("subscribe", params);
    const subscription = this.subscriptions.get(channel);
    if (subscription) {
      subscription.sid = result.sid ?? subscription.sid;
      if (marketTickers?.length) {
        subscription.marketTickers = new Set(marketTickers.map((ticker) => ticker.toUpperCase()));
      }
      subscription.lastSeq = null;
    }
  }

  private async updateMarketSubscription(channel: "ticker" | "orderbook_delta", marketTickers: string[]) {
    const subscription = this.subscriptions.get(channel);
    if (!subscription?.sid) {
      await this.subscribeChannel(channel, marketTickers);
      return;
    }

    const next = marketTickers.map((ticker) => ticker.toUpperCase());
    const current = subscription.marketTickers;
    const addMarkets = next.filter((ticker) => !current.has(ticker));
    if (!addMarkets.length) return;

    await this.sendCommand("update_subscription", {
      sids: [subscription.sid],
      market_tickers: addMarkets,
      action: "add_markets",
    });
    for (const ticker of addMarkets) current.add(ticker);
  }

  private async ensureConnected() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;

    const status = kalshiConnectionStatus();
    if (!status.connected) {
      throw new Error(status.reason ?? "Kalshi credentials not configured.");
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = this.createSocket();
      const timeout = setTimeout(() => {
        reject(new Error("Timed out connecting to Kalshi websocket."));
        try {
          socket.close();
        } catch {
          // ignore
        }
      }, CONNECT_TIMEOUT_MS);

      socket.on("open", () => {
        clearTimeout(timeout);
        this.socket = socket;
        this.onOpen();
        void this.restoreSubscriptions()
          .then(() => resolve())
          .catch((error) => {
            this.scheduleReconnect(`subscription restore failed: ${(error as Error).message}`);
            reject(error as Error);
          });
      });
      socket.on("message", (data) => {
        const parsed = this.parseJson(data);
        if (parsed) {
          this.queueStreamEvent(normalizeStreamEvent(parsed));
          this.handleMessage(parsed);
        }
      });
      socket.on("ping", () => {
        this.lastControlPingAtMs = Date.now();
        this.queueStreamEvent({
          eventType: "control_ping",
          controlFrame: "ping",
          raw: { type: "control_ping" },
        });
      });
      socket.on("pong", () => {
        this.lastControlPongAtMs = Date.now();
        this.queueStreamEvent({
          eventType: "control_pong",
          controlFrame: "pong",
          raw: { type: "control_pong" },
        });
      });
      socket.on("error", (error) => {
        clearTimeout(timeout);
        this.onError(error as Error);
      });
      socket.on("close", () => {
        clearTimeout(timeout);
        this.onClose();
      });
    }).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  private async seedPublic(categories: PredictionCategory[], limit: number, extraTickers: string[]) {
    const missingCategory = categories.some((category) => !this.requestedCategories.has(category));
    const insufficientCoverage = this.getPublicMarkets(categories, limit).length < Math.min(limit, 25);
    const shouldRefresh =
      !this.publicPrimedAtMs ||
      Date.now() - this.publicPrimedAtMs > PUBLIC_SEED_TTL_MS ||
      !this.marketStates.size ||
      missingCategory ||
      insufficientCoverage;

    if (!shouldRefresh && extraTickers.every((ticker) => this.marketStates.has(ticker.toUpperCase()))) {
      extraTickers.forEach((ticker) => this.desiredMarketTickers.add(ticker.toUpperCase()));
      return;
    }

    const markets = await getKalshiOpenMarkets(categories, limit);
    for (const market of markets) {
      this.upsertMarket(market);
      this.desiredMarketTickers.add(market.ticker.toUpperCase());
      this.requestedCategories.add(market.category);
    }

    if (extraTickers.length) {
      const quotes = await getKalshiMarketQuotes(extraTickers);
      for (const [ticker, quote] of Object.entries(quotes)) {
        this.upsertMarket({
          ticker,
          title: quote.title,
          yesBid: quote.yesBid,
          yesAsk: quote.yesAsk,
          noBid: quote.noBid,
          noAsk: quote.noAsk,
          lastPrice: quote.lastPrice,
          status: quote.marketStatus,
        });
        this.desiredMarketTickers.add(ticker.toUpperCase());
      }
    }

    this.publicPrimedAtMs = Date.now();
  }

  private async seedPrivate(extraQuoteTickers: string[]) {
    const shouldRefresh =
      !this.privatePrimedAtMs ||
      Date.now() - this.privatePrimedAtMs > PRIVATE_SEED_TTL_MS ||
      !this.orders.size;

    if (!shouldRefresh) {
      extraQuoteTickers.forEach((ticker) => this.desiredMarketTickers.add(ticker.toUpperCase()));
      return;
    }

    const [orders, fills, positions] = await Promise.all([
      getKalshiDemoOrders(500),
      getKalshiDemoFills(500),
      getKalshiDemoPositions(500),
    ]);

    this.orders = new Map(orders.map((order) => [order.order_id, order]));
    this.fills = new Map(fills.map((fill) => [fill.fill_id, fill]));
    this.positions = new Map(positions.map((position) => [position.ticker.toUpperCase(), position]));

    const quoteTickers = Array.from(
      new Set([
        ...extraQuoteTickers.map((ticker) => ticker.toUpperCase()),
        ...orders.map((order) => order.ticker.toUpperCase()),
        ...positions.map((position) => position.ticker.toUpperCase()),
      ]),
    );
    if (quoteTickers.length) {
      const quotes = await getKalshiMarketQuotes(quoteTickers);
      for (const [ticker, quote] of Object.entries(quotes)) {
        this.upsertMarket({
          ticker,
          title: quote.title,
          yesBid: quote.yesBid,
          yesAsk: quote.yesAsk,
          noBid: quote.noBid,
          noAsk: quote.noAsk,
          lastPrice: quote.lastPrice,
          status: quote.marketStatus,
        });
      }
      quoteTickers.forEach((ticker) => this.desiredMarketTickers.add(ticker));
    }

    this.privatePrimedAtMs = Date.now();
  }

  private async ensurePublicSubscriptions() {
    const tickers = [...this.desiredMarketTickers].slice(0, 1500);
    if (!tickers.length) return;
    await this.ensureConnected();
    await this.updateMarketSubscription("ticker", tickers);
    await this.updateMarketSubscription("orderbook_delta", tickers);
  }

  private async ensurePrivateSubscriptions() {
    await this.ensureConnected();
    for (const channel of ["user_orders", "fill", "market_positions", "order_group_updates"] as const) {
      const subscription = this.subscriptions.get(channel);
      if (!subscription?.sid) {
        await this.subscribeChannel(channel);
      }
    }
  }

  private async restoreSubscriptions() {
    const desiredTickers = [...this.desiredMarketTickers].slice(0, 1500);
    if (desiredTickers.length) {
      await this.subscribeChannel("ticker", desiredTickers);
      await this.subscribeChannel("orderbook_delta", desiredTickers);
    }

    if (this.privatePrimedAtMs > 0) {
      await this.subscribeChannel("user_orders");
      await this.subscribeChannel("fill");
      await this.subscribeChannel("market_positions");
      await this.subscribeChannel("order_group_updates");
    }
  }

  async primePublic(categories: PredictionCategory[], limit: number, extraTickers: string[] = []) {
    await this.seedPublic(categories, limit, extraTickers);
    await this.ensurePublicSubscriptions();
    return this.getPublicMarkets(categories, limit);
  }

  async primePrivate(extraQuoteTickers: string[] = []) {
    await this.seedPrivate(extraQuoteTickers);
    extraQuoteTickers.forEach((ticker) => this.desiredMarketTickers.add(ticker.toUpperCase()));
    if (this.desiredMarketTickers.size) {
      await this.ensurePublicSubscriptions();
    }
    await this.ensurePrivateSubscriptions();
    return this.getPrivateSnapshot(extraQuoteTickers);
  }

  getPublicMarkets(categories: PredictionCategory[], limit: number) {
    const allowed = new Set(categories);
    return [...this.marketStates.values()]
      .map((state) => state.market)
      .filter((market) => allowed.has(market.category))
      .filter((market) => market.status.toLowerCase() === "open" || market.status.toLowerCase() === "active")
      .slice(0, limit);
  }

  getPrivateSnapshot(extraQuoteTickers: string[] = []): StreamPrivateStateSnapshot {
    const tickers = Array.from(
      new Set([
        ...extraQuoteTickers.map((ticker) => ticker.toUpperCase()),
        ...[...this.orders.values()].map((order) => order.ticker.toUpperCase()),
        ...[...this.positions.values()].map((position) => position.ticker.toUpperCase()),
      ]),
    );

    const quotes: Record<string, KalshiQuoteLite> = {};
    for (const ticker of tickers) {
      const market = this.marketStates.get(ticker)?.market;
      if (!market) continue;
      quotes[ticker] = {
        ticker,
        title: market.title,
        marketStatus: market.status,
        yesBid: market.yesBid,
        yesAsk: market.yesAsk,
        noBid: market.noBid,
        noAsk: market.noAsk,
        lastPrice: market.lastPrice,
      };
    }

    return {
      orders: sortByTimestampDesc([...this.orders.values()], (row) => row.last_update_time ?? row.created_time),
      fills: sortByTimestampDesc([...this.fills.values()], (row) => row.created_time),
      positions: [...this.positions.values()],
      quotes,
    };
  }

  getStatus(): KalshiStreamStatus {
    return {
      connected: Boolean(this.socket && this.socket.readyState === WebSocket.OPEN),
      primedPublic: this.publicPrimedAtMs > 0,
      primedPrivate: this.privatePrimedAtMs > 0,
      lastMessageAt: this.lastMessageAtMs ? new Date(this.lastMessageAtMs).toISOString() : null,
      lastHeartbeatAt: this.lastHeartbeatAtMs ? new Date(this.lastHeartbeatAtMs).toISOString() : null,
      lastControlPingAt: this.lastControlPingAtMs ? new Date(this.lastControlPingAtMs).toISOString() : null,
      lastControlPongAt: this.lastControlPongAtMs ? new Date(this.lastControlPongAtMs).toISOString() : null,
      lastResyncAt: this.lastResyncAtMs ? new Date(this.lastResyncAtMs).toISOString() : null,
      reconnectCount: this.reconnectCount,
      desyncCount: this.desyncCount,
      reason: this.lastError,
      subscriptions: [...this.subscriptions.values()].map((subscription) => ({
        channel: subscription.channel,
        sid: subscription.sid,
        marketCount: subscription.marketTickers.size,
      })),
    };
  }

  async getSummary(extraQuoteTickers: string[] = []): Promise<StreamSummarySnapshot> {
    await this.primePrivate(extraQuoteTickers);
    const balances = await getKalshiDemoBalancesUsd();
    const privateSnapshot = this.getPrivateSnapshot(extraQuoteTickers);
    const status = kalshiConnectionStatus();

    return {
      connected: this.getStatus().connected,
      provider: status.provider,
      balanceUsd: balances.cashUsd ?? balances.portfolioUsd ?? null,
      cashUsd: balances.cashUsd ?? balances.portfolioUsd ?? null,
      portfolioUsd: balances.portfolioUsd ?? balances.cashUsd ?? null,
      ...privateSnapshot,
      stream: this.getStatus(),
      error: this.lastError,
    };
  }
}

const streamService = new KalshiStreamService();

export async function getKalshiOpenMarketsStream(categories: PredictionCategory[], limit = 150) {
  try {
    return await streamService.primePublic(categories, limit);
  } catch {
    return getKalshiOpenMarkets(categories, limit);
  }
}

export async function getKalshiPrivateStateStream(quoteTickers: string[] = []): Promise<StreamPrivateStateSnapshot> {
  try {
    return await streamService.primePrivate(quoteTickers);
  } catch {
    const [orders, fills, positions, quotes] = await Promise.all([
      getKalshiDemoOrders(500),
      getKalshiDemoFills(500),
      getKalshiDemoPositions(500),
      getKalshiMarketQuotes(quoteTickers),
    ]);
    return { orders, fills, positions, quotes };
  }
}

export async function getKalshiLiveSummaryStream(quoteTickers: string[] = []): Promise<StreamSummarySnapshot> {
  try {
    return await streamService.getSummary(quoteTickers);
  } catch (error) {
    const status = kalshiConnectionStatus();
    const [balances, orders, fills, positions, quotes] = await Promise.all([
      getKalshiDemoBalancesUsd(),
      getKalshiDemoOrders(500),
      getKalshiDemoFills(500),
      getKalshiDemoPositions(500),
      getKalshiMarketQuotes(quoteTickers),
    ]);
    return {
      connected: false,
      provider: status.provider,
      balanceUsd: balances.cashUsd ?? balances.portfolioUsd ?? null,
      cashUsd: balances.cashUsd ?? balances.portfolioUsd ?? null,
      portfolioUsd: balances.portfolioUsd ?? balances.cashUsd ?? null,
      orders,
      fills,
      positions,
      quotes,
      stream: streamService.getStatus(),
      error: (error as Error).message,
    };
  }
}

export function getKalshiStreamStatus() {
  return streamService.getStatus();
}
