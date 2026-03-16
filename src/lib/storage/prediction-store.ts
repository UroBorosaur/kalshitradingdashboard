import "@/lib/server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  appendPredictionEvents,
  loadStorageState,
  readPredictionEventsForDay,
  readPredictionEventsSince,
  saveStorageState,
  withStorageStateWriter,
} from "@/lib/storage/jsonl";
import type {
  PredictionReplayDay,
  PredictionReplayEvent,
  PredictionStorageEnvelope,
  StoredCandidateDecisionEvent,
  StoredKalshiBalanceEvent,
  StoredKalshiFillEvent,
  StoredKalshiOrderEvent,
  StoredKalshiPositionEvent,
  StoredKalshiQuoteEvent,
  StoredKalshiStreamEvent,
  StoredMarkoutEvent,
  StoredOrderbookEvent,
  StoredResolutionEvent,
} from "@/lib/storage/types";
import { toStoredCandidateDecisionPayload } from "@/lib/storage/types";
import type { AutomationMode, KalshiFillLite, KalshiOrderLite, KalshiPositionLite, KalshiQuoteLite, PredictionCandidate, PredictionMarketQuote } from "@/lib/prediction/types";

const SCHEMA_VERSION = 1;
const STATE_NAME = "prediction-ingestion";
const FILL_STATE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const HASH_STATE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RESOLUTION_STATE_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_FILL_STATE_ENTRIES = 20_000;
const MAX_HASH_STATE_ENTRIES = 50_000;
const MAX_RESOLUTION_STATE_ENTRIES = 10_000;

interface TimestampedHashState {
  hash: string;
  updatedAtMs: number;
}

interface TimestampedResolutionState {
  key: string;
  updatedAtMs: number;
}

interface PredictionIngestionState {
  stateVersion: number;
  seenFillIds: Record<string, number>;
  resolutionKeys: Record<string, TimestampedResolutionState>;
  latestHashes: Record<string, TimestampedHashState>;
}

function defaultState(): PredictionIngestionState {
  return {
    stateVersion: 2,
    seenFillIds: {},
    resolutionKeys: {},
    latestHashes: {},
  };
}

function hashPayload(payload: unknown) {
  return createHash("sha1").update(JSON.stringify(payload)).digest("hex");
}

function normalizeIngestionState(rawState: unknown): PredictionIngestionState {
  const fallback = defaultState();
  if (!rawState || typeof rawState !== "object") return fallback;

  const candidate = rawState as {
    stateVersion?: number;
    seenFillIds?: Record<string, boolean | number>;
    resolutionKeys?: Record<string, string | TimestampedResolutionState>;
    latestHashes?: Record<string, string | TimestampedHashState>;
  };

  const seenFillIds = Object.fromEntries(
    Object.entries(candidate.seenFillIds ?? {}).map(([key, value]) => [
      key,
      typeof value === "number" && Number.isFinite(value) ? value : Date.now(),
    ]),
  );
  const resolutionKeys = Object.fromEntries(
    Object.entries(candidate.resolutionKeys ?? {}).map(([key, value]) => [
      key,
      typeof value === "string"
        ? { key: value, updatedAtMs: Date.now() }
        : {
            key: value?.key ?? "",
            updatedAtMs: Number.isFinite(value?.updatedAtMs) ? value.updatedAtMs : Date.now(),
          },
    ]),
  );
  const latestHashes = Object.fromEntries(
    Object.entries(candidate.latestHashes ?? {}).map(([key, value]) => [
      key,
      typeof value === "string"
        ? { hash: value, updatedAtMs: Date.now() }
        : {
            hash: value?.hash ?? "",
            updatedAtMs: Number.isFinite(value?.updatedAtMs) ? value.updatedAtMs : Date.now(),
          },
    ]),
  );

  return {
    stateVersion: 2,
    seenFillIds,
    resolutionKeys,
    latestHashes,
  };
}

function pruneTimestampedRecord<TEntry extends { updatedAtMs: number }>(
  record: Record<string, TEntry>,
  minUpdatedAtMs: number,
  maxEntries: number,
) {
  const entries = Object.entries(record)
    .filter(([, value]) => Number.isFinite(value.updatedAtMs) && value.updatedAtMs >= minUpdatedAtMs)
    .sort((a, b) => b[1].updatedAtMs - a[1].updatedAtMs);

  return Object.fromEntries(entries.slice(0, maxEntries));
}

function pruneFillState(record: Record<string, number>, minUpdatedAtMs: number, maxEntries: number) {
  const entries = Object.entries(record)
    .filter(([, updatedAtMs]) => Number.isFinite(updatedAtMs) && updatedAtMs >= minUpdatedAtMs)
    .sort((a, b) => b[1] - a[1]);

  return Object.fromEntries(entries.slice(0, maxEntries));
}

function compactIngestionState(state: PredictionIngestionState, nowMs = Date.now()): PredictionIngestionState {
  return {
    stateVersion: 2,
    seenFillIds: pruneFillState(state.seenFillIds, nowMs - FILL_STATE_RETENTION_MS, MAX_FILL_STATE_ENTRIES),
    resolutionKeys: pruneTimestampedRecord(
      state.resolutionKeys,
      nowMs - RESOLUTION_STATE_RETENTION_MS,
      MAX_RESOLUTION_STATE_ENTRIES,
    ),
    latestHashes: pruneTimestampedRecord(
      state.latestHashes,
      nowMs - HASH_STATE_RETENTION_MS,
      MAX_HASH_STATE_ENTRIES,
    ),
  };
}

function makeEnvelope<TPayload>(
  stream: PredictionStorageEnvelope<TPayload>["stream"],
  layer: PredictionStorageEnvelope<TPayload>["layer"],
  source: string,
  entityKey: string,
  payload: TPayload,
): PredictionStorageEnvelope<TPayload> {
  return {
    id: randomUUID(),
    stream,
    layer,
    schemaVersion: SCHEMA_VERSION,
    recordedAt: new Date().toISOString(),
    source,
    entityKey,
    payload,
  };
}

function normalizeQuotePayload(quote: PredictionMarketQuote | KalshiQuoteLite): StoredKalshiQuoteEvent {
  const isFullMarket = "category" in quote;
  return {
    ticker: quote.ticker.toUpperCase(),
    title: quote.title,
    marketStatus: isFullMarket ? quote.status : quote.marketStatus,
    category: isFullMarket ? quote.category : undefined,
    eventTicker: isFullMarket ? quote.eventTicker : undefined,
    closeTime: isFullMarket ? quote.closeTime : undefined,
    expectedExpirationTime: isFullMarket ? quote.expectedExpirationTime : undefined,
    latestExpirationTime: isFullMarket ? quote.latestExpirationTime : undefined,
    yesBid: quote.yesBid,
    yesAsk: quote.yesAsk,
    noBid: quote.noBid,
    noAsk: quote.noAsk,
    lastPrice: quote.lastPrice,
    volume: isFullMarket ? quote.volume : undefined,
    openInterest: isFullMarket ? quote.openInterest : undefined,
    liquidityDollars: isFullMarket ? quote.liquidityDollars : undefined,
    tickSize: isFullMarket ? quote.tickSize : undefined,
    settlementResult: "settlementResult" in quote ? quote.settlementResult : undefined,
    settlementPrice: "settlementPrice" in quote ? quote.settlementPrice : undefined,
  };
}

function normalizeOrderPayload(order: KalshiOrderLite): StoredKalshiOrderEvent {
  return {
    orderId: order.order_id,
    clientOrderId: order.client_order_id,
    orderGroupId: order.order_group_id,
    ticker: order.ticker.toUpperCase(),
    title: order.title,
    marketStatus: order.market_status,
    side: order.side,
    action: order.action,
    status: order.status,
    type: order.type,
    count: order.count,
    remainingCount: order.remaining_count,
    yesPriceCents: order.yes_price,
    noPriceCents: order.no_price,
    createdTime: order.created_time,
    expirationTime: order.expiration_time,
    lastUpdateTime: order.last_update_time,
  };
}

function normalizeFillPayload(fill: KalshiFillLite): StoredKalshiFillEvent {
  return {
    fillId: fill.fill_id,
    orderId: fill.order_id,
    ticker: fill.ticker.toUpperCase(),
    side: fill.side,
    action: fill.action,
    count: fill.count,
    yesPriceCents: fill.yes_price,
    noPriceCents: fill.no_price,
    createdTime: fill.created_time,
  };
}

function normalizePositionPayload(position: KalshiPositionLite): StoredKalshiPositionEvent {
  return {
    ticker: position.ticker.toUpperCase(),
    positionFp: position.position_fp,
    marketExposureDollars: position.market_exposure_dollars,
    totalTradedDollars: position.total_traded_dollars,
    realizedPnlDollars: position.realized_pnl_dollars,
    feesPaidDollars: position.fees_paid_dollars,
    lastUpdatedTs: position.last_updated_ts,
    restingOrdersCount: position.resting_orders_count,
  };
}

function normalizeBalancePayload(args: {
  balanceUsd?: number | null;
  cashUsd?: number | null;
  portfolioUsd?: number | null;
}): StoredKalshiBalanceEvent {
  return {
    balanceUsd: typeof args.balanceUsd === "number" && Number.isFinite(args.balanceUsd) ? Number(args.balanceUsd.toFixed(4)) : null,
    cashUsd: typeof args.cashUsd === "number" && Number.isFinite(args.cashUsd) ? Number(args.cashUsd.toFixed(4)) : null,
    portfolioUsd:
      typeof args.portfolioUsd === "number" && Number.isFinite(args.portfolioUsd) ? Number(args.portfolioUsd.toFixed(4)) : null,
  };
}

function normalizeOrderbookPayload(market: PredictionMarketQuote): StoredOrderbookEvent {
  return {
    ticker: market.ticker.toUpperCase(),
    title: market.title,
    category: market.category,
    eventTicker: market.eventTicker,
    eventType: "snapshot",
    yesBid: market.yesBid,
    yesAsk: market.yesAsk,
    noBid: market.noBid,
    noAsk: market.noAsk,
    yesBidSize: market.yesBidSize,
    yesAskSize: market.yesAskSize,
    noBidSize: market.noBidSize,
    noAskSize: market.noAskSize,
    lastPrice: market.lastPrice,
    volume: market.volume,
    openInterest: market.openInterest,
    liquidityDollars: market.liquidityDollars,
    tickSize: market.tickSize,
    status: market.status,
  };
}

async function withState<T>(fn: (state: PredictionIngestionState) => Promise<T>) {
  return withStorageStateWriter(STATE_NAME, async () => {
    const loadedState = await loadStorageState<PredictionIngestionState>(STATE_NAME, defaultState());
    const state = compactIngestionState(normalizeIngestionState(loadedState));
    const result = await fn(state);
    await saveStorageState(STATE_NAME, compactIngestionState(state));
    return result;
  });
}

export async function persistKalshiSummarySnapshot(args: {
  balanceUsd?: number | null;
  cashUsd?: number | null;
  portfolioUsd?: number | null;
  orders: KalshiOrderLite[];
  fills: KalshiFillLite[];
  positions: KalshiPositionLite[];
  quotes: Record<string, KalshiQuoteLite>;
  source: string;
}) {
  await withState(async (state) => {
    const nowMs = Date.now();
    const orderEvents: Array<PredictionStorageEnvelope<StoredKalshiOrderEvent>> = [];
    const fillEvents: Array<PredictionStorageEnvelope<StoredKalshiFillEvent>> = [];
    const balanceEvents: Array<PredictionStorageEnvelope<StoredKalshiBalanceEvent>> = [];
    const positionEvents: Array<PredictionStorageEnvelope<StoredKalshiPositionEvent>> = [];
    const quoteEvents: Array<PredictionStorageEnvelope<StoredKalshiQuoteEvent>> = [];
    const resolutionEvents: Array<PredictionStorageEnvelope<StoredResolutionEvent>> = [];

    const balancePayload = normalizeBalancePayload({
      balanceUsd: args.balanceUsd,
      cashUsd: args.cashUsd,
      portfolioUsd: args.portfolioUsd,
    });
    if (
      balancePayload.balanceUsd !== null ||
      balancePayload.cashUsd !== null ||
      balancePayload.portfolioUsd !== null
    ) {
      balanceEvents.push(makeEnvelope("balances", "raw", args.source, `balance:${nowMs}`, balancePayload));
    }

    for (const order of args.orders) {
      const payload = normalizeOrderPayload(order);
      const entityKey = `order:${payload.orderId}`;
      const hash = hashPayload(payload);
      if (state.latestHashes[entityKey]?.hash === hash) continue;
      state.latestHashes[entityKey] = { hash, updatedAtMs: nowMs };
      orderEvents.push(makeEnvelope("orders", "raw", args.source, entityKey, payload));
    }

    for (const fill of args.fills) {
      const payload = normalizeFillPayload(fill);
      const entityKey = `fill:${payload.fillId}`;
      if (state.seenFillIds[payload.fillId]) continue;
      state.seenFillIds[payload.fillId] = nowMs;
      fillEvents.push(makeEnvelope("fills", "raw", args.source, entityKey, payload));
    }

    for (const position of args.positions) {
      const payload = normalizePositionPayload(position);
      const entityKey = `position:${payload.ticker}`;
      const hash = hashPayload(payload);
      if (state.latestHashes[entityKey]?.hash === hash) continue;
      state.latestHashes[entityKey] = { hash, updatedAtMs: nowMs };
      positionEvents.push(makeEnvelope("positions", "raw", args.source, entityKey, payload));
    }

    for (const quote of Object.values(args.quotes)) {
      const payload = normalizeQuotePayload(quote);
      const entityKey = `quote:summary:${payload.ticker}`;
      const hash = hashPayload(payload);
      if (state.latestHashes[entityKey]?.hash !== hash) {
        state.latestHashes[entityKey] = { hash, updatedAtMs: nowMs };
        quoteEvents.push(makeEnvelope("quotes", "raw", args.source, entityKey, payload));
      }

      if (payload.settlementResult || (payload.marketStatus ?? "").toLowerCase().includes("settled")) {
        const resolutionKey = `${payload.ticker}:${payload.settlementResult ?? payload.marketStatus ?? "resolved"}`;
        if (state.resolutionKeys[payload.ticker]?.key !== resolutionKey) {
          state.resolutionKeys[payload.ticker] = { key: resolutionKey, updatedAtMs: nowMs };
          resolutionEvents.push(
            makeEnvelope("resolutions", "raw", args.source, `resolution:${payload.ticker}`, {
              ticker: payload.ticker,
              title: payload.title,
              status: payload.marketStatus ?? "resolved",
              settlementResult: payload.settlementResult,
              settlementPrice: payload.settlementPrice,
              resolvedAt: new Date().toISOString(),
            }),
          );
        }
      }
    }

    await Promise.all([
      appendPredictionEvents("raw", "orders", orderEvents),
      appendPredictionEvents("raw", "fills", fillEvents),
      appendPredictionEvents("raw", "balances", balanceEvents),
      appendPredictionEvents("raw", "positions", positionEvents),
      appendPredictionEvents("raw", "quotes", quoteEvents),
      appendPredictionEvents("raw", "resolutions", resolutionEvents),
    ]);
  });
}

export async function persistKalshiBalanceSnapshot(args: {
  balanceUsd?: number | null;
  cashUsd?: number | null;
  portfolioUsd?: number | null;
  source: string;
}) {
  const payload = normalizeBalancePayload(args);
  if (payload.balanceUsd === null && payload.cashUsd === null && payload.portfolioUsd === null) return;
  await appendPredictionEvents("raw", "balances", [
    makeEnvelope("balances", "raw", args.source, `balance:${Date.now()}`, payload),
  ]);
}

export async function persistMarketScan(args: {
  markets: PredictionMarketQuote[];
  source: string;
}) {
  await withState(async (state) => {
    const nowMs = Date.now();
    const quoteEvents: Array<PredictionStorageEnvelope<StoredKalshiQuoteEvent>> = [];
    const orderbookEvents: Array<PredictionStorageEnvelope<StoredOrderbookEvent>> = [];
    const resolutionEvents: Array<PredictionStorageEnvelope<StoredResolutionEvent>> = [];

    for (const market of args.markets) {
      const quotePayload = normalizeQuotePayload(market);
      const quoteKey = `quote:scan:${quotePayload.ticker}`;
      const quoteHash = hashPayload(quotePayload);
      if (state.latestHashes[quoteKey]?.hash !== quoteHash) {
        state.latestHashes[quoteKey] = { hash: quoteHash, updatedAtMs: nowMs };
        quoteEvents.push(makeEnvelope("quotes", "raw", args.source, quoteKey, quotePayload));
      }

      const bookPayload = normalizeOrderbookPayload(market);
      const bookKey = `book:${bookPayload.ticker}`;
      const bookHash = hashPayload(bookPayload);
      if (state.latestHashes[bookKey]?.hash !== bookHash) {
        state.latestHashes[bookKey] = { hash: bookHash, updatedAtMs: nowMs };
        orderbookEvents.push(makeEnvelope("orderbook_events", "raw", args.source, bookKey, bookPayload));
      }

      if ((market.status ?? "").toLowerCase().includes("settled")) {
        const resolutionKey = `${market.ticker}:${market.status}`;
        if (state.resolutionKeys[market.ticker]?.key !== resolutionKey) {
          state.resolutionKeys[market.ticker] = { key: resolutionKey, updatedAtMs: nowMs };
          resolutionEvents.push(
            makeEnvelope("resolutions", "raw", args.source, `resolution:${market.ticker}`, {
              ticker: market.ticker,
              title: market.title,
              status: market.status,
              settlementResult: undefined,
              settlementPrice: market.lastPrice,
              resolvedAt: new Date().toISOString(),
            }),
          );
        }
      }
    }

    await Promise.all([
      appendPredictionEvents("raw", "quotes", quoteEvents),
      appendPredictionEvents("raw", "orderbook_events", orderbookEvents),
      appendPredictionEvents("raw", "resolutions", resolutionEvents),
    ]);
  });
}

export async function persistCandidateDecisions(args: {
  runId: string;
  mode: AutomationMode;
  executeRequested: boolean;
  candidates: PredictionCandidate[];
  source: string;
}) {
  const events = args.candidates.map((candidate) =>
    makeEnvelope<StoredCandidateDecisionEvent>(
      "candidate_decisions",
      "raw",
      args.source,
      `decision:${args.runId}:${candidate.ticker}:${candidate.side}`,
      toStoredCandidateDecisionPayload(args.runId, args.mode, args.executeRequested, candidate),
    ),
  );
  await appendPredictionEvents("raw", "candidate_decisions", events);
}

export async function persistStreamEvents(args: {
  source: string;
  events: StoredKalshiStreamEvent[];
}) {
  const envelopes = args.events.map((payload, index) =>
    makeEnvelope<StoredKalshiStreamEvent>(
      "stream_events",
      "raw",
      args.source,
      `stream:${payload.eventType}:${payload.marketTicker ?? payload.channel ?? "global"}:${payload.sid ?? "na"}:${payload.seq ?? index}`,
      payload,
    ),
  );
  await appendPredictionEvents("raw", "stream_events", envelopes);
}

export async function readStoredMarkoutsSince(sinceMs: number) {
  return readPredictionEventsSince<StoredMarkoutEvent>("derived", "markouts", sinceMs);
}

export async function readStoredCandidateDecisionsSince(sinceMs: number) {
  return readPredictionEventsSince<StoredCandidateDecisionEvent>("raw", "candidate_decisions", sinceMs);
}

export async function readStoredOrdersSince(sinceMs: number) {
  return readPredictionEventsSince<StoredKalshiOrderEvent>("raw", "orders", sinceMs);
}

export async function readStoredFillsSince(sinceMs: number) {
  return readPredictionEventsSince<StoredKalshiFillEvent>("raw", "fills", sinceMs);
}

export async function readStoredBalancesSince(sinceMs: number) {
  return readPredictionEventsSince<StoredKalshiBalanceEvent>("raw", "balances", sinceMs);
}

export async function readStoredQuotesSince(sinceMs: number) {
  return readPredictionEventsSince<StoredKalshiQuoteEvent>("raw", "quotes", sinceMs);
}

export async function readStoredResolutionsSince(sinceMs: number) {
  return readPredictionEventsSince<StoredResolutionEvent>("raw", "resolutions", sinceMs);
}

export async function persistMarkoutEvents(
  source: string,
  markouts: StoredMarkoutEvent[],
) {
  const events = markouts.map((payload) =>
    makeEnvelope<StoredMarkoutEvent>(
      "markouts",
      "derived",
      source,
      `markout:${payload.fillId}:${payload.horizon}`,
      payload,
    ),
  );
  await appendPredictionEvents("derived", "markouts", events);
}

export async function loadPredictionReplayDay(day: string): Promise<PredictionReplayDay> {
  const [
    streamEvents,
    fills,
    orders,
    balances,
    positions,
    quotes,
    orderbookEvents,
    candidateDecisions,
    resolutions,
    markouts,
  ] = await Promise.all([
    readPredictionEventsForDay<StoredKalshiStreamEvent>("raw", "stream_events", day),
    readPredictionEventsForDay<StoredKalshiFillEvent>("raw", "fills", day),
    readPredictionEventsForDay<StoredKalshiOrderEvent>("raw", "orders", day),
    readPredictionEventsForDay<StoredKalshiBalanceEvent>("raw", "balances", day),
    readPredictionEventsForDay<StoredKalshiPositionEvent>("raw", "positions", day),
    readPredictionEventsForDay<StoredKalshiQuoteEvent>("raw", "quotes", day),
    readPredictionEventsForDay<StoredOrderbookEvent>("raw", "orderbook_events", day),
    readPredictionEventsForDay<StoredCandidateDecisionEvent>("raw", "candidate_decisions", day),
    readPredictionEventsForDay<StoredResolutionEvent>("raw", "resolutions", day),
    readPredictionEventsForDay<StoredMarkoutEvent>("derived", "markouts", day),
  ]);

  return {
    streamEvents,
    fills,
    orders,
    balances,
    positions,
    quotes,
    orderbookEvents,
    candidateDecisions,
    resolutions,
    markouts,
  };
}

const REPLAY_STREAM_ORDER: Record<PredictionReplayEvent["stream"], number> = {
  stream_events: 0,
  fills: 1,
  orders: 2,
  balances: 3,
  positions: 4,
  quotes: 5,
  orderbook_events: 6,
  candidate_decisions: 7,
  resolutions: 8,
  markouts: 9,
};

function compareReplayEvents(a: PredictionReplayEvent, b: PredictionReplayEvent) {
  const recordedAtDelta = new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime();
  if (recordedAtDelta !== 0) return recordedAtDelta;

  if (a.layer !== b.layer) return a.layer.localeCompare(b.layer);

  const streamDelta = REPLAY_STREAM_ORDER[a.stream] - REPLAY_STREAM_ORDER[b.stream];
  if (streamDelta !== 0) return streamDelta;

  const entityKeyDelta = a.entityKey.localeCompare(b.entityKey);
  if (entityKeyDelta !== 0) return entityKeyDelta;

  return a.id.localeCompare(b.id);
}

export async function loadPredictionReplayTimeline(day: string): Promise<PredictionReplayEvent[]> {
  const replayDay = await loadPredictionReplayDay(day);
  return [
    ...replayDay.streamEvents,
    ...replayDay.fills,
    ...replayDay.orders,
    ...replayDay.balances,
    ...replayDay.positions,
    ...replayDay.quotes,
    ...replayDay.orderbookEvents,
    ...replayDay.candidateDecisions,
    ...replayDay.resolutions,
    ...replayDay.markouts,
  ].sort(compareReplayEvents);
}

export async function* iteratePredictionReplayDay(day: string): AsyncGenerator<PredictionReplayEvent> {
  const timeline = await loadPredictionReplayTimeline(day);
  for (const event of timeline) {
    yield event;
  }
}
