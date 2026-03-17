"use client";

import { Bot, Brain, Loader2, Play, RotateCcw, ShieldAlert, SlidersHorizontal, TimerReset, Zap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { usePredictionAutomation } from "@/hooks/use-prediction-automation";
import type { AutomationControls, AutomationMode, PredictionCategory } from "@/lib/prediction/types";
import { cn } from "@/lib/utils";

const modeOptions: { value: AutomationMode; label: string; description: string }[] = [
  {
    value: "CONSERVATIVE",
    label: "Conservative",
    description: "Lower risk budgets, higher confidence threshold, tighter edge filter.",
  },
  {
    value: "MIXED",
    label: "Mixed",
    description: "Balanced edge capture with diversification and moderate sizing.",
  },
  {
    value: "AGGRESSIVE",
    label: "Aggressive",
    description: "Higher turnover and wider edge acceptance with larger risk caps.",
  },
  {
    value: "AI",
    label: "AI Mode",
    description: "Cross-domain mispricing engine with Bayesian updates, deception filter, and ranked opportunity sets.",
  },
];

const categoryOptions: PredictionCategory[] = [
  "BITCOIN",
  "SPORTS",
  "POLITICS",
  "ESPORTS",
  "WEATHER",
  "STOCKS",
  "MACRO",
  "OTHER",
];

const sliderControls: Array<{
  key: keyof Pick<
    AutomationControls,
    | "edgeMultiplier"
    | "confidenceShift"
    | "spreadMultiplier"
    | "liquidityMultiplier"
    | "highProbModelMin"
    | "highProbMarketMin"
    | "replacementMinDelta"
    | "cancelReplaceMinImprovement"
    | "watchlistPromotionThreshold"
  >;
  label: string;
  min: number;
  max: number;
  step: number;
  description: string;
  effectLow: string;
  effectHigh: string;
  format: (value: number) => string;
}> = [
  {
    key: "edgeMultiplier",
    label: "Edge Gate",
    min: 0.5,
    max: 1.8,
    step: 0.05,
    description: "Multiplies the minimum required edge before a trade is considered actionable.",
    effectLow: "Lower = more trades, thinner edge.",
    effectHigh: "Higher = fewer trades, stronger price advantage required.",
    format: (value) => `${value.toFixed(2)}x`,
  },
  {
    key: "confidenceShift",
    label: "Confidence Shift",
    min: -0.15,
    max: 0.15,
    step: 0.01,
    description: "Raises or lowers the model confidence floor used to approve trades.",
    effectLow: "Lower = more trades, more uncertainty tolerated.",
    effectHigh: "Higher = fewer trades, stronger conviction required.",
    format: (value) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(0)} pts`,
  },
  {
    key: "spreadMultiplier",
    label: "Spread Tolerance",
    min: 0.7,
    max: 1.6,
    step: 0.05,
    description: "Expands or tightens the allowed bid/ask spread before execution is blocked.",
    effectLow: "Lower = fewer trades, better pricing quality.",
    effectHigh: "Higher = more trades, worse microstructure tolerated.",
    format: (value) => `${value.toFixed(2)}x`,
  },
  {
    key: "liquidityMultiplier",
    label: "Liquidity Gate",
    min: 0.5,
    max: 1.6,
    step: 0.05,
    description: "Scales the minimum liquidity requirement for a market to qualify.",
    effectLow: "Lower = more thin markets allowed.",
    effectHigh: "Higher = only deeper markets survive.",
    format: (value) => `${value.toFixed(2)}x`,
  },
  {
    key: "highProbModelMin",
    label: "Model High-Prob Floor",
    min: 0.5,
    max: 0.97,
    step: 0.01,
    description: "Minimum selected-side model probability for the high-probability execution lane.",
    effectLow: "Lower = more orders get through the high-probability lane.",
    effectHigh: "Higher = fewer orders get through; stronger hit-rate required.",
    format: (value) => `${(value * 100).toFixed(0)}%`,
  },
  {
    key: "highProbMarketMin",
    label: "Implied High-Prob Floor",
    min: 0.5,
    max: 0.97,
    step: 0.01,
    description: "Minimum selected-side market-implied probability required by the same high-probability gate.",
    effectLow: "Lower = more mid-priced markets can qualify.",
    effectHigh: "Higher = only already-expensive favorites qualify.",
    format: (value) => `${(value * 100).toFixed(0)}%`,
  },
  {
    key: "replacementMinDelta",
    label: "Replacement Margin",
    min: 0.005,
    max: 0.08,
    step: 0.001,
    description: "Minimum utility delta required before a blocked challenger can replace an incumbent resting order.",
    effectLow: "Lower = more order replacements, more queue resets.",
    effectHigh: "Higher = fewer replacements, stronger incumbent protection.",
    format: (value) => value.toFixed(3),
  },
  {
    key: "cancelReplaceMinImprovement",
    label: "Cancel/Reprice Min Improvement",
    min: 0.002,
    max: 0.05,
    step: 0.001,
    description: "Minimum expected-value improvement required before a stale resting order is canceled or repriced.",
    effectLow: "Lower = more stale-order maintenance actions.",
    effectHigh: "Higher = fewer quote mutations, more stale orders left alone.",
    format: (value) => value.toFixed(3),
  },
  {
    key: "watchlistPromotionThreshold",
    label: "Watchlist Promotion Threshold",
    min: 0.01,
    max: 0.12,
    step: 0.005,
    description: "Minimum multi-cycle improvement score required before a watchlist name is auto-promoted back into contention.",
    effectLow: "Lower = more watchlist promotions.",
    effectHigh: "Higher = watchlist names need clearer improvement before promotion.",
    format: (value) => value.toFixed(3),
  },
];

const toggleControls: Array<{
  key: keyof Pick<
    AutomationControls,
    | "highProbabilityEnabled"
    | "favoriteLongshotEnabled"
    | "throughputRecoveryEnabled"
    | "exploratoryFallbackEnabled"
    | "replacementEnabled"
    | "orderMaintenanceEnabled"
    | "watchlistPromotionEnabled"
    | "adaptiveLearningEnabled"
    | "liquidationAdvisoryEnabled"
  >;
  label: string;
  description: string;
  onText: string;
  offText: string;
}> = [
  {
    key: "highProbabilityEnabled",
    label: "High-Prob Lane",
    description: "Allows small-edge trades if hit probability is high enough.",
    onText: "On = more high-hit-rate orders.",
    offText: "Off = only stronger raw-edge trades survive.",
  },
  {
    key: "favoriteLongshotEnabled",
    label: "Favorite Bias",
    description: "Uses the favorite-longshot bias override and fade logic.",
    onText: "On = favorite auto-exec and cheap-longshot fade are active.",
    offText: "Off = no favorite-bias override or fade.",
  },
  {
    key: "throughputRecoveryEnabled",
    label: "Threshold Recovery",
    description: "Lets the engine relax filters in small steps if too few trades survive.",
    onText: "On = engine can widen gates to improve volume.",
    offText: "Off = thresholds stay strict all cycle.",
  },
  {
    key: "exploratoryFallbackEnabled",
    label: "Exploratory Fallback",
    description: "Allows micro-size fallback candidates when normal flow is too sparse.",
    onText: "On = more fallback activity when signal is thin.",
    offText: "Off = no exploratory filler trades.",
  },
  {
    key: "replacementEnabled",
    label: "Incumbent Replacement",
    description: "Allows a blocked challenger to replace a weaker incumbent resting order when the utility delta is large enough.",
    onText: "On = conflict-blocked orders can be evaluated for replacement.",
    offText: "Off = conflicts stay blocked without replacement evaluation.",
  },
  {
    key: "orderMaintenanceEnabled",
    label: "Stale Order Maintenance",
    description: "Runs keep-vs-cancel-vs-reprice logic over existing resting orders before new execution.",
    onText: "On = stale orders can be canceled or repriced automatically in live mode.",
    offText: "Off = resting orders are left untouched.",
  },
  {
    key: "watchlistPromotionEnabled",
    label: "Watchlist Promotion",
    description: "Keeps WATCHLIST names alive across cycles and promotes them when they improve enough.",
    onText: "On = improving watchlist names can re-enter the execution queue.",
    offText: "Off = watchlist names remain observational only.",
  },
  {
    key: "adaptiveLearningEnabled",
    label: "Adaptive Learning",
    description: "Allows bounded false-negative learning recommendations to become active in gate calculations.",
    onText: "On = small bounded recommendation deltas can influence live gating.",
    offText: "Off = learning remains recommendation-only.",
  },
  {
    key: "liquidationAdvisoryEnabled",
    label: "Near-Close Advisory",
    description: "Evaluates held positions near resolution and emits hold/trim/flatten recommendations.",
    onText: "On = liquidation recommendations are generated and stored.",
    offText: "Off = no liquidation advisory pass.",
  },
];

function formatPercent(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(digits)}%`;
}

function formatUsd(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `$${value.toFixed(digits)}`;
}

function formatNumber(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return value.toFixed(digits);
}

function formatGateMiss(
  value: number | null | undefined,
  unit: "probability" | "usd" | "count" | "severity",
) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  if (unit === "probability") return formatPercent(value);
  if (unit === "usd") return formatUsd(value);
  if (unit === "count") return value.toFixed(0);
  return `${value.toFixed(0)} lvl`;
}

export function PredictionAutomationPanel() {
  const {
    mode,
    setMode,
    execute,
    setExecute,
    categories,
    categorySet,
    toggleCategory,
    controls,
    updateControl,
    resetControls,
    autoLoop,
    setAutoLoop,
    cadenceMinutes,
    setCadenceMinutes,
    summary,
    attribution,
    loading,
    attributionLoading,
    error,
    attributionError,
    runCycle,
  } = usePredictionAutomation();

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="h-4 w-4 text-sky-300" />
          Prediction Market Auto-Trader
        </CardTitle>
        <p className="text-xs text-slate-400">
          One-click game-theory execution for crypto, sports, politics, esports, weather, stocks, and macro contracts
          with mode-based risk controls. Returns are not guaranteed.
        </p>
      </CardHeader>

      <CardContent className="space-y-4 text-xs">
        <div className="grid gap-2 xl:grid-cols-4">
          {modeOptions.map((option) => {
            const active = mode === option.value;
            return (
              <button
                key={option.value}
                onClick={() => setMode(option.value)}
                className={cn(
                  "rounded-lg border p-2 text-left transition-all",
                  active
                    ? "border-sky-500/60 bg-sky-500/10 text-sky-100"
                    : "border-slate-800 bg-slate-950/50 text-slate-300 hover:border-slate-700",
                )}
              >
                <p className="text-xs font-semibold">{option.label}</p>
                <p className="mt-1 text-[11px] text-slate-400">{option.description}</p>
              </button>
            );
          })}
        </div>

        <div className="grid gap-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
            <p className="text-[11px] text-slate-400">Execution</p>
            <button
              onClick={() => setExecute((value) => !value)}
              className={cn(
                "mt-1 w-full rounded-md border px-2 py-1.5 text-xs font-semibold transition-all",
                execute
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                  : "border-amber-500/50 bg-amber-500/10 text-amber-300",
              )}
            >
              {execute ? "Live Execute (Kalshi Demo)" : "Simulation Only"}
            </button>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
            <p className="text-[11px] text-slate-400">Auto Loop</p>
            <button
              onClick={() => setAutoLoop((value) => !value)}
              className={cn(
                "mt-1 w-full rounded-md border px-2 py-1.5 text-xs font-semibold transition-all",
                autoLoop
                  ? "border-sky-500/50 bg-sky-500/15 text-sky-200"
                  : "border-slate-700 bg-slate-900/70 text-slate-300",
              )}
            >
              {autoLoop ? "Running" : "Stopped"}
            </button>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
            <p className="text-[11px] text-slate-400">Cadence (minutes)</p>
            <Input
              type="number"
              min={1}
              step={1}
              value={cadenceMinutes}
              onChange={(event) => setCadenceMinutes(Math.max(1, Number(event.target.value || 1)))}
              className="mt-1 h-8"
            />
          </div>

          <Button onClick={() => void runCycle()} disabled={loading} className="h-auto py-2">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Run Cycle
          </Button>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
          <p className="mb-2 text-[11px] text-slate-400">Categories</p>
          <div className="flex flex-wrap gap-2">
            {categoryOptions.map((category) => {
              const active = categorySet.has(category);
              return (
                <button
                  key={category}
                  onClick={() => toggleCategory(category)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-[11px] font-medium transition-all",
                    active
                      ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-200"
                      : "border-slate-700 bg-slate-900 text-slate-400",
                  )}
                >
                  {category}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Selected: {categories.join(", ")}</p>
        </div>

        <details className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[11px] font-semibold text-sky-200">
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Execution Controls
            </span>
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                resetControls();
              }}
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] text-slate-300 transition-colors hover:border-slate-600 hover:text-slate-100"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          </summary>

          <div className="mt-3 space-y-3">
            <p className="text-[11px] text-slate-400">
              These controls change real engine gates. Lowering filters increases order volume but usually weakens quality.
              Raising filters reduces order count but demands stronger setups.
            </p>

            <div className="grid gap-3 xl:grid-cols-2">
              {sliderControls.map((control) => {
                const value = controls[control.key] as number;
                return (
                  <div key={control.key} className="rounded-md border border-slate-800 bg-slate-900/60 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold text-slate-100">{control.label}</p>
                      <span className="text-[11px] text-cyan-200">{control.format(value)}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">{control.description}</p>
                    <input
                      type="range"
                      min={control.min}
                      max={control.max}
                      step={control.step}
                      value={value}
                      onChange={(event) => updateControl(control.key, Number(event.target.value))}
                      className="mt-2 w-full accent-cyan-400"
                    />
                    <p className="mt-2 text-[10px] text-slate-500">{control.effectLow}</p>
                    <p className="text-[10px] text-slate-500">{control.effectHigh}</p>
                  </div>
                );
              })}
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
              {toggleControls.map((control) => {
                const enabled = controls[control.key] as boolean;
                return (
                  <div key={control.key} className="rounded-md border border-slate-800 bg-slate-900/60 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-[11px] font-semibold text-slate-100">{control.label}</p>
                        <p className="mt-1 text-[11px] text-slate-400">{control.description}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateControl(control.key, !enabled)}
                        className={cn(
                          "rounded-md border px-2 py-1 text-[11px] font-semibold transition-all",
                          enabled
                            ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                            : "border-slate-700 bg-slate-950 text-slate-400",
                        )}
                      >
                        {enabled ? "ON" : "OFF"}
                      </button>
                    </div>
                    <p className="mt-2 text-[10px] text-slate-500">{enabled ? control.onText : control.offText}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </details>

        {error ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-red-300">{error}</div>
        ) : null}

        {summary ? (
          <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={summary.executed ? "positive" : "warning"}>
                {summary.executed ? "Live Orders Enabled" : "Simulation"}
              </Badge>
              <Badge variant="default">Provider: {summary.provider}</Badge>
              <Badge variant="default">Mode: {summary.mode}</Badge>
              <Badge variant="default">Regime: {summary.inferredRegime.label}</Badge>
              <Badge variant="default">Regime Confidence: {(summary.inferredRegime.confidence * 100).toFixed(0)}%</Badge>
            </div>

            <div className="grid gap-2 text-[11px] text-slate-300 md:grid-cols-4">
              <div className="rounded-md border border-slate-800 bg-slate-900/60 p-2">
                <p className="text-slate-500">Account Balance</p>
                <p className="font-semibold">${summary.accountBalanceUsd.toLocaleString()}</p>
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-900/60 p-2">
                <p className="text-slate-500">Daily Risk Cap</p>
                <p className="font-semibold">${summary.maxDailyRiskUsd.toLocaleString()}</p>
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-900/60 p-2">
                <p className="text-slate-500">Planned Stake</p>
                <p className="font-semibold">${summary.totalStakePlannedUsd.toLocaleString()}</p>
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-900/60 p-2">
                <p className="text-slate-500">Placed Stake</p>
                <p className="font-semibold">${summary.totalStakePlacedUsd.toLocaleString()}</p>
              </div>
            </div>

            <div className="space-y-2">
              {summary.candidates.length ? (
                summary.candidates.map((candidate) => (
                  <div
                    key={`${candidate.ticker}-${candidate.side}`}
                    className="rounded-md border border-slate-800 bg-slate-900/70 p-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-slate-100">{candidate.title}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="default">{candidate.category}</Badge>
                        <Badge variant={candidate.side === "YES" ? "positive" : "negative"}>{candidate.side}</Badge>
                        <Badge variant="default">{candidate.ticker}</Badge>
                      </div>
                    </div>

                    <div className="mt-1 grid gap-2 text-[11px] text-slate-300 md:grid-cols-4">
                      <span>Market: {(candidate.marketProb * 100).toFixed(1)}%</span>
                      <span>
                        Raw:{" "}
                        {candidate.rawModelProb !== undefined ? `${(candidate.rawModelProb * 100).toFixed(1)}%` : "n/a"}
                      </span>
                      <span>Model: {(candidate.modelProb * 100).toFixed(1)}%</span>
                      <span>
                        Rulebook:{" "}
                        {candidate.rulebookProbLower !== undefined && candidate.rulebookProbUpper !== undefined
                          ? `${(candidate.rulebookProbLower * 100).toFixed(1)}-${(candidate.rulebookProbUpper * 100).toFixed(1)}%`
                          : "n/a"}
                      </span>
                      <span>
                        Coherent:{" "}
                        {candidate.coherentFairProb !== undefined ? `${(candidate.coherentFairProb * 100).toFixed(1)}%` : "n/a"}
                      </span>
                      <span>Edge: {(candidate.edge * 100).toFixed(2)}%</span>
                      <span>Confidence: {(candidate.confidence * 100).toFixed(0)}%</span>
                      <span>Verdict: {candidate.verdict ?? (candidate.side === "YES" ? "BUY_YES" : "BUY_NO")}</span>
                      <span>Type: {candidate.opportunityType ?? "TRADE"}</span>
                      <span>Strategy: {candidate.strategyTags?.slice(0, 2).join(", ") || "Baseline"}</span>
                      <span>Transform: {candidate.probabilityTransform ?? "n/a"}</span>
                      <span>Calib: {candidate.calibrationMethod ?? "n/a"}</span>
                      <span>Score: {candidate.compositeScore?.toFixed(4) ?? "n/a"}</span>
                      <span>Net Alpha: {candidate.netAlphaUsd !== undefined ? `$${candidate.netAlphaUsd.toFixed(2)}` : "n/a"}</span>
                      <span>Port Wt: {candidate.portfolioWeight !== undefined ? `${(candidate.portfolioWeight * 100).toFixed(1)}%` : "n/a"}</span>
                      <span>Contracts: {candidate.recommendedContracts}</span>
                      <span>Limit: {candidate.limitPriceCents}c</span>
                      <span>Stake: ${candidate.recommendedStakeUsd.toFixed(2)}</span>
                      <span>EV/$: {(candidate.expectedValuePerDollarRisked * 100).toFixed(2)}%</span>
                      <span>Horizon: {(candidate.timeToCloseDays ?? 0).toFixed(2)}d</span>
                      <span>
                        Exec:{" "}
                        {candidate.executionPlan
                          ? `${candidate.executionPlan.role} ${candidate.executionPlan.limitPriceCents}c ${(candidate.executionPlan.fillProbability * 100).toFixed(0)}%`
                          : "n/a"}
                      </span>
                      <span>
                        Experts:{" "}
                        {candidate.expertWeights?.length
                          ? candidate.expertWeights
                              .filter((row) => row.weight > 0.05)
                              .slice(0, 2)
                              .map((row) => `${row.expert} ${(row.weight * 100).toFixed(0)}%`)
                              .join(", ")
                          : "n/a"}
                      </span>
                    </div>

                    <p className="mt-1 text-[11px] text-slate-400">
                      {candidate.executionStatus}: {candidate.executionMessage}
                    </p>

                    {candidate.incumbentComparison || candidate.watchlistState || candidate.silentClock || candidate.leadLag || candidate.liquidationRecommendation || candidate.orderMaintenance ? (
                      <div className="mt-2 space-y-1 text-[11px] text-slate-400">
                        {candidate.incumbentComparison ? (
                          <p>
                            Replacement: {candidate.incumbentComparison.action} | delta {formatNumber(candidate.incumbentComparison.replacementScoreDelta, 4)} |{" "}
                            incumbent {candidate.incumbentComparison.incumbentSource} {candidate.incumbentComparison.incumbentTicker} {candidate.incumbentComparison.incumbentSide}
                          </p>
                        ) : null}
                        {candidate.watchlistState ? (
                          <p>
                            Watchlist: {candidate.watchlistState.status} | age {formatNumber(candidate.watchlistState.ageHours, 1)}h | cycles{" "}
                            {candidate.watchlistState.cyclesObserved} | promo {formatNumber(candidate.watchlistState.promotionScore, 4)}
                          </p>
                        ) : null}
                        {candidate.silentClock ? (
                          <p>
                            Silent clock: penalty {formatPercent(candidate.silentClock.decayPenalty)} | checkpoint{" "}
                            {formatPercent(candidate.silentClock.checkpointProgress)} | {candidate.silentClock.rationale}
                          </p>
                        ) : null}
                        {candidate.leadLag ? (
                          <p>
                            Lead-lag: {candidate.leadLag.leadTicker} -&gt; {candidate.leadLag.lagTicker} | signal{" "}
                            {formatPercent(candidate.leadLag.signalMagnitude)} | conf {formatPercent(candidate.leadLag.confidence)}
                          </p>
                        ) : null}
                        {candidate.orderMaintenance ? (
                          <p>
                            Stale-order maintenance: {candidate.orderMaintenance.action} | improvement{" "}
                            {formatNumber(candidate.orderMaintenance.expectedImprovement, 4)} | stale{" "}
                            {formatPercent(candidate.orderMaintenance.staleHazard)}
                          </p>
                        ) : null}
                        {candidate.liquidationRecommendation ? (
                          <p>
                            Liquidation: {candidate.liquidationRecommendation.action} | exit edge{" "}
                            {formatUsd(
                              candidate.liquidationRecommendation.valueExitNowUsd -
                                candidate.liquidationRecommendation.valueHoldToResolutionUsd,
                            )}{" "}
                            | TTR {formatNumber(candidate.liquidationRecommendation.timeToResolutionDays, 3)}d
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {candidate.strategicBreakdown ? (
                      <details className="mt-2 rounded border border-slate-800 bg-slate-950/60 p-2">
                        <summary className="cursor-pointer text-[11px] font-semibold text-sky-200">
                          AI Strategic Breakdown
                        </summary>

                        <div className="mt-2 space-y-2 text-[11px] text-slate-300">
                          <div className="grid gap-2 md:grid-cols-2">
                            <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
                              <p className="text-slate-400">Market Summary</p>
                              <p>
                                {candidate.strategicBreakdown.marketSummary.contract} | Implied{" "}
                                {candidate.strategicBreakdown.marketSummary.marketImpliedProbability.toFixed(2)}% | True{" "}
                                {candidate.strategicBreakdown.marketSummary.estimatedTrueProbability.toFixed(2)}%
                              </p>
                              <p>
                                Edge {candidate.strategicBreakdown.marketSummary.edge.toFixed(2)}% | Confidence{" "}
                                {candidate.strategicBreakdown.marketSummary.confidence1to10.toFixed(1)}/10
                              </p>
                            </div>

                            <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
                              <p className="text-slate-400">Thesis</p>
                              <p>{candidate.strategicBreakdown.thesis.coreReason}</p>
                              <p className="mt-1 text-slate-400">
                                Drivers: {candidate.strategicBreakdown.thesis.mispricingDrivers.join(", ")}
                              </p>
                            </div>
                          </div>

                          <div className="grid gap-2 md:grid-cols-2">
                            <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
                              <p className="text-slate-400">Probability Engine</p>
                              <p>
                                Prior {(candidate.strategicBreakdown.probabilityEngine.prior * 100).toFixed(1)}% |
                                Posterior {(candidate.strategicBreakdown.probabilityEngine.posterior * 100).toFixed(1)}%
                              </p>
                              <p>
                                Best/Base/Worst:{" "}
                                {(candidate.strategicBreakdown.probabilityEngine.bestCase.probability * 100).toFixed(1)}%
                                /{(candidate.strategicBreakdown.probabilityEngine.baseCase.probability * 100).toFixed(1)}%
                                /{(candidate.strategicBreakdown.probabilityEngine.worstCase.probability * 100).toFixed(1)}%
                              </p>
                            </div>

                            <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
                              <p className="text-slate-400">Microstructure + Risk</p>
                              <p>
                                Spread {(candidate.strategicBreakdown.marketMicrostructure.spread * 100).toFixed(1)}% |
                                Liquidity {(candidate.strategicBreakdown.marketMicrostructure.liquidityScore * 100).toFixed(0)}%
                              </p>
                              <p>
                                {candidate.strategicBreakdown.marketMicrostructure.efficiency} |{" "}
                                {candidate.strategicBreakdown.marketMicrostructure.manipulationRisk} manipulation risk
                              </p>
                              <p className="mt-1">
                                {candidate.strategicBreakdown.outputFormat.positionSizingSuggestion}
                              </p>
                            </div>
                          </div>
                        </div>
                      </details>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-md border border-slate-800 bg-slate-900/60 p-3 text-slate-400">
                  <TimerReset className="mb-1 h-4 w-4" />
                  No candidate passed the current mode thresholds.
                </div>
              )}
            </div>

            {summary.warnings.length ? (
              <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-amber-200">
                <p className="flex items-center gap-1 font-medium">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Warnings
                </p>
                {summary.warnings.map((warning) => (
                  <p key={warning}>- {warning}</p>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-emerald-200">
                <p className="flex items-center gap-1">
                  <Zap className="h-3.5 w-3.5" />
                  Risk filters are clear for current selections.
                </p>
              </div>
            )}

            {summary.shadowBaselines?.length ? (
              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                <p className="mb-2 flex items-center gap-1 text-[11px] font-semibold text-sky-200">
                  <Brain className="h-3.5 w-3.5" />
                  Shadow Baselines
                </p>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {summary.shadowBaselines.map((baseline) => (
                    <div key={baseline.profile} className="rounded-md border border-slate-800 bg-slate-950/60 p-2 text-[11px] text-slate-300">
                      <p className="font-semibold text-slate-100">{baseline.label}</p>
                      <p className="mt-1 text-slate-400">{baseline.description}</p>
                      <p className="mt-2">
                        Candidates {baseline.candidateCount} | Actionable {baseline.actionables}
                      </p>
                      <p>
                        Stake {formatUsd(baseline.plannedStakeUsd)} | Fill {formatPercent(baseline.fillRateEstimate)}
                      </p>
                      <p>
                        Net alpha {formatUsd(baseline.expectedNetAlphaUsd)} | Markout {formatUsd(baseline.expectedNetMarkoutAfterFeesUsd)}
                      </p>
                      <p>
                        Expiry {formatUsd(baseline.expectedExpiryPnlUsd)} | Cancel {formatPercent(baseline.cancellationRateEstimate)}
                      </p>
                      <p>
                        Adverse sel. {formatPercent(baseline.adverseSelectionRate)} | Exec edge {formatPercent(baseline.avgExecutionAdjustedEdge)}
                      </p>
                      <p className="mt-1 text-slate-400">Top: {baseline.topTickers.length ? baseline.topTickers.join(", ") : "none"}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
              <p className="mb-2 flex items-center gap-1 text-[11px] font-semibold text-sky-200">
                <Brain className="h-3.5 w-3.5" />
                Execution Attribution
              </p>

              {attributionError ? (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-red-300">{attributionError}</div>
              ) : attributionLoading && !attribution ? (
                <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3 text-slate-400">
                  <Loader2 className="mb-1 h-4 w-4 animate-spin" />
                  Loading recent execution attribution.
                </div>
              ) : attribution ? (
                <div className="space-y-3">
                  <div className="grid gap-2 text-[11px] text-slate-300 md:grid-cols-6">
                    <div className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
                      <p className="text-slate-500">Decisions / Placed</p>
                      <p className="font-semibold">
                        {attribution.totals.decisions} / {attribution.totals.placed}
                      </p>
                    </div>
                    <div className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
                      <p className="text-slate-500">Failed / Skipped</p>
                      <p className="font-semibold">
                        {attribution.totals.failed} / {attribution.totals.skipped}
                      </p>
                    </div>
                    <div className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
                      <p className="text-slate-500">Avg Net Alpha</p>
                      <p className="font-semibold">{formatUsd(attribution.totals.avgNetAlphaUsd)}</p>
                    </div>
                    <div className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
                      <p className="text-slate-500">30s / 2m Markout</p>
                      <p className="font-semibold">
                        {formatPercent(attribution.totals.avgMarkout30s)} / {formatPercent(attribution.totals.avgMarkout2m)}
                      </p>
                    </div>
                    <div className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
                      <p className="text-slate-500">Expiry Markout</p>
                      <p className="font-semibold">{formatPercent(attribution.totals.avgMarkoutExpiry)}</p>
                    </div>
                    <div className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
                      <p className="text-slate-500">Balance Reconciliation</p>
                      <p className="font-semibold">
                        {attribution.totals.matchedReconciliations}/{attribution.totals.placed} matched
                      </p>
                      <p className="text-slate-400">
                        Drift {formatUsd(attribution.totals.avgCashDeltaDriftUsd)} | Fee {formatUsd(attribution.totals.avgFeeDriftUsd)}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    <div className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
                      <p className="text-[11px] text-slate-400">Replacement Engine</p>
                      <p className="mt-1 text-[11px] text-slate-300">
                        Accepted {attribution.replacement?.accepted ?? 0} | Rejected {attribution.replacement?.rejected ?? 0}
                      </p>
                      <p className="text-[11px] text-slate-300">
                        Avg delta {formatNumber(attribution.replacement?.avgScoreDelta, 4)} | Avg friction{" "}
                        {formatNumber(attribution.replacement?.avgReplacementCost, 4)}
                      </p>
                    </div>

                    <div className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
                      <p className="text-[11px] text-slate-400">Stale Order Maintenance</p>
                      <p className="mt-1 text-[11px] text-slate-300">
                        Keep {attribution.orderMaintenance?.keep ?? 0} | Reprice {attribution.orderMaintenance?.reprice ?? 0} | Cancel{" "}
                        {attribution.orderMaintenance?.cancel ?? 0}
                      </p>
                      <p className="text-[11px] text-slate-300">
                        Avg improvement {formatNumber(attribution.orderMaintenance?.avgExpectedImprovement, 4)}
                      </p>
                    </div>

                    <div className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
                      <p className="text-[11px] text-slate-400">Watchlist Lifecycle</p>
                      <p className="mt-1 text-[11px] text-slate-300">
                        Active {attribution.watchlist?.active ?? 0} | Promotions {attribution.watchlist?.promotions ?? 0}
                      </p>
                      <p className="text-[11px] text-slate-300">
                        Avg age {formatNumber(attribution.watchlist?.avgWatchlistHours, 1)}h | Promoted hit{" "}
                        {formatPercent(attribution.watchlist?.promotedHitRate)}
                      </p>
                    </div>

                    <div className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
                      <p className="text-[11px] text-slate-400">False-Negative Learning</p>
                      <p className="mt-1 text-[11px] text-slate-300">
                        Active {attribution.learning?.active ? "yes" : "no"} | Recommendations{" "}
                        {attribution.learning?.recommendations.length ?? 0}
                      </p>
                      <p className="text-[11px] text-slate-300">
                        Lookback {attribution.learning?.lookbackHours ?? 0}h
                      </p>
                    </div>

                    <div className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
                      <p className="text-[11px] text-slate-400">Near-Close Liquidation</p>
                      <p className="mt-1 text-[11px] text-slate-300">
                        Hold {attribution.liquidation?.hold ?? 0} | Trim {attribution.liquidation?.trim ?? 0} | Flatten{" "}
                        {attribution.liquidation?.flatten ?? 0}
                      </p>
                      <p className="text-[11px] text-slate-300">
                        Avg exit edge {formatUsd(attribution.liquidation?.avgExitEdgeUsd)}
                      </p>
                    </div>

                    <div className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
                      <p className="text-[11px] text-slate-400">Signal Overlays</p>
                      <p className="mt-1 text-[11px] text-slate-300">
                        Silent clock {attribution.overlays?.silentClockCount ?? 0} | Lead-lag {attribution.overlays?.leadLagCount ?? 0}
                      </p>
                      <p className="text-[11px] text-slate-300">
                        Avg decay {formatPercent(attribution.overlays?.avgSilentClockPenalty)} | Avg lag {formatPercent(attribution.overlays?.avgLeadLagSignal)}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {[
                      { label: "By Expert", rows: attribution.byExpert },
                      { label: "By Health Regime", rows: attribution.byExecutionHealth },
                      { label: "By Cluster", rows: attribution.byCluster },
                      { label: "By Uncertainty", rows: attribution.byUncertaintyWidth },
                      { label: "By Toxicity", rows: attribution.byToxicity },
                      { label: "By Bootstrap", rows: attribution.byBootstrap },
                    ].map((group) => (
                      <div key={group.label} className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
                        <p className="text-[11px] text-slate-400">{group.label}</p>
                        {group.rows.length ? (
                          group.rows.map((row) => (
                            <p key={`${group.label}-${row.key}`} className="mt-1 text-[11px] text-slate-300">
                              {row.label} | {row.placed}/{row.decisions} placed | 30s {formatPercent(row.avgMarkout30s)} | expiry{" "}
                              {formatPercent(row.avgMarkoutExpiry)} | drift {formatUsd(row.avgCashDeltaDriftUsd)}
                            </p>
                          ))
                        ) : (
                          <p className="mt-1 text-[11px] text-slate-500">No stored executions yet.</p>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
                    <p className="text-[11px] text-slate-400">Recent Trade Forensics</p>
                    {attribution.recentTrades.length ? (
                      attribution.recentTrades.map((trade) => (
                        <p key={`${trade.recordedAt}-${trade.ticker}-${trade.side}`} className="mt-1 text-[11px] text-slate-300">
                          {trade.ticker} {trade.side} | {trade.executionStatus} | {trade.dominantExpert} | {trade.executionHealthRegime} |{" "}
                          {trade.bootstrapMode} | edge {formatPercent(trade.edge)} | exec {formatPercent(trade.executionAdjustedEdge)} | 30s{" "}
                          {formatPercent(trade.markout30s)} | expiry {formatPercent(trade.markoutExpiry)} | tox {formatPercent(trade.toxicityScore)} |{" "}
                          uncert {formatPercent(trade.uncertaintyWidth)} | inv {formatNumber(trade.inventorySkew)} | cash {formatUsd(
                            trade.actualCashDeltaUsd,
                          )} | drift {formatUsd(trade.cashDeltaDriftUsd)} | fee {formatUsd(trade.inferredActualFeeUsd)}
                        </p>
                      ))
                    ) : (
                      <p className="mt-1 text-[11px] text-slate-500">No executed-candidate attribution has been stored yet.</p>
                    )}
                  </div>

                  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
                    <p className="text-[11px] text-slate-400">Selection Control</p>
                    {attribution.selectionControl ? (
                      <div className="space-y-2">
                        <div className="grid gap-2 md:grid-cols-2">
                          <div className="rounded border border-slate-800 bg-slate-900/60 p-2 text-[11px] text-slate-300">
                            <p className="text-slate-400">Executed</p>
                            <p>
                              Count {attribution.selectionControl.executed.count} | Edge{" "}
                              {formatPercent(attribution.selectionControl.executed.avgEdge)} | Exec{" "}
                              {formatPercent(attribution.selectionControl.executed.avgExecutionAdjustedEdge)}
                            </p>
                            <p>
                              Confidence {formatPercent(attribution.selectionControl.executed.avgConfidence)} | Score{" "}
                              {formatNumber(attribution.selectionControl.executed.avgCompositeScore)}
                            </p>
                          </div>
                          <div className="rounded border border-slate-800 bg-slate-900/60 p-2 text-[11px] text-slate-300">
                            <p className="text-slate-400">Near Misses</p>
                            <p>
                              Count {attribution.selectionControl.nearMisses.count} | Edge{" "}
                              {formatPercent(attribution.selectionControl.nearMisses.avgEdge)} | Exec{" "}
                              {formatPercent(attribution.selectionControl.nearMisses.avgExecutionAdjustedEdge)}
                            </p>
                            <p>
                              Confidence {formatPercent(attribution.selectionControl.nearMisses.avgConfidence)} | Score{" "}
                              {formatNumber(attribution.selectionControl.nearMisses.avgCompositeScore)} | Drift{" "}
                              {formatPercent(attribution.selectionControl.nearMisses.avgLatestQuoteDrift)}
                            </p>
                          </div>
                        </div>

                        <div className="rounded border border-slate-800 bg-slate-900/60 p-2 text-[11px] text-slate-300">
                          <p className="text-slate-400">Resolved Near Misses</p>
                          <p>
                            Count {attribution.selectionControl.resolvedNearMisses.count} | Hit{" "}
                            {formatPercent(attribution.selectionControl.resolvedNearMisses.hitRate)} | Profitable{" "}
                            {formatPercent(attribution.selectionControl.resolvedNearMisses.profitableRate)}
                          </p>
                          <p>
                            Avg CF PnL {formatUsd(attribution.selectionControl.resolvedNearMisses.avgCounterfactualPnlUsd)} | Total CF PnL{" "}
                            {formatUsd(attribution.selectionControl.resolvedNearMisses.totalCounterfactualPnlUsd)}
                          </p>
                          <p>
                            Expiry Drift {formatPercent(attribution.selectionControl.resolvedNearMisses.avgExpiryDrift)} | Quote-Expiry Div{" "}
                            {formatPercent(attribution.selectionControl.resolvedNearMisses.avgQuoteToExpiryDivergence)}
                          </p>
                        </div>

                        <div className="grid gap-2 md:grid-cols-3">
                          {[
                            { label: "False Negatives by Expert", rows: attribution.selectionControl.falseNegativesByExpert },
                            { label: "False Negatives by Cluster", rows: attribution.selectionControl.falseNegativesByCluster },
                            { label: "False Negatives by Toxicity", rows: attribution.selectionControl.falseNegativesByToxicity },
                          ].map((group) => (
                            <div key={group.label} className="rounded border border-slate-800 bg-slate-900/60 p-2">
                              <p className="text-[11px] text-slate-400">{group.label}</p>
                              {group.rows.length ? (
                                group.rows.map((row) => (
                                  <p key={`${group.label}-${row.key}`} className="mt-1 text-[11px] text-slate-300">
                                    {row.label} | {row.profitable}/{row.resolved} profitable | hit {formatPercent(row.hitRate)} | avg{" "}
                                    {formatUsd(row.avgCounterfactualPnlUsd)} | total {formatUsd(row.totalCounterfactualPnlUsd)}
                                  </p>
                                ))
                              ) : (
                                <p className="mt-1 text-[11px] text-slate-500">No resolved profitable near misses yet.</p>
                              )}
                            </div>
                          ))}
                        </div>

                        <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
                          <p className="text-[11px] text-slate-400">Near-Miss Gates</p>
                          {attribution.selectionControl.byGate.length ? (
                            attribution.selectionControl.byGate.map((gate) => (
                              <p key={gate.gate} className="mt-1 text-[11px] text-slate-300">
                                {gate.label} | {gate.count} candidates | avg miss {formatGateMiss(gate.avgMissBy, gate.unit)} | max miss{" "}
                                {formatGateMiss(gate.maxMissBy, gate.unit)}
                              </p>
                            ))
                          ) : (
                            <p className="mt-1 text-[11px] text-slate-500">No threshold gate failures recorded in this lookback window.</p>
                          )}
                        </div>

                        <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
                          <p className="text-[11px] text-slate-400">Gate Waterfall</p>
                          {attribution.selectionControl.gateWaterfall.length ? (
                            attribution.selectionControl.gateWaterfall.map((gate) => (
                              <p key={`waterfall-${gate.gate}`} className="mt-1 text-[11px] text-slate-300">
                                {gate.label} | primary {gate.primaryCount} avg {formatGateMiss(gate.avgPrimaryMissBy, gate.unit)} | secondary{" "}
                                {gate.secondaryCount} avg {formatGateMiss(gate.avgSecondaryMissBy, gate.unit)}
                              </p>
                            ))
                          ) : (
                            <p className="mt-1 text-[11px] text-slate-500">No primary/secondary gate ordering recorded in this lookback window.</p>
                          )}
                        </div>

                        <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
                          <p className="text-[11px] text-slate-400">One-Gate Looser Simulation</p>
                          {attribution.selectionControl.counterfactualByGate.length ? (
                            attribution.selectionControl.counterfactualByGate.map((gate) => (
                              <p key={`counterfactual-${gate.gate}`} className="mt-1 text-[11px] text-slate-300">
                                {gate.label} | {gate.looseningLabel} | impacted {gate.impactedCount} | extra passes {gate.additionalPasses} | hit{" "}
                                {formatPercent(gate.conversionRate)}
                              </p>
                            ))
                          ) : (
                            <p className="mt-1 text-[11px] text-slate-500">No counterfactual threshold simulations available yet.</p>
                          )}
                        </div>

                        <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
                          <p className="text-[11px] text-slate-400">Recent Near Misses</p>
                          {attribution.selectionControl.recentNearMisses.length ? (
                            attribution.selectionControl.recentNearMisses.map((miss) => (
                              <p
                                key={`${miss.recordedAt}-${miss.ticker}-${miss.side}-${miss.source}`}
                                className="mt-1 text-[11px] text-slate-300"
                              >
                                {miss.ticker} {miss.side} | {miss.source.replace("automation/", "")} | {miss.dominantExpert} |{" "}
                                {miss.cluster} | verdict {miss.verdict ?? "n/a"} | edge {formatPercent(miss.edge)} | exec{" "}
                                {formatPercent(miss.executionAdjustedEdge)} | conf {formatPercent(miss.confidence)} | score{" "}
                                {formatNumber(miss.compositeScore)} | drift {formatPercent(miss.latestQuoteDrift)} | resolved{" "}
                                {miss.resolved ? (miss.realizedHit ? "HIT" : "MISS") : "pending"} | cf {formatUsd(miss.counterfactualPnlUsd)} | div{" "}
                                {formatPercent(miss.quoteToExpiryDivergence)} | primary{" "}
                                {miss.primaryFailedGate
                                  ? `${miss.primaryFailedGate.gate}:${formatGateMiss(miss.primaryFailedGate.missBy, miss.primaryFailedGate.unit)}`
                                  : "none"}{" "}
                                | secondary{" "}
                                {miss.secondaryFailedGates.length
                                  ? miss.secondaryFailedGates
                                      .map((gate) => `${gate.gate}:${formatGateMiss(gate.missBy, gate.unit)}`)
                                      .join("; ")
                                  : "none"}{" "}
                                | gates{" "}
                                {miss.failedGates.length
                                  ? miss.failedGates
                                      .map((gate) => `${gate.gate}:${formatGateMiss(gate.missBy, gate.unit)}${gate.detail ? ` (${gate.detail})` : ""}`)
                                      .join("; ")
                                  : "none"}{" "}
                                | {miss.executionMessage ?? "No message"}
                              </p>
                            ))
                          ) : (
                            <p className="mt-1 text-[11px] text-slate-500">No strong skipped candidates in the current lookback window.</p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="mt-1 text-[11px] text-slate-500">Selection-control comparison is not available yet.</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3 text-slate-400">
                  No stored execution attribution yet.
                </div>
              )}
            </div>

            {attribution ? (
              <div className="grid gap-3 xl:grid-cols-2">
                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                  <p className="mb-2 text-[11px] font-semibold text-sky-200">Recent Replacements</p>
                  {attribution.replacement?.recent.length ? (
                    attribution.replacement.recent.map((decision) => (
                      <p key={`${decision.candidateKey}-${decision.incumbentOrderId ?? decision.incumbentTicker}`} className="mt-1 text-[11px] text-slate-300">
                        {decision.ticker} {decision.side} | {decision.action} | delta {formatNumber(decision.replacementScoreDelta, 4)} | cost{" "}
                        {formatNumber(decision.replacementCost + decision.queueResetPenalty, 4)} | incumbent {decision.incumbentSource}{" "}
                        {decision.incumbentTicker} {decision.incumbentSide}
                      </p>
                    ))
                  ) : (
                    <p className="text-[11px] text-slate-500">No replacement decisions stored yet.</p>
                  )}
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                  <p className="mb-2 text-[11px] font-semibold text-sky-200">Stale-Order Maintenance</p>
                  {attribution.orderMaintenance?.recent.length ? (
                    attribution.orderMaintenance.recent.map((decision) => (
                      <p key={decision.orderId} className="mt-1 text-[11px] text-slate-300">
                        {decision.ticker} {decision.side} | {decision.action} | keep {formatNumber(decision.evKeep, 4)} | reprice{" "}
                        {formatNumber(decision.evReprice, 4)} | cancel {formatNumber(decision.evCancel, 4)} | improve{" "}
                        {formatNumber(decision.expectedImprovement, 4)}
                      </p>
                    ))
                  ) : (
                    <p className="text-[11px] text-slate-500">No order-maintenance decisions stored yet.</p>
                  )}
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                  <p className="mb-2 text-[11px] font-semibold text-sky-200">Watchlist Table</p>
                  {attribution.watchlist?.recent.length ? (
                    attribution.watchlist.recent.map((event) => (
                      <p key={`${event.type}-${event.key}-${event.reason}`} className="mt-1 text-[11px] text-slate-300">
                        {event.ticker} {event.side} | {event.type} | promo {formatNumber(event.promotionScore, 4)} | age{" "}
                        {formatNumber(event.avgWatchlistHours, 1)}h | edge {formatPercent(event.executionAdjustedEdge ?? event.edge)} |{" "}
                        {event.reason}
                      </p>
                    ))
                  ) : (
                    <p className="text-[11px] text-slate-500">No watchlist lifecycle has been stored yet.</p>
                  )}
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                  <p className="mb-2 text-[11px] font-semibold text-sky-200">Learning Recommendations</p>
                  {attribution.learning?.recommendations.length ? (
                    attribution.learning.recommendations.map((recommendation) => (
                      <p key={recommendation.gate} className="mt-1 text-[11px] text-slate-300">
                        {recommendation.label} | samples {recommendation.sampleCount} | pnl {formatUsd(recommendation.avgCounterfactualPnlUsd)} | delta{" "}
                        {formatGateMiss(recommendation.boundedDelta, recommendation.unit)} | active {recommendation.active ? "yes" : "no"}
                      </p>
                    ))
                  ) : (
                    <p className="text-[11px] text-slate-500">No bounded false-negative learning recommendations yet.</p>
                  )}
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                  <p className="mb-2 text-[11px] font-semibold text-sky-200">Liquidation Recommendations</p>
                  {attribution.liquidation?.recent.length ? (
                    attribution.liquidation.recent.map((decision) => (
                      <p key={`${decision.ticker}-${decision.side}-${decision.action}`} className="mt-1 text-[11px] text-slate-300">
                        {decision.ticker} {decision.side} | {decision.action} | hold {formatUsd(decision.valueHoldToResolutionUsd)} | exit{" "}
                        {formatUsd(decision.valueExitNowUsd)} | cost {formatUsd(decision.liquidationCostUsd)}
                      </p>
                    ))
                  ) : (
                    <p className="text-[11px] text-slate-500">No liquidation recommendations stored yet.</p>
                  )}
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                  <p className="mb-2 text-[11px] font-semibold text-sky-200">Recent Signal Overlays</p>
                  {attribution.overlays && (attribution.overlays.recentSilentClock.length || attribution.overlays.recentLeadLag.length) ? (
                    <div className="space-y-1">
                      {attribution.overlays.recentSilentClock.map((overlay, index) => (
                        <p key={`silent-${index}`} className="text-[11px] text-slate-300">
                          Silent clock | checkpoint {formatPercent(overlay.checkpointProgress)} | penalty {formatPercent(overlay.decayPenalty)} |{" "}
                          {overlay.rationale}
                        </p>
                      ))}
                      {attribution.overlays.recentLeadLag.map((overlay, index) => (
                        <p key={`leadlag-${index}`} className="text-[11px] text-slate-300">
                          Lead-lag {overlay.leadTicker} -&gt; {overlay.lagTicker} | signal {formatPercent(overlay.signalMagnitude)} | conf{" "}
                          {formatPercent(overlay.confidence)}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500">No signal overlays stored yet.</p>
                  )}
                </div>
              </div>
            ) : null}

            {summary.portfolioRanking ? (
              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                <p className="mb-2 flex items-center gap-1 text-[11px] font-semibold text-sky-200">
                  <Brain className="h-3.5 w-3.5" />
                  AI Portfolio Ranking
                </p>

                <div className="grid gap-2 md:grid-cols-2">
                  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
                    <p className="text-[11px] text-slate-400">Top 3 Highest EV</p>
                    {summary.portfolioRanking.highestEv.length ? (
                      summary.portfolioRanking.highestEv.map((item) => (
                        <p key={`ev-${item.ticker}`} className="mt-1 text-[11px] text-slate-300">
                          {item.ticker} | Edge {(item.edge * 100).toFixed(2)}% | EV/$ {(item.expectedValuePerDollarRisked * 100).toFixed(2)}%
                        </p>
                      ))
                    ) : (
                      <p className="mt-1 text-[11px] text-slate-500">No qualifying setups.</p>
                    )}
                  </div>

                  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
                    <p className="text-[11px] text-slate-400">Top 3 Safest</p>
                    {summary.portfolioRanking.safest.length ? (
                      summary.portfolioRanking.safest.map((item) => (
                        <p key={`safe-${item.ticker}`} className="mt-1 text-[11px] text-slate-300">
                          {item.ticker} | Confidence {(item.confidence * 100).toFixed(0)}% | Horizon {item.timeToCloseDays.toFixed(2)}d
                        </p>
                      ))
                    ) : (
                      <p className="mt-1 text-[11px] text-slate-500">No qualifying setups.</p>
                    )}
                  </div>

                  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
                    <p className="text-[11px] text-slate-400">Top 3 Asymmetric Longshots</p>
                    {summary.portfolioRanking.asymmetricLongshots.length ? (
                      summary.portfolioRanking.asymmetricLongshots.map((item) => (
                        <p key={`long-${item.ticker}`} className="mt-1 text-[11px] text-slate-300">
                          {item.ticker} | Price lean {item.verdict} | AdjEdge {(item.confidenceAdjustedEdge * 100).toFixed(2)}%
                        </p>
                      ))
                    ) : (
                      <p className="mt-1 text-[11px] text-slate-500">No qualifying setups.</p>
                    )}
                  </div>

                  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
                    <p className="text-[11px] text-slate-400">Top Traps to Avoid</p>
                    {summary.portfolioRanking.trapsToAvoid.length ? (
                      summary.portfolioRanking.trapsToAvoid.map((item) => (
                        <p key={`trap-${item.ticker}`} className="mt-1 text-[11px] text-slate-300">
                          {item.ticker}: {item.reason}
                        </p>
                      ))
                    ) : (
                      <p className="mt-1 text-[11px] text-slate-500">No trap flags right now.</p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
