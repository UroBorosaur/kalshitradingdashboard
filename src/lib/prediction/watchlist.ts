import { loadStorageState, saveStorageState, withStorageStateWriter } from "@/lib/storage/jsonl";
import type { PredictionCandidate, WatchlistEvent, WatchlistPromotionDecision, WatchlistState } from "@/lib/prediction/types";

const STATE_NAME = "prediction-watchlist";
const STATE_VERSION = 1;
const WATCHLIST_RETENTION_MS = 45 * 24 * 60 * 60 * 1000;
const MAX_WATCHLIST = 5_000;

interface WatchlistStateStore {
  stateVersion: number;
  items: Record<string, WatchlistState>;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function defaultState(): WatchlistStateStore {
  return {
    stateVersion: STATE_VERSION,
    items: {},
  };
}

function compactState(state: WatchlistStateStore, nowMs = Date.now()): WatchlistStateStore {
  const entries = Object.entries(state.items)
    .filter(([, item]) => nowMs - new Date(item.lastSeenAt).getTime() <= WATCHLIST_RETENTION_MS)
    .sort((a, b) => new Date(b[1].lastSeenAt).getTime() - new Date(a[1].lastSeenAt).getTime())
    .slice(0, MAX_WATCHLIST);

  return {
    stateVersion: STATE_VERSION,
    items: Object.fromEntries(entries),
  };
}

async function withWatchlistState<T>(fn: (state: WatchlistStateStore) => Promise<T>) {
  return withStorageStateWriter(STATE_NAME, async () => {
    const loaded = await loadStorageState<WatchlistStateStore>(STATE_NAME, defaultState());
    const state = compactState(loaded);
    const result = await fn(state);
    await saveStorageState(STATE_NAME, compactState(state));
    return result;
  });
}

export async function loadWatchlistState() {
  const loaded = await loadStorageState<WatchlistStateStore>(STATE_NAME, defaultState());
  return compactState(loaded).items;
}

function ageHours(firstSeenAt: string, lastSeenAt: string) {
  const hours = (new Date(lastSeenAt).getTime() - new Date(firstSeenAt).getTime()) / 3_600_000;
  return Number(clamp(Number.isFinite(hours) ? hours : 0, 0, 24 * 60).toFixed(4));
}

function promotionScore(candidate: PredictionCandidate, prior: WatchlistState | undefined, latestQuoteDrift: number | null) {
  if (!prior) return 0;
  const edgeDelta = candidate.edge - prior.bestEdge;
  const execDelta = (candidate.executionAdjustedEdge ?? candidate.edge) - prior.bestExecutionAdjustedEdge;
  const confidenceDelta = candidate.confidence - prior.bestConfidence;
  const toxDelta = Math.max(0, (prior.lastToxicity ?? 0) - (candidate.toxicityScore ?? 0));
  const uncertDelta = Math.max(0, (prior.lastUncertainty ?? 0) - (candidate.uncertaintyWidth ?? 0));
  const driftDelta = Math.max(0, latestQuoteDrift ?? 0);
  return Number((edgeDelta * 3.1 + execDelta * 3.7 + confidenceDelta * 2.4 + toxDelta * 1.2 + uncertDelta * 1.2 + driftDelta * 1.8).toFixed(6));
}

export async function updateWatchlistLifecycle(args: {
  runId: string;
  candidates: PredictionCandidate[];
  promotionThreshold: number;
  enabled: boolean;
}) {
  return withWatchlistState(async (state) => {
    const events: WatchlistEvent[] = [];
    const promotions = new Map<string, WatchlistPromotionDecision>();
    const nextStates = new Map<string, WatchlistState>();
    const now = new Date().toISOString();

    for (const candidate of args.candidates) {
      if (candidate.verdict !== "WATCHLIST") continue;
      const key = `${candidate.ticker}:${candidate.side}`;
      const prior = state.items[key];
      const latestQuoteDrift = prior ? Number((candidate.marketProb - prior.lastMarketProb).toFixed(6)) : null;
      const score = promotionScore(candidate, prior, latestQuoteDrift);
      const failedHardGate = (candidate.gateDiagnostics ?? []).some((gate) => !gate.passed && [
        "POSITION_ORDER_CONFLICT",
        "ORDER_GROUP_BRAKE",
        "CLUSTER_CAP",
        "TOXICITY",
        "UNCERTAINTY_WIDTH",
      ].includes(gate.gate));
      const promoted = args.enabled && score >= args.promotionThreshold && !failedHardGate && (candidate.executionAdjustedEdge ?? candidate.edge) > 0;
      const current: WatchlistState = {
        key,
        ticker: candidate.ticker,
        title: candidate.title,
        category: candidate.category,
        side: candidate.side,
        firstSeenAt: prior?.firstSeenAt ?? now,
        lastSeenAt: now,
        cyclesObserved: (prior?.cyclesObserved ?? 0) + 1,
        bestEdge: Math.max(candidate.edge, prior?.bestEdge ?? -Infinity),
        bestExecutionAdjustedEdge: Math.max(candidate.executionAdjustedEdge ?? candidate.edge, prior?.bestExecutionAdjustedEdge ?? -Infinity),
        bestConfidence: Math.max(candidate.confidence, prior?.bestConfidence ?? -Infinity),
        bestCompositeScore: Math.max(candidate.compositeScore ?? -Infinity, prior?.bestCompositeScore ?? -Infinity),
        lastMarketProb: candidate.marketProb,
        lastQuoteDrift: latestQuoteDrift,
        lastToxicity: candidate.toxicityScore ?? null,
        lastUncertainty: candidate.uncertaintyWidth ?? null,
        blockingReasons: (candidate.gateDiagnostics ?? []).filter((gate) => !gate.passed).map((gate) => gate.gate),
        failedGates: (candidate.gateDiagnostics ?? []).filter((gate) => !gate.passed),
        promotedCount: (prior?.promotedCount ?? 0) + (promoted ? 1 : 0),
        lastPromotionAt: promoted ? now : prior?.lastPromotionAt,
        resolved: prior?.resolved ?? false,
      };
      state.items[key] = current;
      nextStates.set(key, current);
      events.push({
        key,
        ticker: candidate.ticker,
        title: candidate.title,
        category: candidate.category,
        side: candidate.side,
        type: prior ? "UPDATED" : "ADDED",
        promotionScore: score,
        avgWatchlistHours: ageHours(current.firstSeenAt, current.lastSeenAt),
        quoteDrift: latestQuoteDrift,
        edge: candidate.edge,
        executionAdjustedEdge: candidate.executionAdjustedEdge,
        confidence: candidate.confidence,
        toxicityScore: candidate.toxicityScore,
        uncertaintyWidth: candidate.uncertaintyWidth,
        failedGates: current.failedGates,
        blockingReasons: current.blockingReasons,
        reason: prior ? "Watchlist candidate persisted across cycles." : "New watchlist candidate recorded.",
      });
      promotions.set(key, {
        key,
        ticker: candidate.ticker,
        side: candidate.side,
        promotionScore: score,
        threshold: args.promotionThreshold,
        promoted,
        reason: promoted
          ? "Candidate improved enough across cycles to clear watchlist promotion threshold."
          : failedHardGate
            ? "Hard gate still blocks watchlist promotion."
            : "Improvement insufficient for watchlist promotion.",
        avgWatchlistHours: ageHours(current.firstSeenAt, current.lastSeenAt),
      });
      if (promoted) {
        events.push({
          key,
          ticker: candidate.ticker,
          title: candidate.title,
          category: candidate.category,
          side: candidate.side,
          type: "PROMOTED",
          promotionScore: score,
          avgWatchlistHours: ageHours(current.firstSeenAt, current.lastSeenAt),
          quoteDrift: latestQuoteDrift,
          edge: candidate.edge,
          executionAdjustedEdge: candidate.executionAdjustedEdge,
          confidence: candidate.confidence,
          toxicityScore: candidate.toxicityScore,
          uncertaintyWidth: candidate.uncertaintyWidth,
          failedGates: current.failedGates,
          blockingReasons: current.blockingReasons,
          reason: "Watchlist candidate promoted after improving across cycles.",
        });
      }
    }

    return {
      states: nextStates,
      events,
      promotions,
    };
  });
}
