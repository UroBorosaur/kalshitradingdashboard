"use client";

import { BayesianBeliefCard } from "@/components/dashboard/bayesian-belief-card";
import { DisciplineScoreCard } from "@/components/dashboard/discipline-score-card";
import { ExploitabilityMatrix } from "@/components/dashboard/exploitability-matrix";
import { InformationRiskCard } from "@/components/dashboard/information-risk-card";
import { MetaStrategyPanel } from "@/components/dashboard/meta-strategy-panel";
import { OptionalityCard } from "@/components/dashboard/optionality-card";
import { PredictionAutomationPanel } from "@/components/dashboard/prediction-automation-panel";
import { RegimeDetectionCard } from "@/components/dashboard/regime-detection-card";
import { RobustRiskCard } from "@/components/dashboard/robust-risk-card";
import { StrategyMixCard } from "@/components/dashboard/strategy-mix-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDashboardData } from "@/hooks/use-dashboard-data";

export function GameTheoryEnginePage() {
  const { gameTheory } = useDashboardData();

  const suggestedAction = gameTheory.noTradeRecommended
    ? "Stand aside or trade at minimal clip until information risk normalizes."
    : gameTheory.robustRiskPosture === "DEFENSIVE"
      ? "Trade selectively and reduce size; avoid low-liquidity and high-slippage setups."
      : gameTheory.robustRiskPosture === "BALANCED"
        ? "Deploy mixed strategy with moderate sizing and exploit strongest posterior edges."
        : "Exploit trend-compatible setups while respecting hard risk caps.";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 xl:grid-cols-4">
        <RegimeDetectionCard state={gameTheory} />
        <RobustRiskCard state={gameTheory} />
        <DisciplineScoreCard score={gameTheory.repeatedGameDisciplineScore} />
        <InformationRiskCard state={gameTheory} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <StrategyMixCard mix={gameTheory.strategyMix} />
        <OptionalityCard noTradeRecommended={gameTheory.noTradeRecommended} reason={gameTheory.noTradeReason} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <BayesianBeliefCard beliefs={gameTheory.beliefs} />
        <ExploitabilityMatrix recommendations={gameTheory.setupRecommendations} />
      </div>

      <MetaStrategyPanel state={gameTheory} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Suggested Action Today</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-300">
          <p>{suggestedAction}</p>
          <ul className="space-y-1 text-xs text-slate-400">
            <li>- Trade selectively when posterior edge and regime fit align.</li>
            <li>- Reduce size when uncertainty score rises or info disadvantage is medium/high.</li>
            <li>- Exploit breakout only when trend-follower regime confidence is high.</li>
            <li>- Avoid mean reversion during adversarial/high-volatility states.</li>
            <li>- Preserve optionality: no-trade is valid and often optimal in poor states.</li>
          </ul>
        </CardContent>
      </Card>

      <PredictionAutomationPanel />
    </div>
  );
}
