import assert from "node:assert/strict";
import test from "node:test";

process.env.FINAL_WHISTLE_DATABASE_MODE = "memory";
process.env.BETA_REPLAY_FIXTURE_IDS = "9001,9002";
process.env.DEVNET_TOKEN_FAUCET_URL = "";

test("publicConfig exposes only safe beta launch configuration", async () => {
  const { publicConfig } = await import("../src/server/api");
  const response = await publicConfig();
  const payload = await response.json() as Record<string, unknown>;

  assert.equal(payload.cluster, "devnet");
  assert.equal(payload.programId, "DaW6BCZ4AKUNwyEaoqik6xbrx9JcuqRbfhwzDstDEJWF");
  assert.equal(payload.replayEnabled, true);
  assert.ok(Array.isArray(payload.allowedStakeMints));
  assert.equal("txlineApiToken" in payload, false);
});

test("fixtures replay mode returns configured beta fixtures", async () => {
  const { fixtures } = await import("../src/server/api");
  const { getFixtureView } = await import("../src/server/db");
  const response = await fixtures(new Request("http://localhost/api/fixtures?mode=replay"));
  const payload = await response.json() as { source: string; stale: boolean; fixtures: Array<{ id: string; source: string }> };

  assert.equal(payload.source, "replay");
  assert.equal(payload.stale, true);
  assert.deepEqual(payload.fixtures.map((fixture) => fixture.id), ["9001", "9002"]);
  assert.ok(payload.fixtures.every((fixture) => fixture.source === "replay"));
  assert.equal(await getFixtureView("9001"), undefined, "replay fixtures must not become fresh live-cache entries");
});

test("portfolio requires a wallet query parameter", async () => {
  const { portfolio } = await import("../src/server/api");
  await assert.rejects(
    () => portfolio(new Request("http://localhost/api/portfolio")),
    /wallet query parameter/
  );
});
