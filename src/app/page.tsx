import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  BriefcaseBusiness,
  CandlestickChart,
  GitBranch,
  Radar,
  ShieldCheck,
  Waves,
} from "lucide-react";

const featureCards = [
  {
    title: "Execution Engine",
    description: "Queue-reactive Kalshi execution with hard brakes, toxicity controls, uncertainty widening, and maker-vs-taker routing.",
    href: "/dashboard",
    icon: Waves,
  },
  {
    title: "Position Summary",
    description: "Live and simulated positions with mapped Kalshi contract names, balance context, and open-exposure visibility.",
    href: "/positions",
    icon: BriefcaseBusiness,
  },
  {
    title: "Trades",
    description: "Trade history, execution outcomes, and fill-aware monitoring across Alpaca and Kalshi surfaces.",
    href: "/trades",
    icon: BarChart3,
  },
  {
    title: "Regime Analysis",
    description: "Cross-market regime diagnostics to understand when the engine should tighten, widen, or shut off.",
    href: "/regime-analysis",
    icon: GitBranch,
  },
  {
    title: "Setups",
    description: "Ranked opportunity views for monitoring what the selector likes before it becomes live exposure.",
    href: "/setups",
    icon: CandlestickChart,
  },
  {
    title: "Game Theory Engine",
    description: "Strategic overlays, ranked theses, and execution planning for prediction markets and correlated event clusters.",
    href: "/game-theory-engine",
    icon: BrainCircuit,
  },
];

const architecturePillars = [
  "WebSocket-first Kalshi market state with sequence-gap recovery",
  "Append-only data plane for quotes, fills, orders, decisions, resolutions, and markouts",
  "Rulebook-robust probability engine with structural coherence overlays",
  "Execution attribution with near misses, gate waterfalls, and balance-delta reconciliation",
  "Shadow baselines comparing current maker logic against alternative execution profiles",
];

export default function HomePage() {
  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-slate-800 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.16),transparent_35%),radial-gradient(circle_at_85%_20%,rgba(16,185,129,0.14),transparent_30%),rgba(2,6,23,0.88)] p-6 shadow-[0_0_0_1px_rgba(15,23,42,0.2)] lg:p-8">
        <div className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.24em] text-sky-200">
              <Radar className="h-3.5 w-3.5" />
              Prediction Market Execution Stack
            </div>
            <div className="space-y-3">
              <h2 className="max-w-3xl text-3xl font-semibold tracking-tight text-slate-50 lg:text-4xl">
                Kalshi-oriented execution, attribution, and risk control in one operational surface.
              </h2>
              <p className="max-w-3xl text-sm leading-6 text-slate-300 lg:text-base">
                This project is not a toy dashboard. It combines market-state ingestion, rulebook-aware pricing, execution controls,
                attribution, and portfolio sizing for binary and binned prediction markets.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/15 px-4 py-2 text-sm font-medium text-sky-100 transition hover:border-sky-400/60 hover:bg-sky-500/20"
              >
                Open Dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/game-theory-engine"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Review Strategy Surface
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-slate-400">What Is Built</p>
            <div className="mt-4 space-y-3">
              {architecturePillars.map((pillar) => (
                <div key={pillar} className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-emerald-300" />
                  <p className="text-sm text-slate-200">{pillar}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {featureCards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.title}
              href={card.href}
              className="group rounded-2xl border border-slate-800 bg-slate-950/70 p-5 transition hover:border-sky-500/40 hover:bg-slate-900/80"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-semibold text-slate-100">{card.title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{card.description}</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2 text-sky-200 transition group-hover:border-sky-500/40 group-hover:text-sky-100">
                  <Icon className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-sky-200">
                Open
                <ArrowRight className="h-4 w-4" />
              </div>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
