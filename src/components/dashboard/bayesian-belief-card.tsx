import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type BayesianBelief } from "@/lib/types";
import { formatPct } from "@/lib/utils";

export function BayesianBeliefCard({ beliefs }: { beliefs: BayesianBelief[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Belief Update (Bayesian)</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 text-left">Setup</th>
              <th className="py-1 text-right">Prior</th>
              <th className="py-1 text-right">Posterior</th>
              <th className="py-1 text-right">N</th>
              <th className="py-1 text-right">95% CI</th>
            </tr>
          </thead>
          <tbody>
            {beliefs.map((belief) => (
              <tr key={belief.setup} className="border-t border-slate-800">
                <td className="py-2 text-slate-300">{belief.setup.replaceAll("_", " ")}</td>
                <td className="py-2 text-right text-slate-400">{formatPct(belief.priorEdge)}</td>
                <td className="py-2 text-right text-slate-100">{formatPct(belief.posteriorEdge)}</td>
                <td className="py-2 text-right text-slate-400">{belief.sampleSize}</td>
                <td className="py-2 text-right text-slate-400">
                  {formatPct(belief.confidenceLow)} / {formatPct(belief.confidenceHigh)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
