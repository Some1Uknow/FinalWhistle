import assert from "node:assert/strict";
import test from "node:test";

test("TxLINE fixture refresh uses the current snapshot endpoint", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("/auth/guest/start")) {
      return Response.json({ token: "guest-jwt", expiresIn: 900 });
    }
    if (url.endsWith("/api/fixtures/snapshot")) {
      return Response.json([{ FixtureId: 123, Participant1: "Home", Participant2: "Away" }]);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const { TxlineClient } = await import("../src/server/txline");
  const fixtures = await new TxlineClient().listFixtures();

  assert.equal(fixtures.length, 1);
  assert.deepEqual(requests, [
    "https://txline-dev.txodds.com/auth/guest/start",
    "https://txline-dev.txodds.com/api/fixtures/snapshot"
  ]);
});
