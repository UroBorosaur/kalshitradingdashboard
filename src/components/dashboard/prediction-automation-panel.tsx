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
    "edgeMultiplier" | "confidenceShift" | "spreadMultiplier" | "liquidityMultiplier" | "highProbModelMin"
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
    label: "High-Prob Floor",
    min: 0.5,
    max: 0.97,
    step: 0.01,
    description: "Minimum model probability for the high-probability, low-EV execution lane.",
    effectLow: "Lower = more high-probability fallback orders.",
    effectHigh: "Higher = fewer fallback orders, stronger hit-rate target.",
    format: (value) => `${(value * 100).toFixed(0)}%`,
  },
];

const toggleControls: Array<{
  key: keyof Pick<
    AutomationControls,
    "highProbabilityEnabled" | "favoriteLongshotEnabled" | "throughputRecoveryEnabled" | "exploratoryFallbackEnabled"
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
];

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
    loading,
    error,
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
