import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { assertOnchainMarketMatchesCreate, decodeMarketAccount, decodePositionAccount } from "../src/server/solana";

const creator = new PublicKey("11111111111111111111111111111111");
const escrow = new PublicKey("So11111111111111111111111111111111111111112");
const mint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const user = new PublicKey("SysvarC1ock11111111111111111111111111111111");
const accountDiscriminator = (name: string) => createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);

test("decodeMarketAccount decodes Anchor market state", () => {
  const fixture = Buffer.from("12345");
  const data = Buffer.alloc(8 + 32 + 4 + fixture.length + 8 + 1 + 2 + 3 + 1 + 8 + 1 + 8 + 8 + 1 + 8 + 8 + 1 + 1 + 32 + 32 + 2 + 8 + 32 + 1);
  accountDiscriminator("Market").copy(data, 0);
  let offset = 8;
  creator.toBuffer().copy(data, offset);
  offset += 32;
  data.writeUInt32LE(fixture.length, offset);
  offset += 4;
  fixture.copy(data, offset);
  offset += fixture.length;
  data.writeBigUInt64LE(7n, offset);
  offset += 8;
  data.writeUInt8(1, offset); // TOTAL_GOALS_OVER_UNDER
  offset += 1;
  data.writeUInt16LE(1, offset);
  offset += 2;
  data.writeUInt8(1, offset);
  offset += 1;
  data.writeUInt16LE(2, offset);
  offset += 2;
  data.writeUInt8(1, offset); // ADD
  offset += 1;
  data.writeBigInt64LE(2500n, offset);
  offset += 8;
  data.writeUInt8(0, offset);
  offset += 1;
  data.writeBigInt64LE(1_800_000_000n, offset);
  offset += 8;
  data.writeBigInt64LE(1_801_209_600n, offset);
  offset += 8;
  data.writeUInt8(1, offset); // LOCKED
  offset += 1;
  data.writeBigUInt64LE(100n, offset);
  offset += 8;
  data.writeBigUInt64LE(100n, offset);
  offset += 8;
  data.writeUInt8(1, offset);
  offset += 1;
  data.writeUInt8(1, offset);
  offset += 1;
  escrow.toBuffer().copy(data, offset);
  offset += 32;
  mint.toBuffer().copy(data, offset);
  offset += 32;
  data.writeUInt8(1, offset);
  offset += 1;
  data.writeUInt8(0, offset);
  offset += 1;
  data.writeBigUInt64LE(44n, offset);
  offset += 8;
  Buffer.alloc(32, 9).copy(data, offset);

  const decoded = decodeMarketAccount(data);
  assert.equal(decoded.fixtureId, "12345");
  assert.equal(decoded.creator, creator.toBase58());
  assert.equal(decoded.marketNonce, "7");
  assert.equal(decoded.template, "TOTAL_GOALS_OVER_UNDER");
  assert.deepEqual(decoded.predicate, {
    statKey1: 1,
    statKey2: 2,
    operator: "ADD",
    thresholdMilli: "2500",
    comparison: "GREATER_THAN"
  });
  assert.equal(decoded.lockTs, "1800000000");
  assert.equal(decoded.status, "LOCKED");
  assert.equal(decoded.yesStake, "100");
  assert.equal(decoded.noStake, "100");
  assert.equal(decoded.winningSide, "YES");
  assert.equal(decoded.txlineSeq, "44");
  assert.equal(decoded.tokenMint, mint.toBase58());
  assert.equal(decoded.escrowTokenAccount, escrow.toBase58());
});

test("decodePositionAccount decodes Anchor position state", () => {
  const data = Buffer.alloc(8 + 1 + 32 + 32 + 1 + 8 + 1 + 1);
  accountDiscriminator("Position").copy(data, 0);
  let offset = 8;
  data.writeUInt8(1, offset);
  offset += 1;
  escrow.toBuffer().copy(data, offset);
  offset += 32;
  user.toBuffer().copy(data, offset);
  offset += 32;
  data.writeUInt8(1, offset);
  offset += 1;
  data.writeBigUInt64LE(500n, offset);
  offset += 8;
  data.writeUInt8(0, offset);

  const decoded = decodePositionAccount(data);
  assert.equal(decoded.initialized, true);
  assert.equal(decoded.market, escrow.toBase58());
  assert.equal(decoded.user, user.toBase58());
  assert.equal(decoded.side, "NO");
  assert.equal(decoded.amount, "500");
  assert.equal(decoded.claimed, false);
});

test("market indexing rejects an on-chain predicate that differs from the advertised rule", () => {
  const onchain = {
    creator: creator.toBase58(),
    marketNonce: "7",
    status: "OPEN" as const,
    fixtureId: "12345",
    template: "TOTAL_GOALS_OVER_UNDER" as const,
    predicate: {
      statKey1: 1,
      statKey2: 2,
      operator: "ADD" as const,
      thresholdMilli: "2500",
      comparison: "LESS_THAN" as const
    },
    lockTs: "1800000000",
    settlementDeadlineTs: "1801209600",
    yesStake: "0",
    noStake: "0",
    tokenMint: mint.toBase58(),
    escrowTokenAccount: escrow.toBase58(),
    txlineSeq: "0",
    proofHash: "00".repeat(32)
  };

  assert.throws(
    () => assertOnchainMarketMatchesCreate({
      onchain,
      creator: creator.toBase58(),
      marketNonce: "7",
      template: "TOTAL_GOALS_OVER_UNDER",
      predicate: {
        statKey1: 1,
        statKey2: 2,
        operator: "ADD",
        thresholdMilli: 2500,
        comparison: "GREATER_THAN"
      },
      lockTs: 1_800_000_000n,
      tokenMint: mint.toBase58(),
      escrowTokenAccount: escrow.toBase58()
    }),
    /predicate/
  );
});

test("decoded claimed state is explicit for claim verification", () => {
  const data = Buffer.alloc(8 + 1 + 32 + 32 + 1 + 8 + 1 + 1);
  accountDiscriminator("Position").copy(data, 0);
  let offset = 8;
  data.writeUInt8(1, offset);
  offset += 1;
  escrow.toBuffer().copy(data, offset);
  offset += 32;
  user.toBuffer().copy(data, offset);
  offset += 32;
  data.writeUInt8(0, offset);
  offset += 1;
  data.writeBigUInt64LE(500n, offset);
  offset += 8;
  data.writeUInt8(1, offset);

  const decoded = decodePositionAccount(data);
  assert.equal(decoded.claimed, true);
});
