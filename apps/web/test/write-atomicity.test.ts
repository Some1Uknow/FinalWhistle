import assert from "node:assert/strict";
import test from "node:test";

process.env.FINAL_WHISTLE_DATABASE_MODE = "memory";

test("a failed indexed write rolls back its consumed nonce and idempotency record", async () => {
  const {
    consumeIdempotencyKey,
    consumeWalletNonce,
    getIdempotencyResponse,
    withTransaction
  } = await import("../src/server/db");

  await assert.rejects(() => withTransaction(async (executor) => {
    await consumeWalletNonce({ wallet: "wallet-a", action: "create", nonce: "nonce-a", issuedAt: new Date().toISOString() }, executor);
    await consumeIdempotencyKey({
      key: "idem-a",
      route: "/api/markets",
      wallet: "wallet-a",
      requestHash: "a".repeat(64),
      response: { ok: true }
    }, executor);
    throw new Error("simulated index failure");
  }));

  await assert.doesNotReject(() => consumeWalletNonce({
    wallet: "wallet-a",
    action: "create",
    nonce: "nonce-a",
    issuedAt: new Date().toISOString()
  }));
  assert.equal((await getIdempotencyResponse({
    key: "idem-a",
    route: "/api/markets",
    wallet: "wallet-a",
    requestHash: "a".repeat(64)
  })).found, false);
});

test("rate limits are enforced in shared database state", async () => {
  const { consumeRateLimitBucket } = await import("../src/server/db");
  const input = { keyHash: "rate-test", max: 1, windowMs: 60_000 };
  await consumeRateLimitBucket(input);
  await assert.rejects(() => consumeRateLimitBucket(input), /Too many requests/);
});
