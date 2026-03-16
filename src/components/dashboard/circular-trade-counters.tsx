import { cn } from "@/lib/utils";

interface CounterProps {
  wins: number;
  breakeven: number;
  losses: number;
}

function Counter({ value, tone }: { value: number; tone: "win" | "flat" | "loss" }) {
  return (
    <div
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold",
        tone === "win" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
        tone === "flat" && "border-amber-500/40 bg-amber-500/10 text-amber-300",
        tone === "loss" && "border-red-500/40 bg-red-500/10 text-red-300",
      )}
    >
      {value}
    </div>
  );
}

export function CircularTradeCounters({ wins, breakeven, losses }: CounterProps) {
  return (
    <div className="flex items-center gap-2">
      <Counter value={wins} tone="win" />
      <Counter value={breakeven} tone="flat" />
      <Counter value={losses} tone="loss" />
    </div>
  );
}
