"use client";

import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction
} from "@solana/web3.js";
import { Buffer } from "buffer";
import type { MarketRecord, MarketTemplate, Predicate, Side } from "@/server/domain";

// Keep the token-account derivation local. The application only needs the
// canonical token program and ATA PDA, not the full SPL Token client package.
// This removes an avoidable production dependency chain that includes an
// unpatched bigint-buffer advisory.
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

export const FINAL_WHISTLE_INSTRUCTIONS = {
  initializeConfig: Buffer.from([208, 127, 21, 1, 194, 190, 196, 70]),
  createMarket: Buffer.from([103, 226, 97, 235, 200, 188, 251, 254]),
  joinMarket: Buffer.from([141, 113, 87, 152, 182, 213, 41, 202]),
  settleMarket: Buffer.from([193, 153, 95, 216, 166, 6, 144, 217]),
  cancelMarket: Buffer.from([205, 121, 84, 210, 222, 71, 150, 11]),
  cancelExpiredMarket: Buffer.from([243, 221, 107, 127, 70, 208, 152, 87]),
  claimPayout: Buffer.from([127, 240, 132, 62, 227, 198, 146, 133])
} as const;

export type PublicConfig = {
  cluster: string;
  programId: string;
  txlineProgramId: string;
  allowedStakeMints: string[];
  finalityConfigured: boolean;
  programConfigReady: boolean;
  replayEnabled: boolean;
  devnetTokenFaucetUrl: string;
};

export type TxlineProofPayload = {
  mode: "VALIDATED_ON_CHAIN_BY_TXLINE";
  txlineProgramId: string;
  dailyScoresMerkleRoots: string;
  instruction: "settle_market" | "cancel_market";
  args: Record<string, unknown>;
};

export function deriveMarketPda(input: {
  creator: PublicKey;
  fixtureId: string;
  marketNonce: bigint;
  programId: PublicKey;
}) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), input.creator.toBuffer(), Buffer.from(input.fixtureId), u64(input.marketNonce)],
    input.programId
  )[0];
}

export function deriveEscrowTokenAccount(market: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("escrow"), market.toBuffer()], programId)[0];
}

export function deriveProgramConfigPda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
}

export function derivePositionPda(market: PublicKey, user: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("position"), market.toBuffer(), user.toBuffer()], programId)[0];
}

export function deriveAssociatedTokenAddress(mint: PublicKey, owner: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

/** Administrative bootstrap instruction. This must be signed by the program's
 * upgrade authority and run once after deploying the hardened program. */
export function buildInitializeConfigIx(input: {
  authority: PublicKey;
  txlineProgram: PublicKey;
  finalityStatKey: number;
  programId: PublicKey;
}) {
  const config = deriveProgramConfigPda(input.programId);
  const programData = PublicKey.findProgramAddressSync(
    [input.programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID
  )[0];
  return {
    config,
    programData,
    instruction: new TransactionInstruction({
      programId: input.programId,
      keys: [
        { pubkey: input.authority, isSigner: true, isWritable: true },
        { pubkey: config, isSigner: false, isWritable: true },
        { pubkey: input.programId, isSigner: false, isWritable: false },
        { pubkey: programData, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
      ],
      data: concat([
        FINAL_WHISTLE_INSTRUCTIONS.initializeConfig,
        input.txlineProgram.toBuffer(),
        u32(input.finalityStatKey)
      ])
    })
  };
}

export function buildCreateMarketIx(input: {
  creator: PublicKey;
  fixtureId: string;
  marketNonce: bigint;
  template: MarketTemplate;
  predicate: Predicate;
  lockTs: bigint;
  tokenMint: PublicKey;
  programId: PublicKey;
}) {
  const market = deriveMarketPda(input);
  const escrowTokenAccount = deriveEscrowTokenAccount(market, input.programId);
  const programConfig = deriveProgramConfigPda(input.programId);
  const data = concat([
    FINAL_WHISTLE_INSTRUCTIONS.createMarket,
    str(input.fixtureId),
    u64(input.marketNonce),
    marketTemplate(input.template),
    predicate(input.predicate),
    i64(input.lockTs)
  ]);

  return {
    market,
    escrowTokenAccount,
    programConfig,
    instruction: new TransactionInstruction({
      programId: input.programId,
      keys: [
        { pubkey: input.creator, isSigner: true, isWritable: true },
        { pubkey: programConfig, isSigner: false, isWritable: false },
        { pubkey: market, isSigner: false, isWritable: true },
        { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
        { pubkey: input.tokenMint, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }
      ],
      data
    })
  };
}

export function buildJoinMarketIx(input: {
  user: PublicKey;
  market: PublicKey;
  side: Side;
  amount: bigint;
  tokenMint: PublicKey;
  escrowTokenAccount: PublicKey;
  programId: PublicKey;
}) {
  const position = derivePositionPda(input.market, input.user, input.programId);
  const userTokenAccount = deriveAssociatedTokenAddress(input.tokenMint, input.user);
  const data = concat([FINAL_WHISTLE_INSTRUCTIONS.joinMarket, side(input.side), u64(input.amount)]);

  return {
    position,
    userTokenAccount,
    instruction: new TransactionInstruction({
      programId: input.programId,
      keys: [
        { pubkey: input.user, isSigner: true, isWritable: true },
        { pubkey: input.market, isSigner: false, isWritable: true },
        { pubkey: position, isSigner: false, isWritable: true },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: input.escrowTokenAccount, isSigner: false, isWritable: true },
        { pubkey: input.tokenMint, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
      ],
      data
    })
  };
}

export function buildCancelExpiredIx(input: { market: PublicKey; programId: PublicKey }) {
  return new TransactionInstruction({
    programId: input.programId,
    keys: [{ pubkey: input.market, isSigner: false, isWritable: true }],
    data: FINAL_WHISTLE_INSTRUCTIONS.cancelExpiredMarket
  });
}

export function buildClaimIx(input: {
  user: PublicKey;
  market: PublicKey;
  tokenMint: PublicKey;
  escrowTokenAccount: PublicKey;
  programId: PublicKey;
}) {
  const position = derivePositionPda(input.market, input.user, input.programId);
  const userTokenAccount = deriveAssociatedTokenAddress(input.tokenMint, input.user);
  return {
    position,
    instruction: new TransactionInstruction({
      programId: input.programId,
      keys: [
        { pubkey: input.user, isSigner: true, isWritable: true },
        { pubkey: input.market, isSigner: false, isWritable: true },
        { pubkey: position, isSigner: false, isWritable: true },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: input.escrowTokenAccount, isSigner: false, isWritable: true },
        { pubkey: input.tokenMint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
      ],
      data: FINAL_WHISTLE_INSTRUCTIONS.claimPayout
    })
  };
}

export function buildProofIx(input: { market: MarketRecord; payload: TxlineProofPayload; programId: PublicKey }) {
  const market = new PublicKey(input.market.marketPda!);
  const txlineProgram = new PublicKey(input.payload.txlineProgramId);
  const dailyScores = new PublicKey(input.payload.dailyScoresMerkleRoots);
  const programConfig = deriveProgramConfigPda(input.programId);
  const isSettlement = input.payload.instruction === "settle_market";
  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: txlineProgram, isSigner: false, isWritable: false },
      { pubkey: dailyScores, isSigner: false, isWritable: false },
      { pubkey: programConfig, isSigner: false, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true }
    ],
    data: concat([
      isSettlement ? FINAL_WHISTLE_INSTRUCTIONS.settleMarket : FINAL_WHISTLE_INSTRUCTIONS.cancelMarket,
      isSettlement ? settlementArgs(input.payload.args) : cancellationArgs(input.payload.args)
    ])
  });
}

function settlementArgs(args: Record<string, unknown>) {
  return concat([
    i64(BigInt(Number(args.fixtureId))),
    u64(BigInt(String(args.seq))),
    u32(Number(args.statKey1)),
    option(args.statKey2 === undefined ? undefined : u32(Number(args.statKey2))),
    txlineProof(args.outcomeProof as Record<string, unknown>),
    txlineProof(args.finalityProof as Record<string, unknown>),
    u32(Number(args.finalityStatKey)),
    i32(Number(args.finalPhaseId))
  ]);
}

function cancellationArgs(args: Record<string, unknown>) {
  return concat([
    i64(BigInt(Number(args.fixtureId))),
    u64(BigInt(String(args.seq))),
    txlineProof(args.cancellationProof as Record<string, unknown>),
    u32(Number(args.cancellationStatKey)),
    i32(Number(args.cancellationPhaseId))
  ]);
}

function txlineProof(proof: Record<string, unknown>) {
  const summary = proof.fixtureSummary as Record<string, unknown>;
  const updateStats = summary.updateStats as Record<string, unknown>;
  return concat([
    i64(BigInt(String(proof.ts))),
    i64(BigInt(String(summary.fixtureId))),
    i32(Number(updateStats.updateCount)),
    i64(BigInt(String(updateStats.minTimestamp))),
    i64(BigInt(String(updateStats.maxTimestamp))),
    bytes32(summary.eventsSubTreeRoot),
    vec(proof.fixtureProof as unknown[], proofNode),
    vec(proof.mainTreeProof as unknown[], proofNode),
    i32(Number((proof.predicate as { threshold: number }).threshold)),
    comparison((proof.predicate as { comparison: Record<string, unknown> }).comparison),
    statTerm(proof.statA as Record<string, unknown>),
    option(proof.statB ? statTerm(proof.statB as Record<string, unknown>) : undefined),
    option(proof.op ? binaryExpression(proof.op as Record<string, unknown>) : undefined)
  ]);
}

function proofNode(node: unknown) {
  const record = node as Record<string, unknown>;
  return concat([bytes32(record.hash), bool(Boolean(record.isRightSibling))]);
}

function statTerm(term: Record<string, unknown>) {
  const stat = term.statToProve as Record<string, unknown>;
  return concat([
    u32(Number(stat.key)),
    i32(Number(stat.value)),
    i32(Number(stat.period)),
    bytes32(term.eventStatRoot),
    vec(term.statProof as unknown[], proofNode)
  ]);
}

function predicate(value: Predicate) {
  return concat([
    u16(value.statKey1),
    option(value.statKey2 === undefined ? undefined : u16(value.statKey2)),
    statOperator(value.operator),
    i64(BigInt(value.thresholdMilli)),
    comparisonName(value.comparison)
  ]);
}

function marketTemplate(value: MarketTemplate) {
  return u8(value === "MATCH_WINNER" ? 0 : 1);
}

function side(value: Side) {
  return u8(value === "YES" ? 0 : 1);
}

function statOperator(value: Predicate["operator"]) {
  return u8(value === "NONE" ? 0 : value === "ADD" ? 1 : 2);
}

function comparisonName(value: Predicate["comparison"]) {
  return u8(value === "GREATER_THAN" ? 0 : value === "LESS_THAN" ? 1 : 2);
}

function comparison(value: Record<string, unknown>) {
  if ("lessThan" in value) return u8(1);
  if ("equalTo" in value) return u8(2);
  return u8(0);
}

function binaryExpression(value: Record<string, unknown>) {
  return u8("subtract" in value ? 1 : 0);
}

function option(value?: Buffer) {
  return value ? concat([u8(1), value]) : u8(0);
}

function vec<T>(items: T[], encode: (item: T) => Buffer) {
  return concat([u32(items.length), ...items.map(encode)]);
}

function str(value: string) {
  const encoded = Buffer.from(value, "utf8");
  return concat([u32(encoded.length), encoded]);
}

function bytes32(value: unknown) {
  const bytes = Array.isArray(value) ? Buffer.from(value) : Buffer.from(String(value), "hex");
  if (bytes.length !== 32) throw new Error("Expected 32-byte proof hash");
  return bytes;
}

function bool(value: boolean) {
  return u8(value ? 1 : 0);
}

function u8(value: number) {
  return Buffer.from([value]);
}

function u16(value: number) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function i32(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(value);
  return buffer;
}

function u64(value: bigint) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value);
  return buffer;
}

function i64(value: bigint) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64LE(value);
  return buffer;
}

function concat(items: Buffer[]) {
  return Buffer.concat(items);
}
