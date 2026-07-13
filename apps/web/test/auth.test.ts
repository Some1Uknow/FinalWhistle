import assert from "node:assert/strict";
import test from "node:test";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { requestHash, verifySignedRequest } from "../src/server/auth";
import { config } from "../src/server/config";

test("requestHash is canonical and excludes caller-supplied auth when caller strips it", () => {
  const one = requestHash({ params: { marketId: "m1" }, body: { b: 2, a: 1 } });
  const two = requestHash({ body: { a: 1, b: 2 }, params: { marketId: "m1" } });
  assert.equal(one, two);
});

test("verifySignedRequest binds wallet signature to route, idempotency key, and request hash", () => {
  const keypair = nacl.sign.keyPair();
  const wallet = bs58.encode(keypair.publicKey);
  const body = { fixtureId: "123", creator: wallet };
  const signedMessage = JSON.stringify({
    domain: "finalwhistle",
    version: 2,
    cluster: "devnet",
    programId: config.programId,
    route: "/api/markets",
    method: "POST",
    wallet,
    issuedAt: new Date().toISOString(),
    nonce: "nonce-123456",
    idempotencyKey: "idem-123456",
    termsVersion: "2026-07-13",
    termsAcceptedAt: new Date(Date.now() - 1_000).toISOString(),
    requestHash: requestHash({ params: {}, body })
  });
  const walletSignature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(signedMessage), keypair.secretKey));

  const parsed = verifySignedRequest({
    wallet,
    route: "/api/markets",
    method: "POST",
    params: {},
    body,
    idempotencyKey: "idem-123456",
    signedMessage,
    walletSignature
  });
  assert.equal(parsed.wallet, wallet);

  assert.throws(
    () =>
      verifySignedRequest({
        wallet,
        route: "/api/markets/[marketId]/join",
        method: "POST",
        params: {},
        body,
        idempotencyKey: "idem-123456",
        signedMessage,
        walletSignature
      }),
    /route/
  );
});
