import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  buildCreateMarketIx,
  buildJoinMarketIx,
  buildProofIx,
  deriveProgramConfigPda
} from "../src/client/finalwhistle";

const programId = new PublicKey("Hf4KSaGy7EHEaT9jMCo9nKx2uQRz6BEsYS3DrprkDaPw");
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

test("proof instructions preserve large canonical fixture IDs exactly", () => {
  const fixtureId = "9007199254740993";
  const proof = {
    ts: "0",
    fixtureSummary: {
      fixtureId,
      updateStats: { updateCount: 1, minTimestamp: "0", maxTimestamp: "0" },
      eventsSubTreeRoot: Array(32).fill(0)
    },
    fixtureProof: [],
    mainTreeProof: [],
    predicate: { threshold: -2_147_483_648, comparison: { greaterThan: {} } },
    statA: {
      statToProve: { key: 1, value: 14, period: 0 },
      eventStatRoot: Array(32).fill(0),
      statProof: []
    },
    statB: null,
    op: null
  };
  const instruction = buildProofIx({
    market: { marketPda: creator.toBase58() },
    payload: {
      mode: "VALIDATED_ON_CHAIN_BY_TXLINE",
      txlineProgramId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
      dailyScoresMerkleRoots: mint.toBase58(),
      instruction: "cancel_market",
      args: {
        fixtureId,
        seq: "1",
        cancellationProof: proof,
        cancellationStatKey: 1,
        cancellationPhaseId: 14
      }
    },
    programId
  });

  assert.equal(instruction.data.subarray(8, 16).readBigInt64LE(), BigInt(fixtureId));
});
