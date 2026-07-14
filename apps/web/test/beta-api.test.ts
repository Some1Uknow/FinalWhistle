import assert from "node:assert/strict";
import test from "node:test";

process.env.FINAL_WHISTLE_DATABASE_MODE = "memory";
process.env.DEVNET_TOKEN_FAUCET_URL = "";

test("publicConfig exposes only safe beta launch configuration", async () => {
  const { publicConfig } = await import("../src/server/api");
  const response = await publicConfig();
  const payload = await response.json() as Record<string, unknown>;

  assert.equal(payload.cluster, "devnet");
  assert.equal(payload.programId, "Hf4KSaGy7EHEaT9jMCo9nKx2uQRz6BEsYS3DrprkDaPw");
  assert.equal("replayEnabled" in payload, false);
  assert.ok(Array.isArray(payload.allowedStakeMints));
  assert.equal("txlineApiToken" in payload, false);
});

test("portfolio requires a wallet query parameter", async () => {
  const { portfolio } = await import("../src/server/api");
  await assert.rejects(
    () => portfolio(new Request("http://localhost/api/portfolio")),
    /wallet query parameter/
  );
});
