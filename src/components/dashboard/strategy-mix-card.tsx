import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type StrategyMixWeight } from "@/lib/types";
import { formatPct } from "@/lib/utils";

export function StrategyMixCard({ mix }: { mix: StrategyMixWeight[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Strategy Mix</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {mix.map((item) => (
          <div key={item.setup}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-slate-400">{item.setup.replaceAll("_", " ")}</span>
              <span className="text-slate-200">{formatPct(item.weight, 1)}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-800">
              <div
                className={item.setup === "NO_TRADE" ? "h-2 rounded-full bg-amber-400/70" : "h-2 rounded-full bg-sky-400/80"}
                style={{ width: `${Math.round(item.weight * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
