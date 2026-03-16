import { PauseCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface OptionalityCardProps {
  noTradeRecommended: boolean;
  reason: string;
}

export function OptionalityCard({ noTradeRecommended, reason }: OptionalityCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Best Move May Be No Move</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-300">
            <PauseCircle className="h-4 w-4" />
            <span>Suggested Action</span>
          </div>
          <Badge variant={noTradeRecommended ? "warning" : "positive"}>{noTradeRecommended ? "Stand Aside" : "Trade Selectively"}</Badge>
        </div>
        <p className="text-slate-400">{reason}</p>
      </CardContent>
    </Card>
  );
}
