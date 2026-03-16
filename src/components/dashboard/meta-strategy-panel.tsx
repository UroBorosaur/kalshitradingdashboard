import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type GameTheoryState } from "@/lib/types";

function listText(items: string[]): string {
  return items.length ? items.map((x) => x.replaceAll("_", " ")).join(", ") : "-";
}

export function MetaStrategyPanel({ state }: { state: GameTheoryState }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Meta-Strategy Analytics</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-xs text-slate-300 md:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-900/45 p-2.5">
          <p className="text-slate-500">Best setups after losses</p>
          <p>{listText(state.metaAnalytics.bestAfterLosses)}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/45 p-2.5">
          <p className="text-slate-500">Fail when overused</p>
          <p>{listText(state.metaAnalytics.failsWhenOverused)}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/45 p-2.5">
          <p className="text-slate-500">Too predictable setups</p>
          <p>{listText(state.metaAnalytics.tooPredictable)}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/45 p-2.5">
          <p className="text-slate-500">Regime transitions causing damage</p>
          <p>{listText(state.metaAnalytics.damagingTransitions)}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/45 p-2.5 md:col-span-2">
          <p className="text-slate-500">Months with strategic drift</p>
          <p>{listText(state.metaAnalytics.strategicDriftMonths)}</p>
        </div>
      </CardContent>
    </Card>
  );
}
