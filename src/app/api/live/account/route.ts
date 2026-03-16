import { NextResponse } from "next/server";

import { getAlpacaAccount } from "@/lib/live/alpaca";

export async function GET() {
  try {
    const account = await getAlpacaAccount();
    return NextResponse.json({ ok: true, account });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
