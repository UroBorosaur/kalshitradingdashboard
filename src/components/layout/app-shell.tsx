"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BriefcaseBusiness, BrainCircuit, CandlestickChart, GitBranch, House, ListChecks } from "lucide-react";

import { TechOrb } from "@/components/layout/tech-orb";
import { useLiveBrokerData } from "@/hooks/use-live-broker-data";
import { cn, formatCurrency } from "@/lib/utils";
import { useDashboardStore } from "@/store/dashboard-store";

const nav = [
  { href: "/", label: "Home", icon: House },
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/positions", label: "Position Summary", icon: BriefcaseBusiness },
  { href: "/trades", label: "Trades", icon: ListChecks },
  { href: "/setups", label: "Setups", icon: CandlestickChart },
  { href: "/regime-analysis", label: "Regime Analysis", icon: GitBranch },
  { href: "/game-theory-engine", label: "Game Theory Engine", icon: BrainCircuit },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const dataMode = useDashboardStore((s) => s.dataMode);
  const live = useLiveBrokerData(dataMode === "LIVE");

  const kalshiBalance = live.snapshot.kalshi.balanceUsd;
  const kalshiPortfolio = live.snapshot.kalshi.portfolioUsd;

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[radial-gradient(circle_at_18%_0%,rgba(30,200,255,0.10),transparent_36%),radial-gradient(circle_at_80%_10%,rgba(16,185,129,0.08),transparent_42%),#030711] text-slate-100">
      <TechOrb />
      <header className="sticky top-0 z-30 border-b border-slate-800/70 bg-slate-950/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1680px] items-center justify-between px-4 py-3 lg:px-6">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-sky-300/80">Institutional Analytics</p>
            <h1 className="text-sm font-semibold text-slate-100 md:text-base">Apex Trader Performance Hub</h1>
          </div>
          <nav className="hidden items-center gap-2 xl:flex">
            {nav.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                    active
                      ? "border-sky-500/50 bg-sky-500/15 text-sky-200"
                      : "border-slate-800 bg-slate-950/70 text-slate-400 hover:border-slate-700 hover:text-slate-100",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="hidden items-center gap-2 lg:flex">
            <div className="rounded-lg border border-slate-800 bg-slate-950/80 px-2.5 py-1.5 text-right">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Balance</p>
              <p className="text-xs font-semibold text-slate-100">
                {dataMode === "LIVE" && typeof kalshiBalance === "number" ? formatCurrency(kalshiBalance) : "n/a"}
              </p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/80 px-2.5 py-1.5 text-right">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Portfolio</p>
              <p className="text-xs font-semibold text-slate-100">
                {dataMode === "LIVE" && typeof kalshiPortfolio === "number" ? formatCurrency(kalshiPortfolio) : "n/a"}
              </p>
            </div>
          </div>
        </div>
      </header>
      <main className="relative z-10 mx-auto max-w-[1680px] px-4 py-4 lg:px-6 lg:py-5">{children}</main>
    </div>
  );
}
