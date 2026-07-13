import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  buildCreateMarketIx,
  buildJoinMarketIx,
  deriveProgramConfigPda
} from "../src/client/finalwhistle";

const programId = new PublicKey("DaW6BCZ4AKUNwyEaoqik6xbrx9JcuqRbfhwzDstDEJWF");
const creator = new PublicKey("11111111111111111111111111111111");
const mint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

const discriminator = (name: string) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

test("client uses the Anchor discriminators and includes immutable program configuration", () => {
  const created = buildCreateMarketIx({
    creator,
    fixtureId: "12345",
    marketNonce: 7n,
    template: "TOTAL_GOALS_OVER_UNDER",
    predicate: {
      statKey1: 1,
      statKey2: 2,
      operator: "ADD",
      thresholdMilli: 2500,
      comparison: "GREATER_THAN"
    },
    lockTs: 1_800_000_000n,
    tokenMint: mint,
    programId
  });

  assert.deepEqual(created.instruction.data.subarray(0, 8), discriminator("create_market"));
  assert.equal(created.instruction.keys[1]?.pubkey.toBase58(), deriveProgramConfigPda(programId).toBase58());

  const joined = buildJoinMarketIx({
    user: creator,
    market: created.market,
    side: "YES",
    amount: 1_000_000n,
    tokenMint: mint,
    escrowTokenAccount: created.escrowTokenAccount,
    programId
  });
  assert.deepEqual(joined.instruction.data.subarray(0, 8), discriminator("join_market"));
});
