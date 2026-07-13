import { PublicKey } from "@solana/web3.js";
import { config, validateConfig } from "../src/server/config";
import {
  connection,
  decodeMarketAccount,
  decodePositionAccount
} from "../src/server/solana";
import {
  getMarketByPda,
  getPositionForWallet,
  reconcileOnchainMarket,
  reconcileOnchainPosition,
  withTransaction
} from "../src/server/db";

validateConfig();

const accounts = await connection.getProgramAccounts(new PublicKey(config.programId), {
  commitment: "confirmed"
});

const positions: Array<{ pda: string; state: ReturnType<typeof decodePositionAccount> }> = [];
let marketsSeen = 0;
let marketsCreated = 0;
let positionsSeen = 0;
let positionsCreated = 0;

for (const account of accounts) {
  try {
    const state = decodeMarketAccount(account.account.data);
    const existed = Boolean(await getMarketByPda(account.pubkey.toBase58()));
    await reconcileOnchainMarket({
      marketPda: account.pubkey.toBase58(),
      fixtureId: state.fixtureId,
      creator: state.creator,
      escrowTokenAccount: state.escrowTokenAccount,
      tokenMint: state.tokenMint,
      template: state.template,
      predicate: {
        statKey1: state.predicate.statKey1,
        statKey2: state.predicate.statKey2,
        operator: state.predicate.operator,
        thresholdMilli: Number(state.predicate.thresholdMilli),
        comparison: state.predicate.comparison
      },
      lockTs: toIsoTimestamp(state.lockTs),
      status: state.status,
      yesStake: state.yesStake,
      noStake: state.noStake,
      winningSide: state.winningSide,
      txlineSeq: state.txlineSeq,
      proofHash: state.proofHash
    });
    marketsSeen += 1;
    if (!existed) marketsCreated += 1;
    continue;
  } catch {
    // It may be a Position account; decode it below.
  }

  try {
    positions.push({ pda: account.pubkey.toBase58(), state: decodePositionAccount(account.account.data) });
  } catch {
    // Ignore non-FinalWhistle account data owned by the program, if any.
  }
}

await withTransaction(async (executor) => {
  for (const position of positions) {
    if (!position.state.initialized) continue;
    const market = await getMarketByPda(position.state.market, executor);
    if (!market) continue;
    const existed = Boolean(await getPositionForWallet({ marketId: market.id, userWallet: position.state.user }, executor));
    await reconcileOnchainPosition({
      marketId: market.id,
      userWallet: position.state.user,
      side: position.state.side,
      amount: position.state.amount,
      onchainPosition: position.pda,
      claimed: position.state.claimed
    }, executor);
    positionsSeen += 1;
    if (!existed) positionsCreated += 1;
  }
});

console.log(JSON.stringify({ marketsSeen, marketsCreated, positionsSeen, positionsCreated }));

function toIsoTimestamp(seconds: string) {
  const numeric = Number(seconds);
  if (!Number.isSafeInteger(numeric)) throw new Error(`Market lock timestamp is outside JavaScript range: ${seconds}`);
  return new Date(numeric * 1000).toISOString();
}
