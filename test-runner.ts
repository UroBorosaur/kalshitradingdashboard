import { runPredictionAutomation } from "./src/lib/prediction/engine";

async function main() {
  console.log("Starting Prediction Automation Simulation...");
  try {
    const summary = await runPredictionAutomation({
      mode: "AI",
      execute: false,
      categories: ["BITCOIN", "POLITICS", "WEATHER"]
    });
    
    console.log(`\nSimulation Complete. Mode: ${summary.mode}\n`);
    console.log(`Max Daily Risk: $${summary.maxDailyRiskUsd}`);
    console.log(`Planned Stake: $${summary.totalStakePlannedUsd}`);
    console.log(`Actionable Candidates: ${summary.candidates.filter(c => c.executionStatus !== "SKIPPED" || c.executionMessage?.includes("Simulation")).length}`);
    
    for (const c of summary.candidates) {
       console.log(`\n--- ${c.ticker} (${c.side}) ---`);
       console.log(`Model: ${(c.modelProb * 100).toFixed(1)}% | Market: ${(c.marketProb * 100).toFixed(1)}% | Edge: ${(c.edge * 100).toFixed(2)}%`);
       console.log(`Capital: $${c.recommendedStakeUsd.toFixed(2)} | Alloc: ${(c.portfolioWeight ?? 0 * 100).toFixed(2)}%`);
       console.log(`Score: ${(c.compositeScore || 0).toFixed(2)}`);
       console.log(`Rationale: ${c.rationale[0]}`);
    }

  } catch (error) {
    console.error("Simulation failed:", error);
  }
}

main();
