"use client";

import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SetupKey, Trade } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useDashboardStore, type AccountPill } from "@/store/dashboard-store";

const defaultPillOptions: { value: AccountPill; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "DEMO", label: "Demo Account" },
  { value: "MAIN", label: "Main" },
  { value: "MISSED", label: "Missed Trades" },
];

interface FilterBarProps {
  symbols: string[];
  setups: ("ALL" | SetupKey)[];
  regimes: ("ALL" | Trade["marketRegime"])[];
}

export function FilterBar({ symbols, setups, regimes }: FilterBarProps) {
  const {
    accountPill,
    setAccountPill,
    dataMode,
    setDataMode,
    setupFilter,
    setSetupFilter,
    symbolFilter,
    setSymbolFilter,
    directionFilter,
    setDirectionFilter,
    regimeFilter,
    setRegimeFilter,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    resetFilters,
  } = useDashboardStore();

  const pillOptions =
    dataMode === "LIVE"
      ? [
          { value: "ALL" as AccountPill, label: "All" },
          { value: "MAIN" as AccountPill, label: "Paper Account" },
          { value: "MISSED" as AccountPill, label: "Missed Trades" },
        ]
      : defaultPillOptions;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {pillOptions.map((pill) => {
            const active = accountPill === pill.value;
            return (
              <button
                key={pill.value}
                onClick={() => setAccountPill(pill.value)}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all",
                  active
                    ? "border-sky-500/60 bg-sky-500/15 text-sky-200 shadow-[0_0_0_1px_rgba(56,189,248,0.12)]"
                    : "border-slate-800 bg-slate-950/70 text-slate-400 hover:border-slate-700 hover:text-slate-200",
                )}
              >
                {pill.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 rounded-full border border-slate-800 bg-slate-950/80 p-1">
          <button
            onClick={() => setDataMode("MOCK")}
            className={cn(
              "rounded-full px-3 py-1 text-[11px] font-medium transition-all",
              dataMode === "MOCK" ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:text-slate-200",
            )}
          >
            Mock
          </button>
          <button
            onClick={() => setDataMode("LIVE")}
            className={cn(
              "rounded-full px-3 py-1 text-[11px] font-medium transition-all",
              dataMode === "LIVE" ? "bg-emerald-500/20 text-emerald-300" : "text-slate-400 hover:text-slate-200",
            )}
          >
            Live (Alpaca + Kalshi)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8">
        <Select value={setupFilter} onValueChange={(value) => setSetupFilter(value as "ALL" | SetupKey)}>
          <SelectTrigger>
            <SelectValue placeholder="Setup" />
          </SelectTrigger>
          <SelectContent>
            {setups.map((setup) => (
              <SelectItem key={setup} value={setup}>
                {setup === "ALL" ? "All Setups" : setup.replaceAll("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={symbolFilter} onValueChange={(value) => setSymbolFilter(value)}>
          <SelectTrigger>
            <SelectValue placeholder="Symbol" />
          </SelectTrigger>
          <SelectContent>
            {symbols.map((symbol) => (
              <SelectItem key={symbol} value={symbol}>
                {symbol === "ALL" ? "All Symbols" : symbol}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={directionFilter} onValueChange={(value) => setDirectionFilter(value as "ALL" | Trade["direction"])}>
          <SelectTrigger>
            <SelectValue placeholder="Direction" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Directions</SelectItem>
            <SelectItem value="LONG">Long</SelectItem>
            <SelectItem value="SHORT">Short</SelectItem>
          </SelectContent>
        </Select>

        <Select value={regimeFilter} onValueChange={(value) => setRegimeFilter(value as "ALL" | Trade["marketRegime"])}>
          <SelectTrigger>
            <SelectValue placeholder="Regime" />
          </SelectTrigger>
          <SelectContent>
            {regimes.map((regime) => (
              <SelectItem key={regime} value={regime}>
                {regime === "ALL" ? "All Regimes" : regime.replaceAll("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="text-xs" />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="text-xs" />

        <Button variant="secondary" onClick={resetFilters} className="col-span-2 md:col-span-2 lg:col-span-1">
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          Reset Filters
        </Button>
      </div>
    </div>
  );
}
