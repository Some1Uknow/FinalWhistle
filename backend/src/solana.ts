import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { createHash } from "node:crypto";
import { config } from "./config.js";

export const connection = new Connection(config.solanaRpcUrl, "confirmed");

export type FinalWhistleInstructionName =
  | "create_market"
  | "join_market"
  | "settle_market"
  | "cancel_market"
  | "cancel_expired_market";

export type OnchainMarketState = {
  status: "OPEN" | "LOCKED" | "SETTLED" | "CANCELLED";
  winningSide?: "YES" | "NO";
  txlineSeq: string;
  proofHash: string;
  tokenMint: string;
  escrowTokenAccount: string;
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

function anchorInstructionDiscriminator(name: string) {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function decodeMarketAccount(data: Buffer): OnchainMarketState {
  let offset = 8;
  offset += 32; // creator
  const fixtureLength = data.readUInt32LE(offset);
  offset += 4 + fixtureLength;
  offset += 8; // market_nonce
  offset += 1; // market_template
  offset += 2; // stat_key_1
  const statKey2Tag = data.readUInt8(offset);
  offset += 1 + (statKey2Tag === 1 ? 2 : 0);
  offset += 1; // operator
  offset += 8; // threshold_milli
  offset += 1; // comparison
  offset += 8; // lock_ts
  offset += 8; // settlement_deadline_ts
  const status = decodeMarketStatus(data.readUInt8(offset));
  offset += 1;
  offset += 8; // yes_stake
  offset += 8; // no_stake
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
    status,
    winningSide,
    txlineSeq,
    proofHash,
    tokenMint,
    escrowTokenAccount
  };
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
