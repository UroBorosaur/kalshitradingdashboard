import { NextResponse } from "next/server";

import { loadExecutionAttributionSummary } from "@/lib/prediction/execution-attribution";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const hours = Number(url.searchParams.get("hours") ?? 72);
    const recentTradeLimit = Number(url.searchParams.get("recentTradeLimit") ?? 12);
    const bucketLimit = Number(url.searchParams.get("bucketLimit") ?? 6);

    const attribution = await loadExecutionAttributionSummary({
      lookbackHours: Number.isFinite(hours) ? hours : 72,
      recentTradeLimit: Number.isFinite(recentTradeLimit) ? recentTradeLimit : 12,
      bucketLimit: Number.isFinite(bucketLimit) ? bucketLimit : 6,
    });

    return NextResponse.json({ ok: true, attribution });
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
