import "@/lib/server-only";

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type { PredictionCategory, PredictionMarketQuote, PredictionSide } from "@/lib/prediction/types";
import type { StoredKalshiStreamEvent } from "@/lib/storage/types";

function parseEnvLine(line: string) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!match) return null;
  const [, key, rawValue] = match;
  const value = rawValue.replace(/^['"]|['"]$/g, "");
  return { key, value };
}

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (!(parsed.key in process.env)) {
      process.env[parsed.key] = parsed.value;
    }
  }
}

function loadLocalEnv() {
  const root = process.cwd();
  loadEnvFile(path.join(root, ".env"));
  loadEnvFile(path.join(root, ".env.local"));
}

function pickOrderCandidate(markets: PredictionMarketQuote[]) {
  const ranked = markets
    .filter((market) => (market.yesAsk ?? 1) > 0.02 || (market.noAsk ?? 1) > 0.02)
    .map((market) => {
      const options: Array<{ side: PredictionSide; price: number }> = [];
      if (typeof market.yesAsk === "number" && market.yesAsk > 0.02 && market.yesAsk < 0.98) {
        options.push({ side: "YES", price: market.yesAsk });
      }
      if (typeof market.noAsk === "number" && market.noAsk > 0.02 && market.noAsk < 0.98) {
        options.push({ side: "NO", price: market.noAsk });
      }
      if (!options.length) return null;
      const preferred = [...options].sort((a, b) => a.price - b.price)[0];
      return {
        market,
        preferred,
      };
    })
    .filter(
      (
        row,
      ): row is {
        market: PredictionMarketQuote;
        preferred: { side: PredictionSide; price: number };
      } => row !== null,
    )
    .sort((a, b) => {
      if (a.market.fractionalTradingEnabled !== b.market.fractionalTradingEnabled) {
        return a.market.fractionalTradingEnabled ? -1 : 1;
      }
      return a.preferred.price - b.preferred.price;
    });

  return ranked[0] ?? null;
}

async function waitForGroupLimit(
  getKalshiOrderGroups: (limit?: number) => Promise<Array<{ order_group_id: string; contracts_limit: number }>>,
  orderGroupId: string,
  expectedLimit: number,
) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const groups = await getKalshiOrderGroups(100);
    const matched = groups.find((group) => group.order_group_id === orderGroupId);
    if (matched?.contracts_limit === expectedLimit) {
      return matched;
    }
    await sleep(750);
  }
  return null;
}

async function main() {
  loadLocalEnv();

  const [
    { getKalshiStreamStatus, getKalshiPrivateStateStream },
    {
      createKalshiOrderGroup,
      getKalshiDemoBalancesUsd,
      getKalshiDemoOrders,
      getKalshiOpenMarkets,
      getKalshiOrderGroups,
      kalshiConnectionStatus,
      placeKalshiDemoOrder,
      resetKalshiOrderGroup,
      triggerKalshiOrderGroup,
      updateKalshiOrderGroupLimit,
    },
    { marketContractStep, probabilityToCents, snapProbabilityToMarket },
    { readPredictionEventsSince },
  ] = await Promise.all([
    import("@/lib/prediction/kalshi-stream"),
    import("@/lib/prediction/kalshi"),
    import("@/lib/prediction/fixed-point"),
    import("@/lib/storage/jsonl"),
  ]);

  const startedAtMs = Date.now();
  const status = kalshiConnectionStatus();
  if (!status.connected) {
    throw new Error(`Kalshi not connected: ${status.reason ?? "unknown"}`);
  }

  console.log("Status:", status);
  console.log("Balances:", await getKalshiDemoBalancesUsd());

  let streamBootstrapError: string | null = null;
  try {
    console.log("Bootstrapping private stream...");
    await Promise.race([
      getKalshiPrivateStateStream([]),
      sleep(15_000).then(() => {
        throw new Error("Timed out waiting for private stream bootstrap.");
      }),
    ]);
    console.log("Initial stream status:", getKalshiStreamStatus());
  } catch (error) {
    streamBootstrapError = (error as Error).message;
    console.log("Private stream bootstrap failed:", streamBootstrapError);
  }

  const created = await createKalshiOrderGroup(2);
  assert.ok(created.order_group_id, "Expected createKalshiOrderGroup to return order_group_id");
  console.log("Created order group:", created);

  const updated = await updateKalshiOrderGroupLimit(created.order_group_id, 3);
  assert.equal(updated.order_group_id, created.order_group_id, "Updated group id did not match created group id");
  assert.equal(updated.contracts_limit, 3, "Updated group limit did not round-trip to 3");
  console.log("Updated order group:", updated);

  const hydratedGroup = await waitForGroupLimit(getKalshiOrderGroups, created.order_group_id, 3);
  assert.ok(hydratedGroup, "Updated order group was not returned by getKalshiOrderGroups");
  assert.equal(hydratedGroup?.contracts_limit, 3, "Fetched order group did not reflect updated limit");
  console.log("Fetched order group after update:", hydratedGroup);

  const categories: PredictionCategory[] = ["SPORTS", "BITCOIN", "WEATHER", "POLITICS", "ESPORTS", "MACRO", "OTHER"];
  const markets = await getKalshiOpenMarkets(categories, 200);
  const picked = pickOrderCandidate(markets);
  if (!picked) {
    throw new Error("No tradable market found for live verification.");
  }

  const contractStep = marketContractStep(picked.market);
  const limitProb = snapProbabilityToMarket(picked.preferred.price, picked.market, "up");
  const limitPriceCents = probabilityToCents(limitProb);
  const orderCount = contractStep;

  console.log("Picked market:", {
    ticker: picked.market.ticker,
    title: picked.market.title,
    side: picked.preferred.side,
    price: picked.preferred.price,
    snappedPrice: limitProb,
    limitPriceCents,
    contractStep,
    fractionalTradingEnabled: picked.market.fractionalTradingEnabled ?? false,
  });

  const firstClientOrderId = `verify-og-${Date.now().toString(36)}-a`;
  const placedOrder = await placeKalshiDemoOrder({
    ticker: picked.market.ticker,
    side: picked.preferred.side,
    count: orderCount,
    contractStep,
    limitPriceCents,
    orderGroupId: created.order_group_id,
    clientOrderId: firstClientOrderId,
  });
  console.log("Placed order response:", placedOrder);

  await sleep(2000);
  const ordersAfterPlace = await getKalshiDemoOrders(50);
  const groupedOrder = ordersAfterPlace.find(
    (order) =>
      order.order_group_id === created.order_group_id &&
      order.ticker === picked.market.ticker &&
      order.client_order_id === firstClientOrderId,
  );
  assert.ok(groupedOrder, "Placed demo order did not come back with the expected order_group_id");
  console.log("Grouped order found:", groupedOrder);

  await triggerKalshiOrderGroup(created.order_group_id);
  console.log("Triggered order group:", created.order_group_id);
  await sleep(1500);

  const groupsAfterTrigger = await getKalshiOrderGroups(100);
  const triggeredGroup = groupsAfterTrigger.find((group) => group.order_group_id === created.order_group_id);
  console.log("Group after trigger:", triggeredGroup);

  let blockedOrderError: string | null = null;
  try {
    const blockedClientOrderId = `verify-og-${Date.now().toString(36)}-b`;
    await placeKalshiDemoOrder({
      ticker: picked.market.ticker,
      side: picked.preferred.side,
      count: orderCount,
      contractStep,
      limitPriceCents,
      orderGroupId: created.order_group_id,
      clientOrderId: blockedClientOrderId,
    });
  } catch (error) {
    blockedOrderError = (error as Error).message;
  }
  assert.ok(blockedOrderError, "Expected triggered order group to block a new order");
  console.log("Post-trigger order attempt error:", blockedOrderError);

  await resetKalshiOrderGroup(created.order_group_id);
  console.log("Reset order group:", created.order_group_id);
  await sleep(1500);

  const groupsAfterReset = await getKalshiOrderGroups(100);
  const resetGroup = groupsAfterReset.find((group) => group.order_group_id === created.order_group_id);
  console.log("Group after reset:", resetGroup);

  let recoveryOrderError: string | null = null;
  let recoveryOrderAccepted = false;
  try {
    const recoveryClientOrderId = `verify-og-${Date.now().toString(36)}-c`;
    const recoveryOrder = await placeKalshiDemoOrder({
      ticker: picked.market.ticker,
      side: picked.preferred.side,
      count: orderCount,
      contractStep,
      limitPriceCents,
      orderGroupId: created.order_group_id,
      clientOrderId: recoveryClientOrderId,
    });
    recoveryOrderAccepted = true;
    console.log("Recovery order response:", recoveryOrder);
  } catch (error) {
    recoveryOrderError = (error as Error).message;
  }
  assert.ok(recoveryOrderAccepted, `Expected reset order group to recover, got error: ${recoveryOrderError ?? "unknown"}`);
  console.log("Recovery order error:", recoveryOrderError);

  await sleep(3000);
  const streamEvents = await readPredictionEventsSince<StoredKalshiStreamEvent>("raw", "stream_events", startedAtMs);
  const groupEvents = streamEvents.filter((event) => {
    const payload = event.payload;
    return (
      payload.eventType.toLowerCase().includes("order_group") ||
      JSON.stringify(payload.raw).includes(created.order_group_id)
    );
  });
  const orderGroupUpdateEvents = groupEvents.filter((event) => event.payload.eventType === "order_group_updates");
  assert.ok(groupEvents.length > 0, "Expected persisted raw stream events referencing the verified order group");
  assert.ok(orderGroupUpdateEvents.length > 0, "Expected persisted order_group_updates events for the verified group");
  console.log("Observed stream events referencing order group:", groupEvents.length);
  console.log(
    "Sample group events:",
    groupEvents.slice(-5).map((event) => ({
      recordedAt: event.recordedAt,
      eventType: event.payload.eventType,
      channel: event.payload.channel,
      sid: event.payload.sid,
      seq: event.payload.seq,
    })),
  );

  console.log("Verification summary:", {
    orderGroupId: created.order_group_id,
    fractionalMarket: picked.market.fractionalTradingEnabled ?? false,
    contractStep,
    streamBootstrapError,
    blockedOrderError,
    recoveryOrderAccepted,
    streamEventCount: groupEvents.length,
    orderGroupUpdateEventCount: orderGroupUpdateEvents.length,
  });
}

main()
  .catch((error) => {
    console.error("Verification failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sleep(100);
    process.exit();
  });
