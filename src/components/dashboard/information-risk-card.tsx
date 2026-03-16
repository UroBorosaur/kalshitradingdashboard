import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type GameTheoryState } from "@/lib/types";

export function InformationRiskCard({ state }: { state: GameTheoryState }) {
  const risk = state.infoDisadvantageRisk;
  const variant = risk === "LOW" ? "positive" : risk === "MEDIUM" ? "warning" : "negative";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Information Disadvantage Risk</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-slate-400">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-300">
            <AlertTriangle className="h-4 w-4" />
            <span>Current Signal</span>
          </div>
          <Badge variant={variant}>{risk}</Badge>
        </div>
        <p>
          Triggered by macro/event density, volatility shocks, and regime evidence that informed participants may dominate price discovery.
        </p>
      </CardContent>
    </Card>
  );
}
