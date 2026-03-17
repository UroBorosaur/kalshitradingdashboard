import "@/lib/server-only";

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import {
  formatKalshiCountFp,
  formatKalshiPriceDollars,
  normalizeKalshiPriceRanges,
  normalizeKalshiTickSizeCents,
  parseKalshiContractCount,
  parseKalshiMoneyUsd,
  parseKalshiNumber,
  parseKalshiProbability,
  probabilityToCents,
  snapContractCount,
} from "@/lib/prediction/fixed-point";
import type {
  KalshiFillLite,
  KalshiOrderGroupLite,
  KalshiOrderLite,
  KalshiOrderRequest,
  KalshiPositionLite,
  KalshiQuoteLite,
  PredictionCategory,
  PredictionMarketQuote,
} from "@/lib/prediction/types";

const DEFAULT_KALSHI_TRADING_BASE = "https://demo-api.kalshi.co/trade-api/v2";
const DEFAULT_KALSHI_MARKET_DATA_BASE = "https://demo-api.kalshi.co/trade-api/v2";
const DEFAULT_KALSHI_WS_BASE = "wss://demo-api.kalshi.co/trade-api/ws/v2";

function normalizeBase(raw: string | undefined, fallback: string): string {
  const base = (raw ?? fallback).trim();
  if (!base) return fallback;
  return base.replace(/\/+$/, "");
}

const KALSHI_TRADING_BASE_URL = normalizeBase(process.env.KALSHI_API_BASE_URL, DEFAULT_KALSHI_TRADING_BASE);
const KALSHI_MARKET_DATA_BASE_URL = normalizeBase(
  process.env.KALSHI_MARKET_DATA_BASE_URL,
  DEFAULT_KALSHI_MARKET_DATA_BASE,
);
const KALSHI_WS_BASE_URL = normalizeBase(process.env.KALSHI_WS_BASE_URL, DEFAULT_KALSHI_WS_BASE);
const KALSHI_KEY_ID = process.env.KALSHI_KEY_ID ?? "";
const KALSHI_PRIVATE_KEY_PATH = process.env.KALSHI_PRIVATE_KEY_PATH ?? "";

function normalizePemKey(raw: string): string {
  const trimmed = raw.trim().replace(/^['"]|['"]$/g, "");
  return trimmed.includes("\\n") ? trimmed.replace(/\\n/g, "\n") : trimmed;
}

function getKalshiPrivateKey(): string {
  const raw = process.env.KALSHI_PRIVATE_KEY ?? "";
  if (raw.trim()) return normalizePemKey(raw);

  if (KALSHI_PRIVATE_KEY_PATH && existsSync(KALSHI_PRIVATE_KEY_PATH)) {
    const fromFile = readFileSync(KALSHI_PRIVATE_KEY_PATH, "utf8");
    return normalizePemKey(fromFile);
  }

  return "";
}

function looksLikePemPrivateKey(key: string) {
  return key.includes("BEGIN") && key.includes("PRIVATE KEY");
}

function validatePrivateKeyForSigning(key: string): string | null {
  try {
    const parsed = crypto.createPrivateKey(key);
    if (parsed.asymmetricKeyType && parsed.asymmetricKeyType !== "rsa") {
      return `KALSHI_PRIVATE_KEY must be RSA (received ${parsed.asymmetricKeyType}).`;
    }
    return null;
  } catch {
    return "KALSHI_PRIVATE_KEY could not be parsed. Use full PEM key (or KALSHI_PRIVATE_KEY_PATH).";
  }
}

function credentialIssue(): string | null {
  if (!KALSHI_KEY_ID) return "KALSHI_KEY_ID is missing.";

  const key = getKalshiPrivateKey();
  if (!key) return "KALSHI_PRIVATE_KEY is missing (or KALSHI_PRIVATE_KEY_PATH is invalid).";
  if (!looksLikePemPrivateKey(key)) return "KALSHI_PRIVATE_KEY must be a full PEM private key.";
  const signingIssue = validatePrivateKeyForSigning(key);
  if (signingIssue) return signingIssue;

  return null;
}

function hasTradingCredentials() {
  return credentialIssue() === null;
}

function toNumber(value: unknown): number | null {
  return parseKalshiNumber(value);
}

function toContractCount(value: unknown): number | null {
  return parseKalshiContractCount(value);
}

function firstDefinedCents(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = toCents(value);
    if (typeof parsed === "number" && Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function firstDefinedCount(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = toContractCount(value);
    if (typeof parsed === "number" && Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function firstDefinedNumber(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function toProbability(value: unknown): number | null {
  return parseKalshiProbability(value);
}

function toCents(value: unknown): number | undefined {
  const raw = toNumber(value);
  if (raw === null) return undefined;
  return probabilityToCents(raw <= 1 ? raw : raw / 100);
}

function toFiniteString(value: unknown): string | undefined {
  const parsedMoney = parseKalshiMoneyUsd(value);
  if (parsedMoney !== null) return String(parsedMoney);
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function probFromCandidates(candidates: unknown[]): number | null {
  for (const candidate of candidates) {
    const parsed = toProbability(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
}

function inferCategory(raw: Record<string, unknown>): PredictionCategory {
  const explicit = String(raw.category ?? "").toLowerCase();
  if (explicit.includes("sport")) return "SPORTS";
  if (explicit.includes("weather") || explicit.includes("climate")) return "WEATHER";
  if (explicit.includes("crypto") || explicit.includes("bitcoin")) return "BITCOIN";
  if (explicit.includes("politic") || explicit.includes("election")) return "POLITICS";
  if (explicit.includes("esport") || explicit.includes("gaming")) return "ESPORTS";
  if (explicit.includes("stock") || explicit.includes("equity")) return "STOCKS";
  if (explicit.includes("macro") || explicit.includes("econom")) return "MACRO";

  const haystack = [raw.title, raw.subtitle, raw.event_ticker, raw.series_ticker, raw.ticker]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");

  if (/(bitcoin|btc|ethereum|eth|crypto)/.test(haystack)) return "BITCOIN";
  if (/(weather|temperature|rain|snow|storm|hurricane|wind|precip|freez|heat)/.test(haystack)) return "WEATHER";
  if (/(election|president|senate|house|governor|approval|primary|referendum|ballot)/.test(haystack)) return "POLITICS";
  if (/(esports|valorant|cs2|counter-strike|dota|league of legends|lol|map 1|bo3|bo5|matchup)/.test(haystack)) {
    return "ESPORTS";
  }
  if (/(stock|equity|nasdaq|s&p|dow|earnings|guidance|aapl|msft|nvda|tsla|qqq|spy)/.test(haystack)) return "STOCKS";
  if (/(fed|cpi|inflation|gdp|unemployment|rate cut|fomc|treasury|yield|macro)/.test(haystack)) return "MACRO";
  if (/(nba|nfl|mlb|nhl|ncaa|soccer|football|basketball|baseball|tennis|golf|match|vs\b|game)/.test(haystack)) {
    return "SPORTS";
  }

  return "OTHER";
}

function mapMarket(raw: Record<string, unknown>): PredictionMarketQuote | null {
  if (raw.is_provisional === true) return null;
  const marketType = String(raw.market_type ?? "binary").toLowerCase();
  if (marketType && marketType !== "binary") return null;
  const status = String(raw.status ?? "").toLowerCase();
  if (status && status !== "active" && status !== "open") return null;

  const ticker = String(raw.ticker ?? "").toUpperCase();
  const title = String(raw.title ?? "").trim();
  if (!ticker || !title) return null;

  const category = inferCategory(raw);

  const yesBid = probFromCandidates([raw.yes_bid_dollars, raw.yes_bid, raw.best_bid_yes]);
  const yesAsk = probFromCandidates([raw.yes_ask_dollars, raw.yes_ask, raw.best_ask_yes]);
  const noBid = probFromCandidates([raw.no_bid_dollars, raw.no_bid, raw.best_bid_no]);
  const noAsk = probFromCandidates([raw.no_ask_dollars, raw.no_ask, raw.best_ask_no]);
  const lastPrice = probFromCandidates([raw.last_price_dollars, raw.last_price, raw.previous_yes_price]);
  const yesBidSize = Math.max(0, toContractCount(raw.yes_bid_size_fp) ?? toContractCount(raw.best_bid_yes_size) ?? 0);
  const yesAskSize = Math.max(0, toContractCount(raw.yes_ask_size_fp) ?? toContractCount(raw.best_ask_yes_size) ?? 0);
  const noBidSize = Math.max(0, toContractCount(raw.no_bid_size_fp) ?? toContractCount(raw.best_bid_no_size) ?? 0);
  const noAskSize = Math.max(0, toContractCount(raw.no_ask_size_fp) ?? toContractCount(raw.best_ask_no_size) ?? 0);

  const yesTradable = yesAsk !== null && yesAsk > 0.01 && yesAsk < 0.99;
  const noTradable = noAsk !== null && noAsk > 0.01 && noAsk < 0.99;
  // Skip markets without a tradable side currently quoted in the book.
  if (!yesTradable && !noTradable) return null;

  const volume = Math.max(0, toNumber(raw.volume_fp) ?? toNumber(raw.volume_24h_fp) ?? toNumber(raw.volume) ?? 0);
  const openInterest = Math.max(0, toNumber(raw.open_interest_fp) ?? toNumber(raw.open_interest) ?? 0);
  const liquidityDollars = Math.max(0, toNumber(raw.liquidity_dollars) ?? 0);
  const tickSize = normalizeKalshiTickSizeCents(raw.tick_size_dollars ?? raw.tick_size ?? raw.min_tick_size);
  const settlementTimerSeconds = Math.max(0, Math.round(toNumber(raw.settlement_timer_seconds) ?? 0));
  const floorStrike = toNumber(raw.floor_strike);
  const notionalValue = Math.max(0, toNumber(raw.notional_value_dollars) ?? 1);

  return {
    ticker,
    title,
    subtitle: raw.subtitle ? String(raw.subtitle) : undefined,
    eventTicker: raw.event_ticker ? String(raw.event_ticker) : undefined,
    category,
    closeTime: raw.close_time ? String(raw.close_time) : null,
    expectedExpirationTime: raw.expected_expiration_time ? String(raw.expected_expiration_time) : null,
    latestExpirationTime: raw.latest_expiration_time ? String(raw.latest_expiration_time) : null,
    yesBid,
    yesAsk,
    noBid,
    noAsk,
    yesBidSize,
    yesAskSize,
    noBidSize,
    noAskSize,
    lastPrice,
    volume,
    openInterest,
    liquidityDollars,
    tickSize,
    priceLevelStructure: raw.price_level_structure ? String(raw.price_level_structure) : undefined,
    priceRanges: normalizeKalshiPriceRanges(raw.price_ranges),
    fractionalTradingEnabled: raw.fractional_trading_enabled === true,
    settlementTimerSeconds,
    rulesPrimary: raw.rules_primary ? String(raw.rules_primary) : undefined,
    rulesSecondary: raw.rules_secondary ? String(raw.rules_secondary) : undefined,
    strikeType: raw.strike_type ? String(raw.strike_type) : undefined,
    floorStrike,
    notionalValue,
    canCloseEarly: raw.can_close_early === true,
    status: String(raw.status ?? "unknown"),
  };
}

function signedHeaders(method: string, pathWithoutQuery: string): Record<string, string> {
  const timestamp = String(Date.now());
  const privateKey = getKalshiPrivateKey();

  const issue = credentialIssue();
  if (issue) {
    throw new Error(`Kalshi credentials invalid: ${issue}`);
  }

  // Kalshi signature format: timestamp + HTTP method + path (without query params).
  const payload = `${timestamp}${method.toUpperCase()}${pathWithoutQuery}`;
  const signature = crypto
    .sign("sha256", Buffer.from(payload), {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    })
    .toString("base64");

  return {
    "KALSHI-ACCESS-KEY": KALSHI_KEY_ID,
    "KALSHI-ACCESS-TIMESTAMP": timestamp,
    "KALSHI-ACCESS-SIGNATURE": signature,
  };
}

export function getKalshiSignedHeaders(method: string, pathWithoutQuery: string): Record<string, string> {
  return signedHeaders(method, pathWithoutQuery);
}

export function getKalshiWebSocketBaseUrl() {
  return KALSHI_WS_BASE_URL;
}

export function kalshiHasTradingCredentials() {
  return hasTradingCredentials();
}

async function kalshiRequest<T>(path: string, init?: RequestInit, authenticated = false): Promise<T> {
  return kalshiRequestWithBase(path, KALSHI_TRADING_BASE_URL, init, authenticated);
}

async function kalshiRequestWithBase<T>(
  path: string,
  baseUrl: string,
  init?: RequestInit,
  authenticated = false,
): Promise<T> {
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(normalizedPath, `${baseUrl}/`);
  const method = init?.method ?? "GET";
  const hasBody = typeof init?.body === "string" && init.body.length > 0;

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init?.headers ? (init.headers as Record<string, string>) : {}),
  };

  if (hasBody) headers["Content-Type"] = "application/json";

  if (authenticated) {
    Object.assign(headers, signedHeaders(method, url.pathname));
  }

  const response = await fetch(url.toString(), {
    ...init,
    method,
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kalshi request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

interface KalshiMarketsResponse {
  markets?: Record<string, unknown>[];
  cursor?: string;
}

interface KalshiSingleMarketResponse {
  market?: Record<string, unknown>;
}

function mapKalshiQuote(raw: Record<string, unknown>): KalshiQuoteLite | null {
  const ticker = String(raw.ticker ?? "").toUpperCase();
  if (!ticker) return null;

  const rawResult = String(raw.result ?? raw.settlement_result ?? raw.outcome ?? "").toLowerCase();
  const settlementResult =
    rawResult.includes("yes") || rawResult === "y"
      ? "yes"
      : rawResult.includes("no") || rawResult === "n"
        ? "no"
        : undefined;
  const settlementPrice = toProbability(
    firstDefinedNumber(
      toNumber(raw.settlement_price),
      toNumber(raw.settlement_price_dollars),
      toNumber(raw.final_yes_price),
      toNumber(raw.final_price),
      toNumber(raw.final_last_price),
      null,
    ),
  );

  return {
    ticker,
    title: raw.title ? String(raw.title).trim() : undefined,
    marketStatus: raw.status ? String(raw.status) : undefined,
    yesBid: probFromCandidates([raw.yes_bid_dollars, raw.yes_bid, raw.best_bid_yes]),
    yesAsk: probFromCandidates([raw.yes_ask_dollars, raw.yes_ask, raw.best_ask_yes]),
    noBid: probFromCandidates([raw.no_bid_dollars, raw.no_bid, raw.best_bid_no]),
    noAsk: probFromCandidates([raw.no_ask_dollars, raw.no_ask, raw.best_ask_no]),
    lastPrice: probFromCandidates([raw.last_price_dollars, raw.last_price, raw.previous_yes_price]),
    settlementResult,
    settlementPrice,
  };
}

export async function getKalshiOpenMarkets(categories: PredictionCategory[], limit = 150) {
  const wanted = new Set(categories);
  const filterByCategory = wanted.size > 0;
  const out: PredictionMarketQuote[] = [];

  let cursor = "";
  let page = 0;

  // Scan more pages because early pages can contain many non-actionable or pinned markets.
  while (out.length < limit && page < 12) {
    const params = new URLSearchParams({
      status: "open",
      limit: "200",
    });
    if (cursor) params.set("cursor", cursor);

    // Use the trading environment's market endpoint so selected tickers are executable in that same environment.
    const data = await kalshiRequestWithBase<KalshiMarketsResponse>(`/markets?${params.toString()}`, KALSHI_TRADING_BASE_URL);
    const rawMarkets = Array.isArray(data.markets) ? data.markets : [];

    for (const raw of rawMarkets) {
      const mapped = mapMarket(raw);
      if (!mapped) continue;
      if (filterByCategory && !wanted.has(mapped.category)) continue;
      out.push(mapped);
      if (out.length >= limit) break;
    }

    if (!data.cursor) break;
    cursor = data.cursor;
    page += 1;
  }

  const deduped = new Map<string, PredictionMarketQuote>();
  for (const market of out) deduped.set(market.ticker, market);

  return [...deduped.values()].slice(0, limit);
}

interface KalshiBalanceResponse {
  balance?: number;
  available_balance?: number;
  portfolio_value?: number;
}

function normalizeBalanceUsd(raw: number) {
  // Kalshi balance endpoints commonly return integer cents.
  // If decimal places are already present, treat as USD.
  if (Number.isInteger(raw)) return raw / 100;
  return raw;
}

function sanitizeClientOrderId(raw: string | undefined): string {
  const fallback = `gt-${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000)
    .toString(36)
    .padStart(4, "0")}`;
  const source = (raw ?? fallback).trim();
  const cleaned = source
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return cleaned || fallback;
}

function clampPriceCents(raw: number) {
  return Number(Math.min(99.9999, Math.max(0.0001, raw)).toFixed(4));
}

interface KalshiBalanceSnapshot {
  cashUsd: number | null;
  portfolioUsd: number | null;
}

export async function getKalshiDemoBalancesUsd(): Promise<KalshiBalanceSnapshot> {
  if (!hasTradingCredentials()) {
    return { cashUsd: null, portfolioUsd: null };
  }

  try {
    const response = await kalshiRequest<KalshiBalanceResponse>("/portfolio/balance", undefined, true);
    const rawBalance = toNumber(response.balance);
    const rawAvailable = toNumber(response.available_balance);
    const rawPortfolioValue = toNumber(response.portfolio_value);

    // Current demo payload semantics:
    // - balance: cash balance in cents
    // - portfolio_value: mark value of open positions in cents
    // Some environments may also expose available_balance.
    const cashRaw = rawAvailable ?? rawBalance;
    const portfolioRaw =
      rawPortfolioValue !== null && cashRaw !== null
        ? cashRaw + rawPortfolioValue
        : rawBalance ?? cashRaw;

    const cashUsd = cashRaw === null ? null : Number(normalizeBalanceUsd(cashRaw).toFixed(2));
    const portfolioUsd = portfolioRaw === null ? null : Number(normalizeBalanceUsd(portfolioRaw).toFixed(2));

    return { cashUsd, portfolioUsd };
  } catch {
    return { cashUsd: null, portfolioUsd: null };
  }
}

export async function getKalshiDemoBalanceUsd() {
  const balances = await getKalshiDemoBalancesUsd();
  return balances.cashUsd ?? balances.portfolioUsd;
}

export async function placeKalshiDemoOrder(order: KalshiOrderRequest) {
  const ticker = String(order.ticker ?? "").toUpperCase().trim();
  if (!ticker) throw new Error("Kalshi order rejected locally: ticker is required.");

  const side = order.side === "NO" ? "no" : "yes";
  const requestedCount = Number(Number(order.count) || 0);
  const requestedStep = Number(order.contractStep ?? 0);
  const contractStep = Math.max(
    0.01,
    Number.isFinite(requestedStep) && requestedStep > 0 ? requestedStep : requestedCount < 1 ? 0.01 : 1,
  );
  const count = Math.max(contractStep, snapContractCount(requestedCount, contractStep, "down"));
  const primaryPrice = clampPriceCents(Number(order.limitPriceCents));
  const clientOrderId = sanitizeClientOrderId(order.clientOrderId);

  function buildBody(priceCents: number, includeClientOrderId: boolean) {
    const body: Record<string, unknown> = {
      ticker,
      action: "buy",
      side,
      type: "limit",
      count_fp: formatKalshiCountFp(count),
    };
    if (order.orderGroupId?.trim()) body.order_group_id = order.orderGroupId.trim();
    if (Number.isInteger(count)) body.count = Math.max(1, Math.floor(count));
    if (includeClientOrderId) body.client_order_id = clientOrderId;
    const priceDollars = formatKalshiPriceDollars(priceCents / 100);
    if (side === "yes") {
      body.yes_price_dollars = priceDollars;
    } else {
      body.no_price_dollars = priceDollars;
    }
    return body;
  }

  async function submit(priceCents: number, includeClientOrderId: boolean, contractCount: number) {
    return kalshiRequest<Record<string, unknown>>(
      "/portfolio/orders",
      {
        method: "POST",
        body: JSON.stringify({
          ...buildBody(priceCents, includeClientOrderId),
          count_fp: formatKalshiCountFp(contractCount),
          ...(Math.abs(contractCount - Math.round(contractCount)) < 1e-9
            ? { count: Math.max(1, Math.floor(contractCount)) }
            : {}),
        }),
      },
      true,
    );
  }

  const countsToTry = [...new Set([count, Number(snapContractCount(contractStep, contractStep, "down").toFixed(6))])]
    .filter((contractCount) => Number.isFinite(contractCount) && contractCount >= contractStep)
    .sort((a, b) => b - a);
  const attempts: Array<{ priceCents: number; includeClientOrderId: boolean; contractCount: number }> = [];
  for (const contractCount of countsToTry) {
    attempts.push({ priceCents: primaryPrice, includeClientOrderId: true, contractCount });
    attempts.push({ priceCents: primaryPrice, includeClientOrderId: false, contractCount });
  }

  let lastError: Error | null = null;

  for (const attempt of attempts) {
    try {
      return await submit(attempt.priceCents, attempt.includeClientOrderId, attempt.contractCount);
    } catch (error) {
      const message = (error as Error).message.toLowerCase();
      lastError = error as Error;
      if (!message.includes("invalid_parameters") && !message.includes("invalid parameters")) {
        throw error;
      }
    }
  }

  // Last-chance retry using current market ask price in case stale/rounded price caused validation failure.
  try {
    const quotes = await getKalshiMarketQuotes([ticker]);
    const quote = quotes[ticker];
    const quotePrice = side === "yes" ? quote?.yesAsk : quote?.noAsk;
    if (typeof quotePrice === "number" && Number.isFinite(quotePrice)) {
      const fallbackPrice = clampPriceCents(quotePrice * 100);
      if (fallbackPrice !== primaryPrice) {
        for (const contractCount of countsToTry) {
          try {
            return await submit(fallbackPrice, false, contractCount);
          } catch (error) {
            const message = (error as Error).message.toLowerCase();
            lastError = error as Error;
            if (!message.includes("invalid_parameters") && !message.includes("invalid parameters")) {
              throw error;
            }
          }
        }
      }
    }
  } catch {
    // Ignore quote fetch errors and rethrow original order failure below.
  }

  const context = `ticker=${ticker} side=${side} count=${count} step=${contractStep} price=${primaryPrice}`;
  if (lastError) {
    throw new Error(`${lastError.message} | ${context}`);
  }
  throw new Error(`Kalshi order failed with invalid parameters. | ${context}`);
}

async function kalshiOrderMutation(
  paths: string[],
  initFactory: (path: string) => RequestInit,
): Promise<Record<string, unknown>> {
  let lastError: Error | null = null;
  for (const path of paths) {
    try {
      return await kalshiRequest<Record<string, unknown>>(path, initFactory(path), true);
    } catch (error) {
      lastError = error as Error;
      const message = lastError.message.toLowerCase();
      if (!message.includes("404") && !message.includes("405")) {
        throw error;
      }
    }
  }
  throw lastError ?? new Error("Kalshi order mutation failed.");
}

export async function cancelKalshiDemoOrder(orderId: string) {
  const encoded = encodeURIComponent(orderId);
  return kalshiOrderMutation(
    [
      `/portfolio/orders/${encoded}/cancel`,
      `/portfolio/orders/${encoded}`,
    ],
    (path) => ({
      method: path.endsWith("/cancel") ? "POST" : "DELETE",
      body: path.endsWith("/cancel") ? JSON.stringify({}) : undefined,
    }),
  );
}

function parseKalshiSide(raw: unknown): "yes" | "no" {
  const side = String(raw ?? "").toLowerCase();
  return side === "no" ? "no" : "yes";
}

const MARKET_TITLE_CACHE_TTL_MS = 10 * 60 * 1000;
const marketMetaCache = new Map<string, { title: string; marketStatus: string | null; expiresAt: number }>();

function getCachedMarketMeta(ticker: string): { title: string; marketStatus: string | null } | null {
  const key = ticker.toUpperCase();
  const cached = marketMetaCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    marketMetaCache.delete(key);
    return null;
  }
  return {
    title: cached.title,
    marketStatus: cached.marketStatus,
  };
}

function setCachedMarketMeta(ticker: string, title: string, marketStatus: string | null) {
  marketMetaCache.set(ticker.toUpperCase(), {
    title,
    marketStatus,
    expiresAt: Date.now() + MARKET_TITLE_CACHE_TTL_MS,
  });
}

async function getKalshiMarketMeta(ticker: string): Promise<{ title: string; marketStatus: string | null } | null> {
  const cached = getCachedMarketMeta(ticker);
  if (cached) return cached;

  try {
    const encoded = encodeURIComponent(ticker.toUpperCase());
    const response = await kalshiRequestWithBase<KalshiSingleMarketResponse>(
      `/markets/${encoded}`,
      KALSHI_TRADING_BASE_URL,
      undefined,
      false,
    );
    const market = response.market ?? null;
    if (!market) return null;

    const title = String(market.title ?? "").trim();
    const marketStatus = market.status ? String(market.status) : null;
    if (!title) return null;

    setCachedMarketMeta(ticker, title, marketStatus);
    return { title, marketStatus };
  } catch {
    return null;
  }
}

async function hydrateKalshiOrderMeta(orders: KalshiOrderLite[]): Promise<KalshiOrderLite[]> {
  if (!orders.length) return orders;

  const tickersNeedingMeta = Array.from(
    new Set(
      orders
        .filter((order) => !order.title || !order.market_status)
        .map((order) => order.ticker.toUpperCase()),
    ),
  );

  if (!tickersNeedingMeta.length) return orders;

  const resolved = await Promise.all(
    tickersNeedingMeta.map(async (ticker) => {
      const meta = await getKalshiMarketMeta(ticker);
      return [ticker, meta] as const;
    }),
  );

  const metaByTicker = new Map<string, { title: string; marketStatus: string | null }>();
  for (const [ticker, meta] of resolved) {
    if (meta) metaByTicker.set(ticker, meta);
  }

  return orders.map((order) => {
    const meta = metaByTicker.get(order.ticker.toUpperCase());
    if (!meta) return order;
    return {
      ...order,
      title: order.title ?? meta.title,
      market_status: order.market_status ?? (meta.marketStatus ?? undefined),
    };
  });
}

function mapKalshiOrder(raw: Record<string, unknown>): KalshiOrderLite | null {
  const orderId = String(raw.order_id ?? raw.id ?? "");
  const ticker = String(raw.ticker ?? "").toUpperCase();
  if (!orderId || !ticker) return null;

  const side = parseKalshiSide(raw.side);
  const action = String(raw.action ?? "");
  const count = firstDefinedCount(
    raw.count,
    raw.count_fp,
    raw.order_count,
    raw.initial_count,
    raw.initial_count_fp,
    raw.quantity,
    raw.contract_count,
    raw.filled_count,
    raw.fill_count_fp,
    raw.filled_count_fp,
    raw.match_count,
    raw.size,
    raw.yes_count,
    raw.no_count,
  ) ?? 0;
  const remainingCount = firstDefinedCount(
    raw.remaining_count,
    raw.remaining_count_fp,
    raw.remaining_quantity,
    raw.remaining,
    raw.open_count,
  );

  const explicitYes = firstDefinedCents(
    raw.yes_price,
    raw.yes_price_dollars,
    raw.yes_price_fixed,
    raw.yes_price_cents,
    raw.price_yes,
  );
  const explicitNo = firstDefinedCents(
    raw.no_price,
    raw.no_price_dollars,
    raw.no_price_fixed,
    raw.no_price_cents,
    raw.price_no,
  );
  const genericPrice = firstDefinedCents(
    raw.price,
    raw.limit_price,
    raw.avg_price,
    raw.average_price,
    raw.execution_price,
    raw.fill_price,
    raw.cost_per_contract,
  );
  const yesPrice = explicitYes ?? (side === "yes" ? genericPrice : (explicitNo !== undefined ? 100 - explicitNo : undefined));
  const noPrice = explicitNo ?? (side === "no" ? genericPrice : (explicitYes !== undefined ? 100 - explicitYes : undefined));

  return {
    order_id: orderId,
    client_order_id: raw.client_order_id ? String(raw.client_order_id) : undefined,
    order_group_id: raw.order_group_id ? String(raw.order_group_id) : undefined,
    ticker,
    title: raw.title ? String(raw.title) : undefined,
    market_status: raw.market_status ? String(raw.market_status) : undefined,
    side,
    action,
    status: String(raw.status ?? "unknown"),
    type: raw.type ? String(raw.type) : undefined,
    count,
    remaining_count: remainingCount ?? undefined,
    yes_price: yesPrice,
    no_price: noPrice,
    created_time: raw.created_time ? String(raw.created_time) : undefined,
    expiration_time: raw.expiration_time ? String(raw.expiration_time) : undefined,
    last_update_time: raw.last_update_time ? String(raw.last_update_time) : undefined,
  };
}

interface KalshiOrderGroupsResponse {
  order_groups?: Record<string, unknown>[];
  cursor?: string;
}

function mapKalshiOrderGroup(raw: Record<string, unknown>): KalshiOrderGroupLite | null {
  const orderGroupId = String(raw.order_group_id ?? raw.id ?? "").trim();
  if (!orderGroupId) return null;

  return {
    order_group_id: orderGroupId,
    contracts_limit: Math.max(
      0,
      Math.floor(
        firstDefinedNumber(
          toNumber(raw.contracts_limit),
          toNumber(raw.contracts_limit_fp),
          toNumber(raw.limit),
          null,
        ) ?? 0,
      ),
    ),
    is_auto_cancel_enabled: raw.is_auto_cancel_enabled !== false,
    status: raw.status ? String(raw.status) : undefined,
    order_ids: Array.isArray(raw.order_ids)
      ? raw.order_ids.filter((value): value is string => typeof value === "string")
      : undefined,
  };
}

function extractKalshiOrderGroupPayload(raw: Record<string, unknown>) {
  const nested = raw.order_group;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return raw;
}

async function kalshiOrderGroupMutation(
  paths: string[],
  initFactory: (path: string) => RequestInit,
): Promise<Record<string, unknown>> {
  let lastError: Error | null = null;

  for (const path of paths) {
    try {
      return await kalshiRequest<Record<string, unknown>>(path, initFactory(path), true);
    } catch (error) {
      lastError = error as Error;
      const message = lastError.message.toLowerCase();
      if (!message.includes("404") && !message.includes("405")) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("Kalshi order-group request failed.");
}

export async function getKalshiOrderGroups(limit = 200): Promise<KalshiOrderGroupLite[]> {
  if (!hasTradingCredentials()) return [];

  const safeLimit = Math.min(500, Math.max(1, Math.floor(limit)));
  const out: KalshiOrderGroupLite[] = [];
  let cursor = "";
  let pages = 0;

  while (out.length < safeLimit && pages < 8) {
    const params = new URLSearchParams({ limit: String(Math.min(100, safeLimit - out.length)) });
    if (cursor) params.set("cursor", cursor);

    const response = await kalshiRequest<KalshiOrderGroupsResponse>(`/portfolio/order_groups?${params.toString()}`, undefined, true);
    const rows = (Array.isArray(response.order_groups) ? response.order_groups : [])
      .map((row) => mapKalshiOrderGroup(row))
      .filter((row): row is KalshiOrderGroupLite => row !== null);

    out.push(...rows);

    if (!response.cursor || !rows.length) break;
    cursor = response.cursor;
    pages += 1;
  }

  return dedupeById(out, (row) => row.order_group_id).slice(0, safeLimit);
}

export async function createKalshiOrderGroup(contractsLimit: number) {
  const safeLimit = Math.max(1, Math.floor(contractsLimit));
  const response = await kalshiOrderGroupMutation(
    ["/portfolio/order_groups/create", "/portfolio/order_groups"],
    () => ({
      method: "POST",
      body: JSON.stringify({
        contracts_limit: safeLimit,
      }),
    }),
  );

  const mapped = mapKalshiOrderGroup(extractKalshiOrderGroupPayload(response));
  if (mapped) {
    return mapped.contracts_limit > 0
      ? mapped
      : {
          ...mapped,
          contracts_limit: safeLimit,
        };
  }
  throw new Error("Kalshi order group creation returned an invalid payload.");
}

export async function updateKalshiOrderGroupLimit(orderGroupId: string, contractsLimit: number) {
  const safeLimit = Math.max(1, Math.floor(contractsLimit));
  const encoded = encodeURIComponent(orderGroupId);
  const response = await kalshiOrderGroupMutation(
    [`/portfolio/order_groups/${encoded}/limit`, `/portfolio/order_groups/${encoded}`],
    (path) => ({
      method: path.endsWith("/limit") ? "PUT" : "POST",
      body: JSON.stringify({
        contracts_limit: safeLimit,
      }),
    }),
  );

  return mapKalshiOrderGroup(extractKalshiOrderGroupPayload(response)) ?? {
    order_group_id: orderGroupId,
    contracts_limit: safeLimit,
    is_auto_cancel_enabled: true,
  };
}

export async function resetKalshiOrderGroup(orderGroupId: string) {
  const encoded = encodeURIComponent(orderGroupId);
  await kalshiOrderGroupMutation(
    [`/portfolio/order_groups/${encoded}/reset`],
    () => ({
      method: "PUT",
      body: JSON.stringify({}),
    }),
  );
}

export async function triggerKalshiOrderGroup(orderGroupId: string) {
  const encoded = encodeURIComponent(orderGroupId);
  await kalshiOrderGroupMutation(
    [`/portfolio/order_groups/${encoded}/trigger`],
    () => ({
      method: "PUT",
      body: JSON.stringify({}),
    }),
  );
}

function mapKalshiFill(raw: Record<string, unknown>): KalshiFillLite | null {
  const fillId = String(raw.fill_id ?? raw.id ?? "");
  const orderId = String(raw.order_id ?? "");
  const ticker = String(raw.ticker ?? "").toUpperCase();
  if (!fillId || !orderId || !ticker) return null;

  const side = parseKalshiSide(raw.side);
  const action = String(raw.action ?? "");
  const count = firstDefinedCount(
    raw.count,
    raw.count_fp,
    raw.fill_count,
    raw.fill_count_fp,
    raw.quantity,
    raw.contract_count,
    raw.size,
    raw.match_count,
  ) ?? 0;

  const explicitYes = firstDefinedCents(
    raw.yes_price,
    raw.yes_price_dollars,
    raw.yes_price_fixed,
    raw.yes_price_cents,
    raw.price_yes,
  );
  const explicitNo = firstDefinedCents(
    raw.no_price,
    raw.no_price_dollars,
    raw.no_price_fixed,
    raw.no_price_cents,
    raw.price_no,
  );
  const genericPrice = firstDefinedCents(
    raw.price,
    raw.avg_price,
    raw.average_price,
    raw.execution_price,
    raw.fill_price,
    raw.cost_per_contract,
  );
  const yesPrice = explicitYes ?? (side === "yes" ? genericPrice : (explicitNo !== undefined ? 100 - explicitNo : undefined));
  const noPrice = explicitNo ?? (side === "no" ? genericPrice : (explicitYes !== undefined ? 100 - explicitYes : undefined));

  return {
    fill_id: fillId,
    order_id: orderId,
    ticker,
    side,
    action,
    count,
    yes_price: yesPrice,
    no_price: noPrice,
    created_time: raw.created_time ? String(raw.created_time) : undefined,
  };
}

interface KalshiOrdersResponse {
  orders?: Record<string, unknown>[];
  cursor?: string;
}

interface KalshiFillsResponse {
  fills?: Record<string, unknown>[];
  cursor?: string;
}

interface KalshiPositionsResponse {
  market_positions?: Record<string, unknown>[];
  positions?: Record<string, unknown>[];
  cursor?: string;
}

interface KalshiHistoricalCutoffResponse {
  orders_updated_ts?: number;
  trades_created_ts?: number;
}

function dedupeById<T>(rows: T[], keyFn: (row: T) => string): T[] {
  const map = new Map<string, T>();
  for (const row of rows) map.set(keyFn(row), row);
  return [...map.values()];
}

function mapKalshiPosition(raw: Record<string, unknown>): KalshiPositionLite | null {
  const ticker = String(raw.ticker ?? raw.market_ticker ?? "").toUpperCase();
  if (!ticker) return null;

  const position =
    toFiniteString(raw.position_fp) ??
    toFiniteString(raw.position) ??
    toFiniteString(raw.net_position) ??
    toFiniteString(raw.quantity_fp) ??
    toFiniteString(raw.quantity);
  if (!position) return null;

  return {
    ticker,
    position_fp: position,
    market_exposure_dollars:
      toFiniteString(raw.market_exposure_dollars) ?? toFiniteString(raw.market_exposure) ?? toFiniteString(raw.exposure),
    total_traded_dollars:
      toFiniteString(raw.total_traded_dollars) ?? toFiniteString(raw.total_traded) ?? toFiniteString(raw.cost_basis_dollars),
    realized_pnl_dollars: toFiniteString(raw.realized_pnl_dollars) ?? toFiniteString(raw.realized_pnl),
    fees_paid_dollars: toFiniteString(raw.fees_paid_dollars) ?? toFiniteString(raw.fees_paid),
    last_updated_ts: raw.last_updated_ts ? String(raw.last_updated_ts) : undefined,
    resting_orders_count: Math.max(0, Math.floor(toNumber(raw.resting_orders_count) ?? 0)),
  };
}

export async function getKalshiDemoPositions(limit = 200): Promise<KalshiPositionLite[]> {
  if (!hasTradingCredentials()) return [];

  const safeLimit = Math.max(1, Math.floor(limit));
  const out: KalshiPositionLite[] = [];
  let cursor = "";
  let pages = 0;

  while (out.length < safeLimit && pages < 8) {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);

    const response = await kalshiRequest<KalshiPositionsResponse>(`/portfolio/positions?${params.toString()}`, undefined, true);
    const rawRows = Array.isArray(response.market_positions)
      ? response.market_positions
      : (Array.isArray(response.positions) ? response.positions : []);

    const mappedRows = rawRows
      .map((row) => mapKalshiPosition(row))
      .filter((row): row is KalshiPositionLite => row !== null);

    out.push(...mappedRows);

    if (!response.cursor || mappedRows.length === 0) break;
    cursor = response.cursor;
    pages += 1;
  }

  return dedupeById(out, (row) => row.ticker).slice(0, safeLimit);
}

export async function getKalshiDemoOrders(limit = 100): Promise<KalshiOrderLite[]> {
  if (!hasTradingCredentials()) return [];

  const safeLimit = Math.min(500, Math.max(1, Math.floor(limit)));
  const liveRows: KalshiOrderLite[] = [];
  let cursor = "";
  let pages = 0;

  while (liveRows.length < safeLimit && pages < 12) {
    const perPage = Math.min(100, safeLimit - liveRows.length);
    const params = new URLSearchParams({ limit: String(perPage) });
    if (cursor) params.set("cursor", cursor);

    const live = await kalshiRequest<KalshiOrdersResponse>(`/portfolio/orders?${params.toString()}`, undefined, true);
    const rows = (Array.isArray(live.orders) ? live.orders : [])
      .map((row) => mapKalshiOrder(row))
      .filter((row): row is KalshiOrderLite => row !== null);

    liveRows.push(...rows);

    if (!live.cursor || rows.length === 0) break;
    cursor = live.cursor;
    pages += 1;
  }

  if (liveRows.length >= safeLimit) return hydrateKalshiOrderMeta(liveRows.slice(0, safeLimit));

  try {
    const cutoff = await kalshiRequest<KalshiHistoricalCutoffResponse>("/historical/cutoff", undefined, true);
    const historicalRows: KalshiOrderLite[] = [];
    let historicalCursor = "";
    let historicalPages = 0;

    while (liveRows.length + historicalRows.length < safeLimit && historicalPages < 12) {
      const perPage = Math.min(100, safeLimit - liveRows.length - historicalRows.length);
      const historicalParams = new URLSearchParams({ limit: String(perPage) });
      if (typeof cutoff.orders_updated_ts === "number") historicalParams.set("max_ts", String(cutoff.orders_updated_ts));
      if (historicalCursor) historicalParams.set("cursor", historicalCursor);

      const historical = await kalshiRequest<KalshiOrdersResponse>(
        `/historical/orders?${historicalParams.toString()}`,
        undefined,
        true,
      );

      const rows = (Array.isArray(historical.orders) ? historical.orders : [])
        .map((row) => mapKalshiOrder(row))
        .filter((row): row is KalshiOrderLite => row !== null);

      historicalRows.push(...rows);

      if (!historical.cursor || rows.length === 0) break;
      historicalCursor = historical.cursor;
      historicalPages += 1;
    }

    const merged = dedupeById([...liveRows, ...historicalRows], (row) => row.order_id).slice(0, safeLimit);
    return hydrateKalshiOrderMeta(merged);
  } catch {
    return hydrateKalshiOrderMeta(liveRows.slice(0, safeLimit));
  }
}

export async function getKalshiDemoFills(limit = 100): Promise<KalshiFillLite[]> {
  if (!hasTradingCredentials()) return [];

  const safeLimit = Math.min(500, Math.max(1, Math.floor(limit)));
  const liveRows: KalshiFillLite[] = [];
  let cursor = "";
  let pages = 0;

  while (liveRows.length < safeLimit && pages < 12) {
    const perPage = Math.min(100, safeLimit - liveRows.length);
    const params = new URLSearchParams({ limit: String(perPage) });
    if (cursor) params.set("cursor", cursor);

    const live = await kalshiRequest<KalshiFillsResponse>(`/portfolio/fills?${params.toString()}`, undefined, true);
    const rows = (Array.isArray(live.fills) ? live.fills : [])
      .map((row) => mapKalshiFill(row))
      .filter((row): row is KalshiFillLite => row !== null);

    liveRows.push(...rows);

    if (!live.cursor || rows.length === 0) break;
    cursor = live.cursor;
    pages += 1;
  }

  if (liveRows.length >= safeLimit) return liveRows.slice(0, safeLimit);

  try {
    const cutoff = await kalshiRequest<KalshiHistoricalCutoffResponse>("/historical/cutoff", undefined, true);
    const historicalRows: KalshiFillLite[] = [];
    let historicalCursor = "";
    let historicalPages = 0;

    while (liveRows.length + historicalRows.length < safeLimit && historicalPages < 12) {
      const perPage = Math.min(100, safeLimit - liveRows.length - historicalRows.length);
      const historicalParams = new URLSearchParams({ limit: String(perPage) });
      if (typeof cutoff.trades_created_ts === "number") historicalParams.set("max_ts", String(cutoff.trades_created_ts));
      if (historicalCursor) historicalParams.set("cursor", historicalCursor);

      const historical = await kalshiRequest<KalshiFillsResponse>(
        `/historical/fills?${historicalParams.toString()}`,
        undefined,
        true,
      );

      const rows = (Array.isArray(historical.fills) ? historical.fills : [])
        .map((row) => mapKalshiFill(row))
        .filter((row): row is KalshiFillLite => row !== null);

      historicalRows.push(...rows);

      if (!historical.cursor || rows.length === 0) break;
      historicalCursor = historical.cursor;
      historicalPages += 1;
    }

    return dedupeById([...liveRows, ...historicalRows], (row) => row.fill_id).slice(0, safeLimit);
  } catch {
    return liveRows.slice(0, safeLimit);
  }
}

export async function getKalshiMarketQuotes(tickers: string[]): Promise<Record<string, KalshiQuoteLite>> {
  const uniqueTickers = Array.from(
    new Set(
      tickers
        .map((ticker) => String(ticker ?? "").toUpperCase().trim())
        .filter(Boolean),
    ),
  ).slice(0, 120);

  if (!uniqueTickers.length) return {};

  const entries = await Promise.all(
    uniqueTickers.map(async (ticker) => {
      try {
        const encoded = encodeURIComponent(ticker);
        const response = await kalshiRequestWithBase<KalshiSingleMarketResponse>(
          `/markets/${encoded}`,
          KALSHI_TRADING_BASE_URL,
          undefined,
          false,
        );
        const quote = response.market ? mapKalshiQuote(response.market) : null;
        return quote ? ([ticker, quote] as const) : null;
      } catch {
        return null;
      }
    }),
  );

  const out: Record<string, KalshiQuoteLite> = {};
  for (const entry of entries) {
    if (!entry) continue;
    const [ticker, quote] = entry;
    out[ticker] = quote;
  }

  return out;
}

export function kalshiConnectionStatus() {
  return {
    connected: hasTradingCredentials(),
    provider: "kalshi-demo",
    baseUrl: KALSHI_TRADING_BASE_URL,
    marketDataBaseUrl: KALSHI_MARKET_DATA_BASE_URL,
    reason: credentialIssue(),
  };
}
