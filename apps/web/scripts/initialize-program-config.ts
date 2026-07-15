import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { buildInitializeConfigIx } from "../src/client/finalwhistle";
import { config, validateConfig } from "../src/server/config";

validateConfig();

const keypairPath = process.env.FINAL_WHISTLE_UPGRADE_AUTHORITY_KEYPAIR;
if (!keypairPath) {
  throw new Error("Set FINAL_WHISTLE_UPGRADE_AUTHORITY_KEYPAIR to the local upgrade-authority keypair path");
}

const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8"))));
const programId = new PublicKey(config.programId);
const built = buildInitializeConfigIx({
  authority: authority.publicKey,
  txlineProgram: new PublicKey(config.txlineProgramId),
  programId
});
const transaction = new Transaction().add(built.instruction);
const signature = await sendAndConfirmTransaction(
  new Connection(config.solanaRpcUrl, "confirmed"),
  transaction,
  [authority],
  { commitment: "confirmed" }
);

console.log(JSON.stringify({ signature, programConfig: built.config.toBase58() }));
