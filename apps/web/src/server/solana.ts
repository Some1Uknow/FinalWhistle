import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { createHash } from "node:crypto";
import { config } from "./config";
import type { Predicate } from "./domain";

export const connection = new Connection(config.solanaRpcUrl, "confirmed");
const MARKET_ACCOUNT_DISCRIMINATOR = anchorAccountDiscriminator("Market");
const POSITION_ACCOUNT_DISCRIMINATOR = anchorAccountDiscriminator("Position");
const PROGRAM_CONFIG_ACCOUNT_DISCRIMINATOR = anchorAccountDiscriminator("ProgramConfig");

export type FinalWhistleInstructionName =
  | "initialize_config"
  | "create_market"
  | "join_market"
  | "settle_market"
  | "cancel_market"
  | "cancel_expired_market"
  | "claim_payout";

export type OnchainMarketState = {
  creator: string;
  marketNonce: string;
  status: "OPEN" | "LOCKED" | "SETTLED" | "CANCELLED";
  winningSide?: "YES" | "NO";
  txlineSeq: string;
  proofHash: string;
  fixtureId: string;
  template: "MATCH_WINNER" | "TOTAL_GOALS_OVER_UNDER";
  predicate: {
    statKey1: number;
    statKey2?: number;
    operator: "NONE" | "ADD" | "SUBTRACT";
    thresholdMilli: string;
    comparison: "GREATER_THAN" | "LESS_THAN" | "EQUAL";
  };
  lockTs: string;
  settlementDeadlineTs: string;
  yesStake: string;
  noStake: string;
  tokenMint: string;
  escrowTokenAccount: string;
};

export type OnchainProgramConfig = {
  authority: string;
  txlineProgram: string;
  finalityStatKey: number;
};

export type OnchainPositionState = {
  initialized: boolean;
  market: string;
  user: string;
  side: "YES" | "NO";
  amount: string;
  claimed: boolean;
};

export async function requireConfirmedFinalWhistleInstruction(input: {
  signature: string;
  instruction: FinalWhistleInstructionName;
  requiredAccounts: string[];
}) {
  const transaction = await connection.getParsedTransaction(input.signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0
  });

  if (!transaction) throw new Error("Transaction was not found or is not confirmed");
  if (transaction.meta?.err) throw new Error("Transaction failed on-chain");

  const accounts = new Set(transaction.transaction.message.accountKeys.map((account) => account.pubkey.toBase58()));
  for (const account of input.requiredAccounts) {
    if (!accounts.has(new PublicKey(account).toBase58())) {
      throw new Error(`Transaction does not reference required account ${account}`);
    }
  }

  const discriminator = anchorInstructionDiscriminator(input.instruction);
  const matched = transaction.transaction.message.instructions.some((instruction) => {
    if (!("programId" in instruction) || instruction.programId.toBase58() !== config.programId) {
      return false;
    }
    if (!("data" in instruction)) return false;
    const data = bs58.decode(instruction.data);
    if (!Buffer.from(data.subarray(0, 8)).equals(discriminator)) return false;

    const instructionAccounts = new Set(
      ("accounts" in instruction ? instruction.accounts : []).map((account) => new PublicKey(account).toBase58())
    );
    return input.requiredAccounts.every((account) => instructionAccounts.has(new PublicKey(account).toBase58()));
  });

  if (!matched) {
    throw new Error(`Transaction does not contain expected FinalWhistle ${input.instruction} instruction`);
  }

  return transaction;
}

export async function requireOnchainMarketState(input: {
  marketPda: string;
  expectedStatus: OnchainMarketState["status"];
  expectedSeq?: string;
}) {
  const publicKey = new PublicKey(input.marketPda);
  const account = await connection.getAccountInfo(publicKey, "confirmed");
  if (!account) throw new Error("Market account was not found on-chain");
  if (!account.owner.equals(new PublicKey(config.programId))) {
    throw new Error("Market account is not owned by the configured FinalWhistle program");
  }

  const state = decodeMarketAccount(account.data);
  if (state.status !== input.expectedStatus) {
    throw new Error(`On-chain market status is ${state.status}, expected ${input.expectedStatus}`);
  }
  if (input.expectedSeq !== undefined && state.txlineSeq !== input.expectedSeq) {
    throw new Error(`On-chain TxLINE sequence is ${state.txlineSeq}, expected ${input.expectedSeq}`);
  }
  return state;
}

export function deriveProgramConfigPda() {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], new PublicKey(config.programId))[0];
}

export async function requireOnchainProgramConfig() {
  const publicKey = deriveProgramConfigPda();
  const account = await connection.getAccountInfo(publicKey, "confirmed");
  if (!account) throw new Error("Program configuration has not been initialized on-chain");
  if (!account.owner.equals(new PublicKey(config.programId))) {
    throw new Error("Program configuration is not owned by the configured FinalWhistle program");
  }

  const state = decodeProgramConfigAccount(account.data);
  if (state.txlineProgram !== new PublicKey(config.txlineProgramId).toBase58()) {
    throw new Error("On-chain TxLINE program does not match server configuration");
  }
  if (!config.txlineFinalityStatKey || state.finalityStatKey !== config.txlineFinalityStatKey) {
    throw new Error("On-chain finality stat does not match server configuration");
  }
  return state;
}

export function assertOnchainMarketMatchesCreate(input: {
  onchain: OnchainMarketState;
  creator: string;
  marketNonce: string;
  template: OnchainMarketState["template"];
  predicate: Predicate;
  lockTs: bigint;
  tokenMint: string;
  escrowTokenAccount: string;
}) {
  const expectedCreator = new PublicKey(input.creator).toBase58();
  if (input.onchain.creator !== expectedCreator) throw new Error("On-chain market creator does not match request");
  if (input.onchain.marketNonce !== input.marketNonce) throw new Error("On-chain market nonce does not match request");
  if (input.onchain.template !== input.template) throw new Error("On-chain market template does not match request");
  if (input.onchain.tokenMint !== new PublicKey(input.tokenMint).toBase58()) {
    throw new Error("On-chain token mint does not match request");
  }
  if (input.onchain.escrowTokenAccount !== new PublicKey(input.escrowTokenAccount).toBase58()) {
    throw new Error("On-chain escrow token account does not match request");
  }
  const expectedStatKey2 = input.predicate.statKey2;
  const actual = input.onchain.predicate;
  if (
    actual.statKey1 !== input.predicate.statKey1 ||
    actual.statKey2 !== expectedStatKey2 ||
    actual.operator !== input.predicate.operator ||
    actual.thresholdMilli !== String(input.predicate.thresholdMilli) ||
    actual.comparison !== input.predicate.comparison
  ) {
    throw new Error("On-chain market predicate does not match the advertised market rule");
  }
  if (input.onchain.lockTs !== input.lockTs.toString()) {
    throw new Error("On-chain market lock time does not match the advertised lock time");
  }
}

export async function requireOnchainPositionState(input: {
  positionPda: string;
  expectedMarket: string;
  expectedUser: string;
  expectedSide: OnchainPositionState["side"];
  expectedAmount: string;
  expectedClaimed?: boolean;
}) {
  const publicKey = new PublicKey(input.positionPda);
  const account = await connection.getAccountInfo(publicKey, "confirmed");
  if (!account) throw new Error("Position account was not found on-chain");
  if (!account.owner.equals(new PublicKey(config.programId))) {
    throw new Error("Position account is not owned by the configured FinalWhistle program");
  }

  const state = decodePositionAccount(account.data);
  if (!state.initialized) throw new Error("On-chain position is not initialized");
  if (state.market !== new PublicKey(input.expectedMarket).toBase58()) {
    throw new Error("On-chain position market does not match request market");
  }
  if (state.user !== new PublicKey(input.expectedUser).toBase58()) {
    throw new Error("On-chain position user does not match request wallet");
  }
  if (state.side !== input.expectedSide) throw new Error("On-chain position side does not match request side");
  if (state.amount !== input.expectedAmount) throw new Error("On-chain position amount does not match request amount");
  if (input.expectedClaimed !== undefined && state.claimed !== input.expectedClaimed) {
    throw new Error(`On-chain position claimed state is ${state.claimed}, expected ${input.expectedClaimed}`);
  }
  return state;
}

function anchorInstructionDiscriminator(name: string) {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function anchorAccountDiscriminator(name: string) {
  return createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
}

export function decodeMarketAccount(data: Buffer): OnchainMarketState {
  assertAccountDiscriminator(data, MARKET_ACCOUNT_DISCRIMINATOR, "market");
  let offset = 8;
  const creator = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
  offset += 32;
  const fixtureLength = data.readUInt32LE(offset);
  offset += 4;
  const fixtureId = data.subarray(offset, offset + fixtureLength).toString("utf8");
  offset += fixtureLength;
  const marketNonce = data.readBigUInt64LE(offset).toString();
  offset += 8;
  const template = decodeMarketTemplate(data.readUInt8(offset));
  offset += 1;
  const statKey1 = data.readUInt16LE(offset);
  offset += 2;
  const statKey2Tag = data.readUInt8(offset);
  offset += 1;
  const statKey2 = statKey2Tag === 1 ? data.readUInt16LE(offset) : undefined;
  if (statKey2Tag !== 0 && statKey2Tag !== 1) throw new Error("Unknown on-chain optional stat key tag");
  offset += statKey2Tag === 1 ? 2 : 0;
  const operator = decodeStatOperator(data.readUInt8(offset));
  offset += 1;
  const thresholdMilli = data.readBigInt64LE(offset).toString();
  offset += 8;
  const comparison = decodeComparison(data.readUInt8(offset));
  offset += 1;
  const lockTs = data.readBigInt64LE(offset).toString();
  offset += 8;
  const settlementDeadlineTs = data.readBigInt64LE(offset).toString();
  offset += 8;
  const status = decodeMarketStatus(data.readUInt8(offset));
  offset += 1;
  const yesStake = data.readBigUInt64LE(offset).toString();
  offset += 8;
  const noStake = data.readBigUInt64LE(offset).toString();
  offset += 8;
  offset += 1; // yes_positions
  offset += 1; // no_positions
  const escrowTokenAccount = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
  offset += 32;
  const tokenMint = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
  offset += 32;
  const winningSideTag = data.readUInt8(offset);
  offset += 1;
  const winningSide =
    winningSideTag === 1 ? decodeSide(data.readUInt8(offset)) : undefined;
  offset += winningSideTag === 1 ? 1 : 0;
  const txlineSeq = data.readBigUInt64LE(offset).toString();
  offset += 8;
  const proofHash = Buffer.from(data.subarray(offset, offset + 32)).toString("hex");

  return {
    creator,
    marketNonce,
    status,
    winningSide,
    txlineSeq,
    proofHash,
    fixtureId,
    template,
    predicate: { statKey1, statKey2, operator, thresholdMilli, comparison },
    lockTs,
    settlementDeadlineTs,
    yesStake,
    noStake,
    tokenMint,
    escrowTokenAccount
  };
}

export function decodeProgramConfigAccount(data: Buffer): OnchainProgramConfig {
  if (data.length < 8 + 32 + 32 + 4 + 1) throw new Error("On-chain program configuration account is truncated");
  assertAccountDiscriminator(data, PROGRAM_CONFIG_ACCOUNT_DISCRIMINATOR, "program configuration");
  let offset = 8;
  const authority = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
  offset += 32;
  const txlineProgram = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
  offset += 32;
  const finalityStatKey = data.readUInt32LE(offset);
  return { authority, txlineProgram, finalityStatKey };
}

export function decodePositionAccount(data: Buffer): OnchainPositionState {
  assertAccountDiscriminator(data, POSITION_ACCOUNT_DISCRIMINATOR, "position");
  let offset = 8;
  const initialized = data.readUInt8(offset) === 1;
  offset += 1;
  const market = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
  offset += 32;
  const user = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
  offset += 32;
  const side = decodeSide(data.readUInt8(offset));
  offset += 1;
  const amount = data.readBigUInt64LE(offset).toString();
  offset += 8;
  const claimed = data.readUInt8(offset) === 1;
  return { initialized, market, user, side, amount, claimed };
}

function decodeMarketTemplate(value: number): OnchainMarketState["template"] {
  if (value === 0) return "MATCH_WINNER";
  if (value === 1) return "TOTAL_GOALS_OVER_UNDER";
  throw new Error(`Unknown on-chain market template ${value}`);
}

function decodeMarketStatus(value: number): OnchainMarketState["status"] {
  if (value === 0) return "OPEN";
  if (value === 1) return "LOCKED";
  if (value === 2) return "SETTLED";
  if (value === 3) return "CANCELLED";
  throw new Error(`Unknown on-chain market status ${value}`);
}

function decodeSide(value: number): "YES" | "NO" {
  if (value === 0) return "YES";
  if (value === 1) return "NO";
  throw new Error(`Unknown on-chain side ${value}`);
}

function decodeStatOperator(value: number): OnchainMarketState["predicate"]["operator"] {
  if (value === 0) return "NONE";
  if (value === 1) return "ADD";
  if (value === 2) return "SUBTRACT";
  throw new Error(`Unknown on-chain stat operator ${value}`);
}

function decodeComparison(value: number): OnchainMarketState["predicate"]["comparison"] {
  if (value === 0) return "GREATER_THAN";
  if (value === 1) return "LESS_THAN";
  if (value === 2) return "EQUAL";
  throw new Error(`Unknown on-chain comparison ${value}`);
}

function assertAccountDiscriminator(data: Buffer, expected: Buffer, label: string) {
  if (data.length < 8 || !data.subarray(0, 8).equals(expected)) {
    throw new Error(`Account is not a FinalWhistle ${label}`);
  }
}
