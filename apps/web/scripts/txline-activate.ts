import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction
} from "@solana/web3.js";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import nacl from "tweetnacl";

const TXLINE_DEVNET_PROGRAM = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const TXLINE_DEVNET_MINT = new PublicKey("4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG");
const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SUBSCRIBE_DISCRIMINATOR = Buffer.from([254, 28, 191, 138, 156, 179, 183, 53]);
const SERVICE_LEVEL_ID = 1;
const DURATION_WEEKS = 4;

const keypairPath = process.env.FINAL_WHISTLE_UPGRADE_AUTHORITY_KEYPAIR;
const outputPath = process.env.TXLINE_API_TOKEN_OUTPUT;
if (!keypairPath) throw new Error("Set FINAL_WHISTLE_UPGRADE_AUTHORITY_KEYPAIR to the subscription wallet keypair path");
if (!outputPath) throw new Error("Set TXLINE_API_TOKEN_OUTPUT to a private output file path");

const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const guestBaseUrl = process.env.TXLINE_GUEST_BASE_URL ?? "https://txline-dev.txodds.com";
const apiBaseUrl = process.env.TXLINE_API_BASE_URL ?? "https://txline-dev.txodds.com/api";
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8"))));
const connection = new Connection(rpcUrl, "confirmed");

const [pricingMatrix] = PublicKey.findProgramAddressSync([Buffer.from("pricing_matrix")], TXLINE_DEVNET_PROGRAM);
const [tokenTreasury] = PublicKey.findProgramAddressSync([Buffer.from("token_treasury_v2")], TXLINE_DEVNET_PROGRAM);
const userTokenAccount = deriveAssociatedTokenAddress(TXLINE_DEVNET_MINT, authority.publicKey);
const tokenTreasuryVault = deriveAssociatedTokenAddress(TXLINE_DEVNET_MINT, tokenTreasury, true);

const transaction = new Transaction().add(
  createAssociatedTokenAccountIdempotentIx({
    payer: authority.publicKey,
    account: userTokenAccount,
    owner: authority.publicKey,
    mint: TXLINE_DEVNET_MINT
  }),
  new TransactionInstruction({
    programId: TXLINE_DEVNET_PROGRAM,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: pricingMatrix, isSigner: false, isWritable: false },
      { pubkey: TXLINE_DEVNET_MINT, isSigner: false, isWritable: false },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: tokenTreasuryVault, isSigner: false, isWritable: true },
      { pubkey: tokenTreasury, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM, isSigner: false, isWritable: false }
    ],
    data: Buffer.concat([SUBSCRIBE_DISCRIMINATOR, u16(SERVICE_LEVEL_ID), Buffer.from([DURATION_WEEKS])])
  })
);

const subscriptionSignature = await sendAndConfirmTransaction(connection, transaction, [authority], {
  commitment: "confirmed",
  preflightCommitment: "confirmed"
});

const jwt = await getGuestJwt(guestBaseUrl);
const message = new TextEncoder().encode(`${subscriptionSignature}::${jwt}`);
const walletSignature = Buffer.from(nacl.sign.detached(message, authority.secretKey)).toString("base64");
const token = await activateToken({ apiBaseUrl, jwt, subscriptionSignature, walletSignature });
await verifyApiAccess({ apiBaseUrl, jwt, token });

writeFileSync(outputPath, token, { encoding: "utf8", mode: 0o600 });
chmodSync(outputPath, 0o600);
console.log(JSON.stringify({ subscriptionSignature, apiAccess: "verified", tokenWritten: true }));

function deriveAssociatedTokenAddress(mint: PublicKey, owner: PublicKey, allowOwnerOffCurve = false) {
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBytes())) {
    throw new Error("Associated token account owner must be on curve");
  }
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_2022_PROGRAM.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM
  )[0];
}

function createAssociatedTokenAccountIdempotentIx(input: {
  payer: PublicKey;
  account: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
}) {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM,
    keys: [
      { pubkey: input.payer, isSigner: true, isWritable: true },
      { pubkey: input.account, isSigner: false, isWritable: true },
      { pubkey: input.owner, isSigner: false, isWritable: false },
      { pubkey: input.mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM, isSigner: false, isWritable: false }
    ],
    data: Buffer.from([1])
  });
}

function u16(value: number) {
  const output = Buffer.alloc(2);
  output.writeUInt16LE(value);
  return output;
}

async function getGuestJwt(origin: string) {
  const response = await fetch(`${origin}/auth/guest/start`, {
    method: "POST",
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw new Error(`TxLINE guest authentication failed (${response.status})`);
  const payload = await response.json() as Record<string, unknown>;
  const jwt = String(payload.jwt ?? payload.token ?? payload.accessToken ?? "");
  if (!jwt) throw new Error("TxLINE guest authentication did not return a JWT");
  return jwt;
}

async function activateToken(input: {
  apiBaseUrl: string;
  jwt: string;
  subscriptionSignature: string;
  walletSignature: string;
}) {
  const response = await fetch(`${input.apiBaseUrl}/token/activate`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${input.jwt}`
    },
    body: JSON.stringify({
      txSig: input.subscriptionSignature,
      walletSignature: input.walletSignature,
      leagues: []
    })
  });
  if (!response.ok) throw new Error(`TxLINE token activation failed (${response.status})`);
  const body = await response.text();
  let payload: unknown = body;
  try {
    payload = JSON.parse(body) as unknown;
  } catch {
    // TxLINE's devnet activation endpoint may return the token as plain text.
  }
  const token = typeof payload === "string"
    ? payload
    : typeof payload === "object" && payload !== null
      ? String((payload as Record<string, unknown>).token ?? (payload as Record<string, unknown>).apiToken ?? "")
      : "";
  if (!token) throw new Error("TxLINE activation did not return an API token");
  return token.trim();
}

async function verifyApiAccess(input: { apiBaseUrl: string; jwt: string; token: string }) {
  const response = await fetch(`${input.apiBaseUrl}/fixtures/snapshot`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.jwt}`,
      "x-api-token": input.token
    }
  });
  if (!response.ok) throw new Error(`TxLINE API verification failed (${response.status})`);
}
