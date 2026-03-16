import type {
  Account,
  EquitySnapshot,
  MarketRegime,
  SetupKey,
  Trade,
  TradeQualityBreakdown,
} from "@/lib/types";
import type {
  AlpacaAccount,
  AlpacaActivityFill,
  AlpacaOrder,
  AlpacaPortfolioHistory,
  AlpacaPosition,
} from "@/lib/live/alpaca";
import type {
  KalshiFillLite,
  KalshiOrderLite,
  KalshiPositionLite,
  KalshiQuoteLite,
  PredictionCategory,
} from "@/lib/prediction/types";

function toDateOnly(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function firstFinite(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return Math.abs(h >>> 0);
}

function setupFromSymbol(symbol: string): SetupKey {
  const setups: SetupKey[] = ["BREAKOUT", "PULLBACK", "MEAN_REVERSION", "MOMENTUM_CONTINUATION", "NEWS_FADE"];
  return setups[hashString(symbol) % setups.length];
}

function regimeFromSymbol(symbol: string): MarketRegime {
  if (symbol.includes("/") || symbol.includes("BTC") || symbol.includes("ETH")) return "HIGH_VOL_ADVERSARIAL";
  if (["AAPL", "MSFT", "NVDA", "QQQ"].includes(symbol)) return "TREND_FOLLOWER";
  if (["SPY", "DIA"].includes(symbol)) return "MEAN_REVERSION";
  return "NEWS_SHOCK";
}

function qualityFromOrder(order: AlpacaOrder): TradeQualityBreakdown {
  const slippagePenalty = order.limit_price ? 2 : 8;
  const execution = Math.max(45, 86 - slippagePenalty);
  return {
    thesisQuality: 68,
    timingQuality: 63,
    executionQuality: execution,
    regimeFit: 61,
    sizingQuality: 66,
    exitQuality: 59,
  };
}

function inferKalshiCategoryFromTicker(ticker: string): PredictionCategory {
  const upper = ticker.toUpperCase();
  if (/(BTC|BITCOIN|ETH|CRYPTO)/.test(upper)) return "BITCOIN";
  if (/(WEATHER|TEMP|RAIN|SNOW|HURRICANE|WIND)/.test(upper)) return "WEATHER";
  if (/(PRES|SENATE|HOUSE|ELECT|GOV)/.test(upper)) return "POLITICS";
  if (/(ESPORT|CS2|VALORANT|DOTA|LOL|MAP)/.test(upper)) return "ESPORTS";
  if (/(STOCK|AAPL|MSFT|NVDA|QQQ|SPY|EARN)/.test(upper)) return "STOCKS";
  if (/(FED|CPI|GDP|RATE|MACRO|UNEMPLOY)/.test(upper)) return "MACRO";
  return "SPORTS";
}

function kalshiSetupForCategory(category: PredictionCategory): SetupKey {
  if (category === "BITCOIN") return "MOMENTUM_CONTINUATION";
  if (category === "WEATHER") return "MEAN_REVERSION";
  if (category === "POLITICS" || category === "MACRO") return "NEWS_FADE";
  if (category === "STOCKS") return "BREAKOUT";
  if (category === "ESPORTS") return "PULLBACK";
  return "NEWS_FADE";
}

function kalshiRegimeForCategory(category: PredictionCategory): MarketRegime {
  if (category === "BITCOIN") return "HIGH_VOL_ADVERSARIAL";
  if (category === "WEATHER") return "NEWS_SHOCK";
  if (category === "POLITICS" || category === "MACRO") return "NEWS_SHOCK";
  if (category === "STOCKS") return "TREND_FOLLOWER";
  if (category === "ESPORTS") return "HIGH_VOL_ADVERSARIAL";
  return "MEAN_REVERSION";
}

interface InventoryState {
  qty: number;
  avgCost: number;
}

function kalshiFillExecutionPrice(fill: KalshiFillLite): number | null {
  const cents =
    fill.side === "yes"
      ? firstFinite(
          toFiniteNumber(fill.yes_price),
          typeof fill.no_price === "number" ? 100 - fill.no_price : null,
        )
      : firstFinite(
          toFiniteNumber(fill.no_price),
          typeof fill.yes_price === "number" ? 100 - fill.yes_price : null,
        );
  if (cents === null) return null;
  const dollars = cents / 100;
  return Number.isFinite(dollars) && dollars >= 0 ? dollars : null;
}

// FIFO-lite realized PnL approximation from fills, intended for paper analytics.
export function realizedPnlByOrder(fills: AlpacaActivityFill[]): Map<string, number> {
  const byOrder = new Map<string, number>();
  const inventory = new Map<string, InventoryState>();

  const ordered = fills.slice().sort((a, b) => a.transaction_time.localeCompare(b.transaction_time));

  for (const fill of ordered) {
    const symbol = fill.symbol.toUpperCase();
    const qty = Number(fill.qty);
    const price = Number(fill.price);
    if (!Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0) continue;

    const state = inventory.get(symbol) ?? { qty: 0, avgCost: 0 };
    let realized = 0;

    if (fill.side === "buy") {
      if (state.qty < 0) {
        const coverQty = Math.min(qty, Math.abs(state.qty));
        realized += (state.avgCost - price) * coverQty;
        state.qty += coverQty;
        const remaining = qty - coverQty;
        if (remaining > 0) {
          const longCost = state.qty > 0 ? state.avgCost * state.qty : 0;
          const newQty = Math.max(0, state.qty) + remaining;
          state.avgCost = (longCost + remaining * price) / newQty;
          state.qty = newQty;
        }
      } else {
        const cost = state.qty * state.avgCost + qty * price;
        state.qty += qty;
        state.avgCost = state.qty > 0 ? cost / state.qty : 0;
      }
    } else {
      if (state.qty > 0) {
        const closeQty = Math.min(qty, state.qty);
        realized += (price - state.avgCost) * closeQty;
        state.qty -= closeQty;
        const remaining = qty - closeQty;
        if (remaining > 0) {
          const shortQty = remaining;
          const priorShortQty = Math.max(0, -state.qty);
          const priorShortCost = priorShortQty * state.avgCost;
          const newShortQty = priorShortQty + shortQty;
          state.avgCost = newShortQty > 0 ? (priorShortCost + shortQty * price) / newShortQty : state.avgCost;
          state.qty = -newShortQty;
        }
      } else {
        const priorShortQty = Math.max(0, -state.qty);
        const priorShortCost = priorShortQty * state.avgCost;
        const newShortQty = priorShortQty + qty;
        state.avgCost = (priorShortCost + qty * price) / newShortQty;
        state.qty = -newShortQty;
      }
    }

    inventory.set(symbol, state);
    const orderPnl = byOrder.get(fill.order_id) ?? 0;
    byOrder.set(fill.order_id, Number((orderPnl + realized).toFixed(2)));
  }

  return byOrder;
}

// FIFO-lite realized PnL attribution for Kalshi fills.
// Instrument key is ticker+side so YES/NO books do not collide.
export function realizedKalshiPnlByOrder(fills: KalshiFillLite[]): Map<string, number> {
  const byOrder = new Map<string, number>();
  const inventory = new Map<string, InventoryState>();

  const ordered = fills
    .slice()
    .sort((a, b) => (a.created_time ?? "").localeCompare(b.created_time ?? ""));

  for (const fill of ordered) {
    const ticker = fill.ticker.toUpperCase();
    const side = fill.side.toLowerCase();
    const instrument = `${ticker}::${side}`;
    const qty = Number(fill.count);
    const price = kalshiFillExecutionPrice(fill);
    const action = fill.action.toLowerCase();
    const isBuy = action === "buy";
    const isSell = action === "sell";

    if (!Number.isFinite(qty) || qty <= 0 || price === null || (!isBuy && !isSell)) continue;

    const state = inventory.get(instrument) ?? { qty: 0, avgCost: 0 };
    let realized = 0;

    if (isBuy) {
      if (state.qty < 0) {
        const coverQty = Math.min(qty, Math.abs(state.qty));
        realized += (state.avgCost - price) * coverQty;
        state.qty += coverQty;
        const remaining = qty - coverQty;
        if (remaining > 0) {
          const longCost = state.qty > 0 ? state.avgCost * state.qty : 0;
          const newQty = Math.max(0, state.qty) + remaining;
          state.avgCost = newQty > 0 ? (longCost + remaining * price) / newQty : 0;
          state.qty = newQty;
        }
      } else {
        const cost = state.qty * state.avgCost + qty * price;
        state.qty += qty;
        state.avgCost = state.qty > 0 ? cost / state.qty : 0;
      }
    } else {
      if (state.qty > 0) {
        const closeQty = Math.min(qty, state.qty);
        realized += (price - state.avgCost) * closeQty;
        state.qty -= closeQty;
        const remaining = qty - closeQty;
        if (remaining > 0) {
          const shortQty = remaining;
          const priorShortQty = Math.max(0, -state.qty);
          const priorShortCost = priorShortQty * state.avgCost;
          const newShortQty = priorShortQty + shortQty;
          state.avgCost = newShortQty > 0 ? (priorShortCost + shortQty * price) / newShortQty : state.avgCost;
          state.qty = -newShortQty;
        }
      } else {
        const priorShortQty = Math.max(0, -state.qty);
        const priorShortCost = priorShortQty * state.avgCost;
        const newShortQty = priorShortQty + qty;
        state.avgCost = newShortQty > 0 ? (priorShortCost + qty * price) / newShortQty : state.avgCost;
        state.qty = -newShortQty;
      }
    }

    inventory.set(instrument, state);
    const orderPnl = byOrder.get(fill.order_id) ?? 0;
    byOrder.set(fill.order_id, Number((orderPnl + realized).toFixed(4)));
  }

  return byOrder;
}

export function mapAlpacaAccount(account: AlpacaAccount | null): Account[] {
  if (!account) return [];
  const equity = Number(account.equity);
  const lastEquity = Number(account.last_equity);
  const drawdown = equity > 0 && lastEquity > 0 ? Math.max(0, (lastEquity - equity) / lastEquity) : 0;

  return [
    {
      id: `alpaca-${account.id}`,
      name: "Alpaca Paper",
      type: "DEMO",
      balance: equity,
      riskPercent: 0.01,
      riskValue: Number((equity * 0.01).toFixed(2)),
      currentStreak: 0,
      maxDrawdown: Number(drawdown.toFixed(4)),
    },
  ];
}

export function mapAlpacaEquityHistory(history: AlpacaPortfolioHistory | null): EquitySnapshot[] {
  if (!history || !Array.isArray(history.timestamp) || !Array.isArray(history.equity)) return [];

  const out: EquitySnapshot[] = [];
  let peak = 0;

  for (let i = 0; i < history.timestamp.length; i += 1) {
    const ts = history.timestamp[i];
    const balance = Number(history.equity[i] ?? 0);
    const pnl = Number(history.profit_loss?.[i] ?? 0);
    if (!Number.isFinite(balance)) continue;
    peak = Math.max(peak, balance);
    const drawdown = peak > 0 ? (peak - balance) / peak : 0;

    out.push({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      balance,
      dailyPnl: pnl,
      drawdown: Number(drawdown.toFixed(4)),
      accountType: "DEMO",
    });
  }

  return out;
}

export function mapAlpacaOrdersToTrades(
  orders: AlpacaOrder[],
  positions: AlpacaPosition[],
  fills: AlpacaActivityFill[],
  equityBase: number,
): Trade[] {
  const openPosMap = new Map<string, AlpacaPosition>();
  for (const p of positions) openPosMap.set(p.symbol.toUpperCase(), p);

  const realizedByOrder = realizedPnlByOrder(fills);

  return orders.map((order) => {
    const symbol = order.symbol.toUpperCase();
    const status = order.status.toLowerCase();
    const isOpen = ["new", "accepted", "partially_filled", "pending_new", "pending_replace"].includes(status);
    const isClosed = ["filled", "canceled", "expired", "rejected", "stopped"].includes(status);

    const mappedStatus: Trade["status"] = isOpen ? "OPEN" : isClosed ? "CLOSED" : "MISSED";

    const openPos = openPosMap.get(symbol);
    const realized = realizedByOrder.get(order.id) ?? 0;
    const unrealized = openPos ? Number(openPos.unrealized_pl) : 0;
    const pnl = mappedStatus === "OPEN" ? unrealized : realized;

    const quantity = Math.max(0, Math.abs(Number(order.filled_qty || order.qty || openPos?.qty || 0)));
    const price = Number(order.filled_avg_price || order.limit_price || openPos?.avg_entry_price || 0);
    const notionalRiskProxy = Math.max(1, quantity * Math.max(1, price) * 0.005);
    const rr = notionalRiskProxy > 0 ? Number((pnl / notionalRiskProxy).toFixed(2)) : 0;
    const pnlPercent = equityBase > 0 ? Number((pnl / equityBase).toFixed(4)) : 0;

    const setup = setupFromSymbol(symbol);
    const quality = qualityFromOrder(order);

    return {
      id: order.id,
      symbol,
      assetClass: order.asset_class === "crypto" ? "CRYPTO" : "EQUITY",
      quantity,
      price: Number(price.toFixed(4)),
      direction: order.side === "buy" ? "LONG" : "SHORT",
      setup,
      entryDate: toDateOnly(order.submitted_at),
      exitDate: order.filled_at ? toDateOnly(order.filled_at) : null,
      pnl: Number(pnl.toFixed(2)),
      pnlPercent,
      rr,
      status: mappedStatus,
      accountType: "DEMO",
      tags: ["live", "alpaca-paper"],
      confidenceScore: 0.58,
      marketRegime: regimeFromSymbol(symbol),
      notes: `Live Alpaca ${order.side} ${order.type} order (${order.status}).`,
      executionScore: quality.executionQuality,
      slippage: order.type === "market" ? 0.8 : 0.3,
      thesisQuality: quality.thesisQuality,
      opponentProfile: "Live market microstructure",
      regimeTransitionDamage: 0.18,
      overusePenalty: 0.16,
      quality,
    };
  });
}

export function mapKalshiOrdersToTrades(
  orders: KalshiOrderLite[],
  fills: KalshiFillLite[],
  quotesByTicker: Record<string, KalshiQuoteLite>,
  equityBase: number,
): Trade[] {
  if (!orders.length) return [];

  const realizedByOrder = realizedKalshiPnlByOrder(fills);
  const fillsByOrder = new Map<string, KalshiFillLite[]>();
  for (const fill of fills) {
    const bucket = fillsByOrder.get(fill.order_id) ?? [];
    bucket.push(fill);
    fillsByOrder.set(fill.order_id, bucket);
  }

  return orders
    .map((order) => {
      const ticker = order.ticker.toUpperCase();
      const contractTitle = order.title?.trim() ? order.title.trim() : ticker;
      const category = inferKalshiCategoryFromTicker(ticker);
      const setup = kalshiSetupForCategory(category);
      const regime = kalshiRegimeForCategory(category);

      const rawStatus = order.status.toLowerCase();
      const marketStatus = (order.market_status ?? "").toLowerCase();
      const action = order.action.toLowerCase();
      const isCanceled =
        rawStatus.includes("cancel") || rawStatus.includes("reject") || rawStatus.includes("fail");
      const isSellExecution =
        action === "sell" && (rawStatus.includes("executed") || rawStatus.includes("filled"));
      const isSettledMarket = ["settled", "resolved", "closed", "expired", "finalized", "determined"].some((token) =>
        marketStatus.includes(token),
      );
      const mappedStatus: Trade["status"] = isCanceled ? "MISSED" : isSellExecution || isSettledMarket ? "CLOSED" : "OPEN";

      const orderFills = fillsByOrder.get(order.order_id) ?? [];
      const remainingCount = typeof order.remaining_count === "number" ? Math.max(0, order.remaining_count) : null;
      const filledFromOrder = Math.max(
        0,
        remainingCount !== null ? order.count - remainingCount : 0,
      );
      const filledFromFills = orderFills.reduce((sum, fill) => sum + fill.count, 0);
      const hasExecutionSignal =
        filledFromOrder > 0 ||
        filledFromFills > 0 ||
        rawStatus.includes("fill") ||
        rawStatus.includes("executed") ||
        rawStatus.includes("part");
      const inferredContracts = hasExecutionSignal
        ? Math.max(filledFromOrder, filledFromFills, order.count)
        : order.count;
      const contracts = Number(Math.max(0, inferredContracts).toFixed(6));
      if (contracts <= 0 && mappedStatus !== "OPEN") return null;
      const quote = quotesByTicker[ticker];

      const entryPriceCentsFromOrder =
        order.side === "yes"
          ? (order.yes_price ??
            (order.no_price !== undefined ? 100 - order.no_price : undefined) ??
            (quote?.lastPrice !== null && quote?.lastPrice !== undefined ? quote.lastPrice * 100 : 50))
          : (order.no_price ??
            (order.yes_price !== undefined ? 100 - order.yes_price : undefined) ??
            (quote?.lastPrice !== null && quote?.lastPrice !== undefined ? (1 - quote.lastPrice) * 100 : 50));

      const fillPriceCents = orderFills.length
        ? orderFills.reduce((sum, fill) => {
            const cents =
              fill.side === "yes"
                ? (fill.yes_price ?? (fill.no_price !== undefined ? 100 - fill.no_price : entryPriceCentsFromOrder))
                : (fill.no_price ?? (fill.yes_price !== undefined ? 100 - fill.yes_price : entryPriceCentsFromOrder));
            return sum + cents * fill.count;
          }, 0) / Math.max(1, filledFromFills)
        : entryPriceCentsFromOrder;

      const settlementMark = (() => {
        if (!isSettledMarket) return null;
        if (quote?.settlementResult === "yes") return order.side === "yes" ? 1 : 0;
        if (quote?.settlementResult === "no") return order.side === "yes" ? 0 : 1;
        if (typeof quote?.settlementPrice === "number" && Number.isFinite(quote.settlementPrice)) {
          return order.side === "yes" ? quote.settlementPrice : 1 - quote.settlementPrice;
        }
        return null;
      })();

      const markPrice =
        settlementMark ??
        (order.side === "yes"
          ? firstFinite(quote?.yesBid, quote?.lastPrice, fillPriceCents / 100)
          : firstFinite(
              quote?.noBid,
              quote?.lastPrice !== null && quote?.lastPrice !== undefined ? 1 - quote.lastPrice : null,
              fillPriceCents / 100,
            ));

      const price = fillPriceCents / 100;
      const mark = markPrice ?? price;
      const notional = contracts * price;
      const pnlPerContract = action === "buy" ? mark - price : price - mark;
      const markBasedPnl = pnlPerContract * contracts;
      const realized = realizedByOrder.get(order.order_id);
      const pnl = mappedStatus === "OPEN" || isSettledMarket ? markBasedPnl : (realized ?? markBasedPnl);
      const rr = notional > 0 ? Number((pnl / notional).toFixed(2)) : 0;
      const pnlPercent = equityBase > 0 ? Number((pnl / equityBase).toFixed(4)) : 0;

      const created = order.created_time ? toDateOnly(order.created_time) : new Date().toISOString().slice(0, 10);
      const exited = mappedStatus === "OPEN"
        ? null
        : (order.last_update_time ? toDateOnly(order.last_update_time) : created);

      return {
        id: `kalshi-${order.order_id}`,
        symbol: contractTitle,
        assetClass: category === "BITCOIN" ? "CRYPTO" : "INDEX_FUTURE",
        quantity: contracts,
        price: Number(price.toFixed(4)),
        direction: order.side === "yes" ? "LONG" : "SHORT",
        setup,
        entryDate: created,
        exitDate: exited,
        pnl: Number(pnl.toFixed(2)),
        pnlPercent,
        rr,
        status: mappedStatus,
        accountType: "DEMO",
        tags: ["live", "kalshi-demo", category.toLowerCase()],
        confidenceScore: 0.55,
        marketRegime: regime,
        notes: `Kalshi ${order.side.toUpperCase()} ${order.action} order (${order.status}) on ${ticker}. Entry ${price.toFixed(2)}, mark ${mark.toFixed(2)}.`,
        executionScore: 64,
        slippage: 0.45,
        thesisQuality: 62,
        opponentProfile: "Prediction market order flow",
        regimeTransitionDamage: 0.14,
        overusePenalty: 0.12,
        quality: {
          thesisQuality: 62,
          timingQuality: 60,
          executionQuality: 64,
          regimeFit: 61,
          sizingQuality: 63,
          exitQuality: 58,
        },
      };
    })
    .filter((trade): trade is Trade => trade !== null);
}

export function mapKalshiPositionsToTrades(
  positions: KalshiPositionLite[],
  quotesByTicker: Record<string, KalshiQuoteLite>,
  equityBase: number,
  titlesByTicker: Record<string, string> = {},
): Trade[] {
  if (!positions.length) return [];

  const out: Trade[] = [];

  for (const position of positions) {
    const ticker = position.ticker.toUpperCase();
    const signedQty = toFiniteNumber(position.position_fp) ?? 0;
    const contracts = Math.abs(signedQty);
    if (!Number.isFinite(contracts) || contracts <= 0) continue;

    const direction: Trade["direction"] = signedQty >= 0 ? "LONG" : "SHORT";
    const category = inferKalshiCategoryFromTicker(ticker);
    const setup = kalshiSetupForCategory(category);
    const regime = kalshiRegimeForCategory(category);

    const quote = quotesByTicker[ticker];
    const fallbackTitle = titlesByTicker[ticker]?.trim();
    const contractTitle = quote?.title?.trim() || fallbackTitle || ticker;

    const exposure = toFiniteNumber(position.market_exposure_dollars);
    const totalTraded = toFiniteNumber(position.total_traded_dollars);
    const fees = Math.max(0, toFiniteNumber(position.fees_paid_dollars) ?? 0);
    const realized = toFiniteNumber(position.realized_pnl_dollars) ?? 0;

    const avgEntryFromCost = totalTraded !== null && contracts > 0 ? totalTraded / contracts : null;
    const markFromExposure = exposure !== null && contracts > 0 ? exposure / contracts : null;

    const quoteMark =
      direction === "LONG"
        ? firstFinite(quote?.yesBid, quote?.lastPrice, markFromExposure)
        : firstFinite(
            quote?.noBid,
            quote?.lastPrice !== null && quote?.lastPrice !== undefined ? 1 - quote.lastPrice : null,
            markFromExposure,
          );

    const price = firstFinite(avgEntryFromCost, markFromExposure, quoteMark, 0.5) ?? 0.5;
    const mark = firstFinite(quoteMark, markFromExposure, price) ?? price;
    const costBasis = contracts * price;
    const marketValue = contracts * mark;
    const unrealized = marketValue - costBasis;
    const rr = costBasis > 0 ? Number((unrealized / costBasis).toFixed(2)) : 0;
    const pnlPercent = equityBase > 0 ? Number((unrealized / equityBase).toFixed(4)) : 0;

    const entryDate = (() => {
      if (!position.last_updated_ts) return new Date().toISOString().slice(0, 10);
      const numeric = Number(position.last_updated_ts);
      if (Number.isFinite(numeric)) {
        const tsMs = numeric > 10_000_000_000 ? numeric : numeric * 1000;
        return new Date(tsMs).toISOString().slice(0, 10);
      }
      const parsed = new Date(position.last_updated_ts);
      return Number.isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
    })();

    out.push({
      id: `kalshi-pos-${ticker}-${direction}`,
      symbol: contractTitle,
      assetClass: category === "BITCOIN" ? "CRYPTO" : "INDEX_FUTURE",
      quantity: Number(contracts.toFixed(6)),
      price: Number(price.toFixed(4)),
      direction,
      setup,
      entryDate,
      exitDate: null,
      pnl: Number(unrealized.toFixed(2)),
      pnlPercent,
      rr,
      status: "OPEN",
      accountType: "DEMO",
      tags: ["live", "kalshi-demo", category.toLowerCase(), "position-snapshot"],
      confidenceScore: 0.6,
      marketRegime: regime,
      notes: `Kalshi open position (${ticker}) qty ${contracts.toFixed(2)}. Avg ${price.toFixed(2)}, mark ${mark.toFixed(2)}, realized ${realized.toFixed(2)}, fees ${fees.toFixed(2)}.`,
      executionScore: 66,
      slippage: 0.35,
      thesisQuality: 63,
      opponentProfile: "Prediction market order flow",
      regimeTransitionDamage: 0.14,
      overusePenalty: 0.12,
      quality: {
        thesisQuality: 63,
        timingQuality: 61,
        executionQuality: 66,
        regimeFit: 62,
        sizingQuality: 64,
        exitQuality: 58,
      },
    });
  }

  return out;
}
