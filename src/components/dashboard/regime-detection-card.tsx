import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type GameTheoryState } from "@/lib/types";
import { formatPct } from "@/lib/utils";

export function RegimeDetectionCard({ state }: { state: GameTheoryState }) {
  const regime = state.regimeDetection;

  const variant =
    regime.regime === "TREND_FOLLOWER"
      ? "positive"
      : regime.regime === "HIGH_VOL_ADVERSARIAL" || regime.regime === "LOW_LIQUIDITY_TRAP"
        ? "negative"
        : "info";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Regime Detection (Opponent Model)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <Badge variant={variant}>{regime.regime.replaceAll("_", " ")}</Badge>
          <span className="text-slate-300">Confidence: {formatPct(regime.confidence)}</span>
        </div>
        <p className="text-xs text-slate-400">{regime.rationale}</p>
      </CardContent>
    </Card>
  );
}
