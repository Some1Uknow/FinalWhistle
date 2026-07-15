import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  buildClaimIx,
  buildCreateMarketIx,
  buildEnsureNativeSolAccountIx,
  buildInitializeConfigIx,
  buildJoinMarketIx,
  buildProofIx,
  buildUnwrapNativeSolIx,
  buildWrapNativeSolIxs,
  deriveProgramConfigPda,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID
} from "../src/client/finalwhistle";

const programId = new PublicKey("Hf4KSaGy7EHEaT9jMCo9nKx2uQRz6BEsYS3DrprkDaPw");
const creator = new PublicKey("11111111111111111111111111111111");
const mint = NATIVE_MINT;

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

test("native-SOL actions wrap and unwrap only inside the same wallet transaction", () => {
  const wrapped = buildWrapNativeSolIxs({ owner: creator, amount: 1_250_000_000n });
  assert.equal(wrapped.instructions.length, 3);
  assert.equal(wrapped.instructions[0]?.programId.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
  assert.deepEqual(wrapped.instructions[0]?.data, Buffer.from([1]));
  assert.equal(wrapped.instructions[1]?.data.readUInt32LE(0), 2);
  assert.equal(wrapped.instructions[1]?.data.readBigUInt64LE(4), 1_250_000_000n);
  assert.deepEqual(wrapped.instructions[2]?.data, Buffer.from([17]));
  assert.equal(wrapped.instructions[2]?.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58());

  const ensured = buildEnsureNativeSolAccountIx(creator);
  assert.equal(ensured.account.toBase58(), wrapped.userTokenAccount.toBase58());
  assert.deepEqual(ensured.instruction.data, Buffer.from([1]));

  const unwrap = buildUnwrapNativeSolIx({ owner: creator, account: wrapped.userTokenAccount });
  assert.equal(unwrap.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58());
  assert.deepEqual(unwrap.data, Buffer.from([9]));
  assert.equal(unwrap.keys[0]?.pubkey.toBase58(), wrapped.userTokenAccount.toBase58());
});

test("native payout and joins use the temporary wrapped-SOL account", () => {
  const created = buildCreateMarketIx({
    creator,
    fixtureId: "12345",
    marketNonce: 9n,
    template: "MATCH_WINNER",
    predicate: {
      statKey1: 1,
      statKey2: 2,
      operator: "SUBTRACT",
      thresholdMilli: 0,
      comparison: "GREATER_THAN"
    },
    lockTs: 1_800_000_000n,
    tokenMint: NATIVE_MINT,
    programId
  });
  const wrapped = buildWrapNativeSolIxs({ owner: creator, amount: 1n });
  const joined = buildJoinMarketIx({
    user: creator,
    market: created.market,
    side: "YES",
    amount: 1n,
    tokenMint: NATIVE_MINT,
    userTokenAccount: wrapped.userTokenAccount,
    escrowTokenAccount: created.escrowTokenAccount,
    programId
  });
  assert.equal(joined.instruction.keys[3]?.pubkey.toBase58(), wrapped.userTokenAccount.toBase58());

  const claimed = buildClaimIx({
    user: creator,
    market: created.market,
    tokenMint: NATIVE_MINT,
    userTokenAccount: wrapped.userTokenAccount,
    escrowTokenAccount: created.escrowTokenAccount,
    programId
  });
  assert.equal(claimed.instruction.keys[3]?.pubkey.toBase58(), wrapped.userTokenAccount.toBase58());
});

test("configuration ABI commits only the approved TxLINE program", () => {
  const initialized = buildInitializeConfigIx({
    authority: creator,
    txlineProgram: new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"),
    programId
  });
  assert.deepEqual(initialized.instruction.data.subarray(0, 8), discriminator("initialize_config"));
  assert.equal(initialized.instruction.data.length, 40);
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
      statToProve: { key: 1, value: 14, period: 14 },
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
        cancellationPhaseId: 14
      }
    },
    programId
  });

  assert.equal(instruction.data.subarray(8, 16).readBigInt64LE(), BigInt(fixtureId));
});
