import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "../src/middleware";

test("CSP permits the configured devnet RPC and Solflare's hosted wallet frame", () => {
  const previous = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL = "https://rpc.example.test/devnet";
  try {
    const response = middleware(new NextRequest("https://beta.example.test/"));
    const csp = response.headers.get("content-security-policy") ?? "";

    assert.match(csp, /frame-src 'self' https:\/\/connect\.solflare\.com/);
    assert.match(csp, /https:\/\/rpc\.example\.test/);
    assert.match(csp, /wss:\/\/rpc\.example\.test/);
    assert.match(csp, /frame-ancestors 'none'/);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    else process.env.NEXT_PUBLIC_SOLANA_RPC_URL = previous;
  }
});
