import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction
} from "@solana/web3.js";
import { readFileSync } from "node:fs";
import {
  buildCreateMarketIx,
  buildJoinMarketIx,
  buildUnwrapNativeSolIx,
  buildWrapNativeSolIxs,
  NATIVE_MINT
} from "../src/client/finalwhistle";

const programId = new PublicKey(process.env.FINAL_WHISTLE_PROGRAM_ID ?? "Hf4KSaGy7EHEaT9jMCo9nKx2uQRz6BEsYS3DrprkDaPw");
const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const authorityPath = process.env.FINAL_WHISTLE_UPGRADE_AUTHORITY_KEYPAIR;
if (!authorityPath) throw new Error("Set FINAL_WHISTLE_UPGRADE_AUTHORITY_KEYPAIR to a funded devnet keypair path");

const connection = new Connection(rpcUrl, "confirmed");
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(authorityPath, "utf8"))));
const user = Keypair.generate();
const fundingLamports = 50_000_000;

try {
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: user.publicKey,
      lamports: fundingLamports
    })),
    [authority],
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );

  // This is an actual devnet transaction. It proves that normal SOL can be
  // wrapped and closed back to SOL without leaving a token account behind.
  const roundTrip = buildWrapNativeSolIxs({ owner: user.publicKey, amount: 1_000_000n });
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      ...roundTrip.instructions,
      buildUnwrapNativeSolIx({ owner: user.publicKey, account: roundTrip.userTokenAccount })
    ),
    [user],
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  if (await connection.getAccountInfo(roundTrip.userTokenAccount, "confirmed")) {
    throw new Error("Wrapped-SOL account was not closed after the round trip");
  }

  // Simulate the exact atomic create-and-initial-stake transaction used by the
  // browser. Simulation validates all program, SPL Token, rent, and signer
  // checks without creating a permanent fake market on devnet.
  const amount = 1_000_000n;
  const wrapped = buildWrapNativeSolIxs({ owner: user.publicKey, amount });
  const marketNonce = BigInt(Date.now());
  const created = buildCreateMarketIx({
    creator: user.publicKey,
    fixtureId: String(Date.now()),
    marketNonce,
    template: "MATCH_WINNER",
    predicate: {
      statKey1: 1,
      statKey2: 2,
      operator: "SUBTRACT",
      thresholdMilli: 0,
      comparison: "GREATER_THAN"
    },
    lockTs: BigInt(Math.floor(Date.now() / 1000) + 15 * 60),
    tokenMint: NATIVE_MINT,
    programId
  });
  const position = buildJoinMarketIx({
    user: user.publicKey,
    market: created.market,
    side: "YES",
    amount,
    tokenMint: NATIVE_MINT,
    userTokenAccount: wrapped.userTokenAccount,
    escrowTokenAccount: created.escrowTokenAccount,
    programId
  });
  const transaction = new Transaction().add(
    ...wrapped.instructions,
    created.instruction,
    position.instruction,
    buildUnwrapNativeSolIx({ owner: user.publicKey, account: wrapped.userTokenAccount })
  );
  transaction.feePayer = user.publicKey;
  transaction.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  transaction.sign(user);
  const simulation = await connection.simulateTransaction(transaction);
  if (simulation.value.err) {
    throw new Error(`Native-SOL market simulation failed: ${JSON.stringify(simulation.value.err)}`);
  }

  console.log(JSON.stringify({ nativeSolRoundTrip: "passed", createAndJoinSimulation: "passed" }));
} finally {
  const balance = await connection.getBalance(user.publicKey, "confirmed").catch(() => 0);
  const rentReserve = await connection.getMinimumBalanceForRentExemption(0, "confirmed").catch(() => 0);
  const cleanupLamports = balance - rentReserve - 10_000;
  if (cleanupLamports > 0) {
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(SystemProgram.transfer({
        fromPubkey: user.publicKey,
        toPubkey: authority.publicKey,
        lamports: cleanupLamports
      })),
      [user],
      { commitment: "confirmed", preflightCommitment: "confirmed" }
    );
  }
}
