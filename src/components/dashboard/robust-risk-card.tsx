import { Shield } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type GameTheoryState } from "@/lib/types";

export function RobustRiskCard({ state }: { state: GameTheoryState }) {
  const posture = state.robustRiskPosture;
  const variant = posture === "AGGRESSIVE" ? "positive" : posture === "BALANCED" ? "info" : posture === "DEFENSIVE" ? "warning" : "negative";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Robust Risk Posture (Minimax)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-slate-400">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-300">
            <Shield className="h-4 w-4" />
            <span>Current posture</span>
          </div>
          <Badge variant={variant}>{posture.replaceAll("_", " ")}</Badge>
        </div>
        <p>
          Position size is automatically reduced when regime confidence drops, uncertainty rises, or slippage indicates adversarial liquidity.
        </p>
        <p>Exposure is capped to prioritize long-game survival under worst-case correlated outcomes.</p>
      </CardContent>
    </Card>
  );
}
