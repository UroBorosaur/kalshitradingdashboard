import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function DisciplineScoreCard({ score }: { score: number }) {
  const tone = score >= 75 ? "text-emerald-300" : score >= 55 ? "text-amber-300" : "text-red-300";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Repeated Game Discipline Score</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-2 flex items-end justify-between">
          <p className={`text-3xl font-semibold ${tone}`}>{score.toFixed(1)}</p>
          <p className="text-xs text-slate-500">/ 100</p>
        </div>
        <div className="h-2 rounded-full bg-slate-800">
          <div
            className={score >= 75 ? "h-2 rounded-full bg-emerald-400" : score >= 55 ? "h-2 rounded-full bg-amber-400" : "h-2 rounded-full bg-red-400"}
            style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Combines patience, sizing discipline, revenge-trade leakage, overtrading, and stop-rule adherence.
        </p>
      </CardContent>
    </Card>
  );
}
