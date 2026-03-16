import type {
  AlpacaAccount,
  AlpacaActivityFill,
  AlpacaOrder,
  AlpacaPortfolioHistory,
  AlpacaPosition,
} from "@/lib/live/alpaca";
import type { KalshiFillLite, KalshiOrderLite, KalshiPositionLite, KalshiQuoteLite } from "@/lib/prediction/types";

export interface KalshiStreamStatus {
  connected: boolean;
  primedPublic: boolean;
  primedPrivate: boolean;
  lastMessageAt: string | null;
  lastHeartbeatAt: string | null;
  lastControlPingAt: string | null;
  lastControlPongAt: string | null;
  lastResyncAt: string | null;
  lastPrivateBootstrapAt: string | null;
  lastPrivateEventType: string | null;
  lastSubscriptionAckAt: string | null;
  lastSubscriptionAckChannel: string | null;
  lastSubscriptionAckSid: number | null;
  lastSubscriptionAckIssue: string | null;
  lastSubscriptionAckRaw: string | null;
  reconnectCount: number;
  desyncCount: number;
  reason: string | null;
  subscriptions: Array<{
    channel: string;
    sid: number | null;
    marketCount: number;
  }>;
}

export interface KalshiLiveSnapshot {
  connected: boolean;
  provider: string;
  balanceUsd: number | null;
  cashUsd: number | null;
  portfolioUsd: number | null;
  orders: KalshiOrderLite[];
  fills: KalshiFillLite[];
  positions: KalshiPositionLite[];
  quotes: Record<string, KalshiQuoteLite>;
  stream: KalshiStreamStatus | null;
  error: string | null;
}

export interface LiveBrokerSnapshot {
  connected: boolean;
  provider: string;
  account: AlpacaAccount | null;
  orders: AlpacaOrder[];
  positions: AlpacaPosition[];
  equityHistory: AlpacaPortfolioHistory | null;
  activities: AlpacaActivityFill[];
  kalshi: KalshiLiveSnapshot;
  lastSync: string | null;
  error: string | null;
}
