import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { appendPredictionEvents, loadStorageState, readPredictionEventsForDay, readPredictionEventsSince, saveStorageState } from "@/lib/storage/jsonl";
import type {
  PredictionReplayDay,
  PredictionStorageEnvelope,
  StoredCandidateDecisionEvent,
  StoredKalshiFillEvent,
  StoredKalshiOrderEvent,
  StoredKalshiPositionEvent,
  StoredKalshiQuoteEvent,
  StoredMarkoutEvent,
  StoredOrderbookEvent,
  StoredResolutionEvent,
} from "@/lib/storage/types";
import { toStoredCandidateDecisionPayload } from "@/lib/storage/types";
import type { AutomationMode, KalshiFillLite, KalshiOrderLite, KalshiPositionLite, KalshiQuoteLite, PredictionCandidate, PredictionMarketQuote } from "@/lib/prediction/types";

const SCHEMA_VERSION = 1;
const STATE_NAME = "prediction-ingestion";

interface PredictionIngestionState {
  seenFillIds: Record<string, true>;
  resolutionKeys: Record<string, string>;
  latestHashes: Record<string, string>;
}

function defaultState(): PredictionIngestionState {
  return {
    seenFillIds: {},
    resolutionKeys: {},
    latestHashes: {},
  };
}

function hashPayload(payload: unknown) {
  return createHash("sha1").update(JSON.stringify(payload)).digest("hex");
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
  const state = await loadStorageState<PredictionIngestionState>(STATE_NAME, defaultState());
  const result = await fn(state);
  await saveStorageState(STATE_NAME, state);
  return result;
}

export async function persistKalshiSummarySnapshot(args: {
  orders: KalshiOrderLite[];
  fills: KalshiFillLite[];
  positions: KalshiPositionLite[];
  quotes: Record<string, KalshiQuoteLite>;
  source: string;
}) {
  await withState(async (state) => {
    const orderEvents: Array<PredictionStorageEnvelope<StoredKalshiOrderEvent>> = [];
    const fillEvents: Array<PredictionStorageEnvelope<StoredKalshiFillEvent>> = [];
    const positionEvents: Array<PredictionStorageEnvelope<StoredKalshiPositionEvent>> = [];
    const quoteEvents: Array<PredictionStorageEnvelope<StoredKalshiQuoteEvent>> = [];
    const resolutionEvents: Array<PredictionStorageEnvelope<StoredResolutionEvent>> = [];

    for (const order of args.orders) {
      const payload = normalizeOrderPayload(order);
      const entityKey = `order:${payload.orderId}`;
      const hash = hashPayload(payload);
      if (state.latestHashes[entityKey] === hash) continue;
      state.latestHashes[entityKey] = hash;
      orderEvents.push(makeEnvelope("orders", "raw", args.source, entityKey, payload));
    }

    for (const fill of args.fills) {
      const payload = normalizeFillPayload(fill);
      const entityKey = `fill:${payload.fillId}`;
      if (state.seenFillIds[payload.fillId]) continue;
      state.seenFillIds[payload.fillId] = true;
      fillEvents.push(makeEnvelope("fills", "raw", args.source, entityKey, payload));
    }

    for (const position of args.positions) {
      const payload = normalizePositionPayload(position);
      const entityKey = `position:${payload.ticker}`;
      const hash = hashPayload(payload);
      if (state.latestHashes[entityKey] === hash) continue;
      state.latestHashes[entityKey] = hash;
      positionEvents.push(makeEnvelope("positions", "raw", args.source, entityKey, payload));
    }

    for (const quote of Object.values(args.quotes)) {
      const payload = normalizeQuotePayload(quote);
      const entityKey = `quote:summary:${payload.ticker}`;
      const hash = hashPayload(payload);
      if (state.latestHashes[entityKey] !== hash) {
        state.latestHashes[entityKey] = hash;
        quoteEvents.push(makeEnvelope("quotes", "raw", args.source, entityKey, payload));
      }

      if (payload.settlementResult || (payload.marketStatus ?? "").toLowerCase().includes("settled")) {
        const resolutionKey = `${payload.ticker}:${payload.settlementResult ?? payload.marketStatus ?? "resolved"}`;
        if (state.resolutionKeys[payload.ticker] !== resolutionKey) {
          state.resolutionKeys[payload.ticker] = resolutionKey;
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
      appendPredictionEvents("raw", "positions", positionEvents),
      appendPredictionEvents("raw", "quotes", quoteEvents),
      appendPredictionEvents("raw", "resolutions", resolutionEvents),
    ]);
  });
}

export async function persistMarketScan(args: {
  markets: PredictionMarketQuote[];
  source: string;
}) {
  await withState(async (state) => {
    const quoteEvents: Array<PredictionStorageEnvelope<StoredKalshiQuoteEvent>> = [];
    const orderbookEvents: Array<PredictionStorageEnvelope<StoredOrderbookEvent>> = [];
    const resolutionEvents: Array<PredictionStorageEnvelope<StoredResolutionEvent>> = [];

    for (const market of args.markets) {
      const quotePayload = normalizeQuotePayload(market);
      const quoteKey = `quote:scan:${quotePayload.ticker}`;
      const quoteHash = hashPayload(quotePayload);
      if (state.latestHashes[quoteKey] !== quoteHash) {
        state.latestHashes[quoteKey] = quoteHash;
        quoteEvents.push(makeEnvelope("quotes", "raw", args.source, quoteKey, quotePayload));
      }

      const bookPayload = normalizeOrderbookPayload(market);
      const bookKey = `book:${bookPayload.ticker}`;
      const bookHash = hashPayload(bookPayload);
      if (state.latestHashes[bookKey] !== bookHash) {
        state.latestHashes[bookKey] = bookHash;
        orderbookEvents.push(makeEnvelope("orderbook_events", "raw", args.source, bookKey, bookPayload));
      }

      if ((market.status ?? "").toLowerCase().includes("settled")) {
        const resolutionKey = `${market.ticker}:${market.status}`;
        if (state.resolutionKeys[market.ticker] !== resolutionKey) {
          state.resolutionKeys[market.ticker] = resolutionKey;
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

export async function readStoredMarkoutsSince(sinceMs: number) {
  return readPredictionEventsSince<StoredMarkoutEvent>("derived", "markouts", sinceMs);
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
    fills,
    orders,
    positions,
    quotes,
    orderbookEvents,
    candidateDecisions,
    resolutions,
    markouts,
  ] = await Promise.all([
    readPredictionEventsForDay<StoredKalshiFillEvent>("raw", "fills", day),
    readPredictionEventsForDay<StoredKalshiOrderEvent>("raw", "orders", day),
    readPredictionEventsForDay<StoredKalshiPositionEvent>("raw", "positions", day),
    readPredictionEventsForDay<StoredKalshiQuoteEvent>("raw", "quotes", day),
    readPredictionEventsForDay<StoredOrderbookEvent>("raw", "orderbook_events", day),
    readPredictionEventsForDay<StoredCandidateDecisionEvent>("raw", "candidate_decisions", day),
    readPredictionEventsForDay<StoredResolutionEvent>("raw", "resolutions", day),
    readPredictionEventsForDay<StoredMarkoutEvent>("derived", "markouts", day),
  ]);

  return {
    fills,
    orders,
    positions,
    quotes,
    orderbookEvents,
    candidateDecisions,
    resolutions,
    markouts,
  };
}
