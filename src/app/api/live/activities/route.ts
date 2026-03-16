import { NextRequest, NextResponse } from "next/server";

import { getAlpacaActivities } from "@/lib/live/alpaca";

export async function GET(request: NextRequest) {
  const requestedPageSize = Number(request.nextUrl.searchParams.get("pageSize") ?? "100");
  const pageSize = Number.isFinite(requestedPageSize) ? Math.min(100, Math.max(1, Math.floor(requestedPageSize))) : 100;
  try {
    const activities = await getAlpacaActivities(pageSize);
    return NextResponse.json({ ok: true, activities });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
