import assert from "node:assert/strict";
import test from "node:test";

Object.assign(process.env, { NODE_ENV: "production" });
process.env.FINAL_WHISTLE_DATABASE_MODE = "memory";
process.env.PUBLIC_ORIGIN = "https://beta.example.test";
process.env.SOLANA_CLUSTER = "devnet";
process.env.TXLINE_ENV = "devnet";
process.env.SOLANA_RPC_URL = "https://api.devnet.solana.com";
process.env.ALLOWED_STAKE_MINTS = "So11111111111111111111111111111111111111112";
delete process.env.TXLINE_API_TOKEN;

test("incomplete production configuration fails API writes closed instead of crashing module initialization", async () => {
  const { fixtures } = await import("../src/server/api");

  await assert.rejects(
    () => fixtures(new Request("https://beta.example.test/api/fixtures")),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 503
  );
});

test("pooled PostgreSQL URLs use explicit SSL hostname verification", async () => {
  const { normalizePooledDatabaseUrl } = await import("../src/server/db");
  const normalized = new URL(
    normalizePooledDatabaseUrl("postgresql://user:pass@database.example.test/finalwhistle?sslmode=require")
  );

  assert.equal(normalized.searchParams.get("sslmode"), "verify-full");
});

test("the public stake-token allowlist cannot advertise an unsupported mint", async () => {
  const { isSupportedDevnetStakeMint } = await import("../src/server/config");

  assert.equal(isSupportedDevnetStakeMint("So11111111111111111111111111111111111111112"), true);
  assert.equal(isSupportedDevnetStakeMint("11111111111111111111111111111111"), false);
});

test("PUBLIC_ORIGIN is limited to a bare web origin", async () => {
  const { parsePublicOrigin } = await import("../src/lib/public-origin");

  assert.equal(parsePublicOrigin("https://finalwhistle.raghav.codes/").origin, "https://finalwhistle.raghav.codes");
  assert.throws(() => parsePublicOrigin("https://finalwhistle.raghav.codes/app"));
  assert.throws(() => parsePublicOrigin("https://user:pass@finalwhistle.raghav.codes"));
  assert.throws(() => parsePublicOrigin("ftp://finalwhistle.raghav.codes"));
});
