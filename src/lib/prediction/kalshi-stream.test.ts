import assert from "node:assert/strict";
import test from "node:test";

import { extractSubscriptionAck, extractWsCommandResult } from "@/lib/prediction/kalshi-stream";

test("extractSubscriptionAck parses nested subscribed payload shape from live run", () => {
  const message = {
    type: "subscribed",
    id: 6,
    msg: {
      channel: "order_group_updates",
      sid: 6,
    },
  };

  const ack = extractSubscriptionAck(message);
  assert.ok(ack);
  assert.equal(ack?.channel, "order_group_updates");
  assert.equal(ack?.sid, 6);
  assert.equal(ack?.issue, null);
});

test("extractWsCommandResult resolves command metadata from nested subscribed payload", () => {
  const message = {
    type: "subscribed",
    id: 3,
    msg: {
      channel: "user_orders",
      sid: 3,
    },
  };

  const result = extractWsCommandResult(message);
  assert.ok(result);
  assert.equal(result?.id, 3);
  assert.equal(result?.channel, "user_orders");
  assert.equal(result?.sid, 3);
});

test("extractSubscriptionAck reports malformed subscribed payloads", () => {
  const message = {
    type: "subscribed",
    id: 9,
    msg: {
      unexpected: true,
    },
  };

  const ack = extractSubscriptionAck(message);
  assert.ok(ack);
  assert.equal(ack?.channel, null);
  assert.equal(ack?.sid, null);
  assert.equal(ack?.issue, "subscribed ack missing channel");
  assert.match(ack?.raw ?? "", /unexpected/);
});
