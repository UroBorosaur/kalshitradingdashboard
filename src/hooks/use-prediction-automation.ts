"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  AutomationControls,
  ExecutionAttributionSummary,
  AutomationMode,
  AutomationRunSummary,
  PredictionCategory,
} from "@/lib/prediction/types";

const allCategories: PredictionCategory[] = [
  "BITCOIN",
  "SPORTS",
  "POLITICS",
  "ESPORTS",
  "WEATHER",
  "STOCKS",
  "MACRO",
  "OTHER",
];
const baseCategories: PredictionCategory[] = [...allCategories];
const AUTOMATION_CONTROLS_STORAGE_KEY = "prediction-automation-controls";
const AUTOMATION_ATTRIBUTION_LOOKBACK_HOURS = 72;
const DEFAULT_AUTOMATION_CONTROLS: AutomationControls = {
  edgeMultiplier: 1,
  confidenceShift: 0,
  spreadMultiplier: 1,
  liquidityMultiplier: 1,
  highProbModelMin: 0.9,
  highProbMarketMin: 0.82,
  highProbabilityEnabled: true,
  favoriteLongshotEnabled: true,
  throughputRecoveryEnabled: true,
  exploratoryFallbackEnabled: true,
  replacementEnabled: true,
  replacementMinDelta: 0.02,
  orderMaintenanceEnabled: true,
  cancelReplaceMinImprovement: 0.01,
  watchlistPromotionEnabled: true,
  watchlistPromotionThreshold: 0.035,
  adaptiveLearningEnabled: false,
  liquidationAdvisoryEnabled: true,
};

function defaultCadence(mode: AutomationMode) {
  if (mode === "CONSERVATIVE") return 30;
  if (mode === "MIXED") return 20;
  if (mode === "AI") return 12;
  return 10;
}

export function usePredictionAutomation() {
  const [mode, setMode] = useState<AutomationMode>("MIXED");
  const [execute, setExecute] = useState(false);
  const [categories, setCategories] = useState<PredictionCategory[]>(baseCategories);
  const [autoLoop, setAutoLoop] = useState(false);
  const [cadenceMinutes, setCadenceMinutes] = useState(defaultCadence("MIXED"));
  const [controls, setControls] = useState<AutomationControls>(DEFAULT_AUTOMATION_CONTROLS);

  const [summary, setSummary] = useState<AutomationRunSummary | null>(null);
  const [attribution, setAttribution] = useState<ExecutionAttributionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [attributionLoading, setAttributionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attributionError, setAttributionError] = useState<string | null>(null);

  const fetchAttribution = useCallback(async () => {
    setAttributionLoading(true);
    setAttributionError(null);
    try {
      const response = await fetch(
        `/api/automation/attribution?hours=${AUTOMATION_ATTRIBUTION_LOOKBACK_HOURS}&recentTradeLimit=12&bucketLimit=6`,
      );
      const json = (await response.json()) as {
        ok: boolean;
        attribution?: ExecutionAttributionSummary;
        error?: string;
      };

      if (!response.ok || !json.ok || !json.attribution) {
        throw new Error(json.error ?? "Attribution fetch failed");
      }

      setAttribution(json.attribution);
    } catch (err) {
      setAttributionError((err as Error).message);
    } finally {
      setAttributionLoading(false);
    }
  }, []);

  const runCycle = useCallback(
    async (override?: Partial<{ execute: boolean; mode: AutomationMode; categories: PredictionCategory[] }>) => {
      setLoading(true);
      setError(null);

      try {
        const payload = {
          mode: override?.mode ?? mode,
          execute: override?.execute ?? execute,
          categories: override?.categories ?? categories,
          controls,
        };

        const response = await fetch("/api/automation/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const json = (await response.json()) as {
          ok: boolean;
          summary?: AutomationRunSummary;
          error?: string;
        };

        if (!response.ok || !json.ok || !json.summary) {
          throw new Error(json.error ?? "Automation run failed");
        }

        setSummary(json.summary);
        await fetchAttribution();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [categories, controls, execute, fetchAttribution, mode],
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(AUTOMATION_CONTROLS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<AutomationControls>;
      setControls((current) => ({ ...current, ...parsed }));
    } catch {
      // Ignore malformed persisted controls.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(AUTOMATION_CONTROLS_STORAGE_KEY, JSON.stringify(controls));
  }, [controls]);

  useEffect(() => {
    void fetchAttribution();
  }, [fetchAttribution]);

  useEffect(() => {
    if (!autoLoop) return;

    void runCycle();

    const intervalMs = Math.max(1, cadenceMinutes) * 60 * 1000;
    const id = window.setInterval(() => {
      void runCycle();
    }, intervalMs);

    return () => window.clearInterval(id);
  }, [autoLoop, cadenceMinutes, runCycle]);

  useEffect(() => {
    setCadenceMinutes(defaultCadence(mode));
    if (mode === "AI") {
      setCategories((prev) => {
        const next = new Set(prev);
        for (const category of allCategories) next.add(category);
        return [...next];
      });
    }
  }, [mode]);

  const categorySet = useMemo(() => new Set(categories), [categories]);

  function toggleCategory(category: PredictionCategory) {
    setCategories((prev) => {
      const exists = prev.includes(category);
      if (exists) {
        const next = prev.filter((value) => value !== category);
        return next.length ? next : [category];
      }
      return [...prev, category];
    });
  }

  function updateControl<K extends keyof AutomationControls>(key: K, value: AutomationControls[K]) {
    setControls((prev) => ({ ...prev, [key]: value }));
  }

  function resetControls() {
    setControls(DEFAULT_AUTOMATION_CONTROLS);
  }

  return {
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
    fetchAttribution,
  };
}
