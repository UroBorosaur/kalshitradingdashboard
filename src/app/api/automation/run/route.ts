import { NextResponse } from "next/server";

import { runPredictionAutomation } from "@/lib/prediction/engine";
import type { AutomationControls, AutomationMode, PredictionCategory } from "@/lib/prediction/types";

interface RunBody {
  mode?: AutomationMode;
  execute?: boolean;
  categories?: PredictionCategory[];
  controls?: Partial<AutomationControls>;
}

const validModes: AutomationMode[] = ["CONSERVATIVE", "MIXED", "AGGRESSIVE", "AI"];
const validCategories: PredictionCategory[] = [
  "BITCOIN",
  "SPORTS",
  "POLITICS",
  "ESPORTS",
  "WEATHER",
  "STOCKS",
  "MACRO",
  "OTHER",
];

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RunBody;

    const mode = validModes.includes(body.mode ?? "MIXED") ? (body.mode ?? "MIXED") : "MIXED";
    const execute = Boolean(body.execute);

    const requestedCategories = Array.isArray(body.categories)
      ? body.categories.filter((category): category is PredictionCategory =>
          validCategories.includes(category as PredictionCategory),
        )
      : [];

    const categories = requestedCategories.length ? requestedCategories : validCategories;

    const summary = await runPredictionAutomation({
      mode,
      execute,
      categories,
      controls: body.controls,
    });

    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
