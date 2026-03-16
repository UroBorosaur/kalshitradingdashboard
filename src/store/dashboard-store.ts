"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { MonthlyMetricView } from "@/lib/metrics";
import type { SetupKey, Trade } from "@/lib/types";

export type AccountPill = "ALL" | "DEMO" | "MAIN" | "MISSED";
export type TradesTab = "OPEN" | "CLOSED";
export type RangeToggle = "H" | "D" | "W" | "M" | "3M" | "Y";
export type DataMode = "MOCK" | "LIVE";

interface DashboardState {
  accountPill: AccountPill;
  dataMode: DataMode;
  setupFilter: "ALL" | SetupKey;
  symbolFilter: "ALL" | string;
  directionFilter: "ALL" | Trade["direction"];
  regimeFilter: "ALL" | Trade["marketRegime"];
  dateFrom: string;
  dateTo: string;
  tradesTab: TradesTab;
  equityRange: RangeToggle;
  rewardRiskRange: RangeToggle;
  monthlyMetricView: MonthlyMetricView;
  selectedTradeId: string | null;
  setAccountPill: (value: AccountPill) => void;
  setDataMode: (value: DataMode) => void;
  setSetupFilter: (value: "ALL" | SetupKey) => void;
  setSymbolFilter: (value: "ALL" | string) => void;
  setDirectionFilter: (value: "ALL" | Trade["direction"]) => void;
  setRegimeFilter: (value: "ALL" | Trade["marketRegime"]) => void;
  setDateFrom: (value: string) => void;
  setDateTo: (value: string) => void;
  setTradesTab: (value: TradesTab) => void;
  setEquityRange: (value: RangeToggle) => void;
  setRewardRiskRange: (value: RangeToggle) => void;
  setMonthlyMetricView: (value: MonthlyMetricView) => void;
  setSelectedTradeId: (id: string | null) => void;
  resetFilters: () => void;
}

const initialState = {
  accountPill: "ALL" as AccountPill,
  dataMode: "MOCK" as DataMode,
  setupFilter: "ALL" as "ALL" | SetupKey,
  symbolFilter: "ALL" as "ALL" | string,
  directionFilter: "ALL" as "ALL" | Trade["direction"],
  regimeFilter: "ALL" as "ALL" | Trade["marketRegime"],
  dateFrom: "",
  dateTo: "",
  tradesTab: "CLOSED" as TradesTab,
  equityRange: "D" as RangeToggle,
  rewardRiskRange: "M" as RangeToggle,
  monthlyMetricView: "RR" as MonthlyMetricView,
  selectedTradeId: null as string | null,
};

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set) => ({
      ...initialState,
      setAccountPill: (value) => set({ accountPill: value }),
      setDataMode: (value) =>
        set((state) => ({
          dataMode: value,
          accountPill: value === "LIVE" && state.accountPill === "DEMO" ? "MAIN" : state.accountPill,
        })),
      setSetupFilter: (value) => set({ setupFilter: value }),
      setSymbolFilter: (value) => set({ symbolFilter: value }),
      setDirectionFilter: (value) => set({ directionFilter: value }),
      setRegimeFilter: (value) => set({ regimeFilter: value }),
      setDateFrom: (value) => set({ dateFrom: value }),
      setDateTo: (value) => set({ dateTo: value }),
      setTradesTab: (value) => set({ tradesTab: value }),
      setEquityRange: (value) => set({ equityRange: value }),
      setRewardRiskRange: (value) => set({ rewardRiskRange: value }),
      setMonthlyMetricView: (value) => set({ monthlyMetricView: value }),
      setSelectedTradeId: (id) => set({ selectedTradeId: id }),
      resetFilters: () =>
        set({
          accountPill: initialState.accountPill,
          setupFilter: initialState.setupFilter,
          symbolFilter: initialState.symbolFilter,
          directionFilter: initialState.directionFilter,
          regimeFilter: initialState.regimeFilter,
          dateFrom: initialState.dateFrom,
          dateTo: initialState.dateTo,
        }),
    }),
    {
      name: "trading-dashboard-state",
      partialize: (state) => ({
        accountPill: state.accountPill,
        dataMode: state.dataMode,
        setupFilter: state.setupFilter,
        symbolFilter: state.symbolFilter,
        directionFilter: state.directionFilter,
        regimeFilter: state.regimeFilter,
        dateFrom: state.dateFrom,
        dateTo: state.dateTo,
        tradesTab: state.tradesTab,
        equityRange: state.equityRange,
        rewardRiskRange: state.rewardRiskRange,
        monthlyMetricView: state.monthlyMetricView,
      }),
    },
  ),
);
