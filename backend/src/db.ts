import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import type { MarketRecord, MarketStatus, Predicate, Side } from "./domain.js";

export const db = new DatabaseSync(config.databasePath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS fixtures (
  id TEXT PRIMARY KEY,
  name TEXT,
  starts_at TEXT,
  participant_1 TEXT,
  participant_2 TEXT,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS markets (
  id TEXT PRIMARY KEY,
  fixture_id TEXT NOT NULL,
  creator TEXT NOT NULL,
  market_pda TEXT,
  escrow_token_account TEXT,
  token_mint TEXT,
  settlement_verifier TEXT,
  create_tx_sig TEXT,
  join_tx_sig TEXT,
  settle_tx_sig TEXT,
  template TEXT NOT NULL,
  predicate_json TEXT NOT NULL,
  lock_ts TEXT NOT NULL,
  status TEXT NOT NULL,
  yes_stake TEXT NOT NULL DEFAULT '0',
  no_stake TEXT NOT NULL DEFAULT '0',
  winning_side TEXT,
  txline_seq TEXT,
  proof_hash TEXT,
  raw_proof_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES markets(id),
  user_wallet TEXT NOT NULL,
  side TEXT NOT NULL,
  amount TEXT NOT NULL,
  onchain_position TEXT,
  claimed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(market_id, user_wallet)
);

CREATE TABLE IF NOT EXISTS wallet_nonces (
  wallet TEXT NOT NULL,
  action TEXT NOT NULL,
  nonce TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  consumed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(wallet, action, nonce)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  route TEXT NOT NULL,
  wallet TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

for (const statement of [
  "ALTER TABLE markets ADD COLUMN settlement_verifier TEXT",
  "ALTER TABLE markets ADD COLUMN create_tx_sig TEXT",
  "ALTER TABLE markets ADD COLUMN join_tx_sig TEXT",
  "ALTER TABLE markets ADD COLUMN settle_tx_sig TEXT"
]) {
  try {
    db.exec(statement);
  } catch {
    // Column already exists.
  }
}

for (const statement of [
  "CREATE UNIQUE INDEX IF NOT EXISTS markets_create_tx_sig_unique ON markets(create_tx_sig) WHERE create_tx_sig IS NOT NULL",
  "CREATE UNIQUE INDEX IF NOT EXISTS markets_join_tx_sig_unique ON markets(join_tx_sig) WHERE join_tx_sig IS NOT NULL",
  "CREATE UNIQUE INDEX IF NOT EXISTS markets_settle_tx_sig_unique ON markets(settle_tx_sig) WHERE settle_tx_sig IS NOT NULL",
  "CREATE UNIQUE INDEX IF NOT EXISTS positions_onchain_position_unique ON positions(onchain_position) WHERE onchain_position IS NOT NULL"
]) {
  db.exec(statement);
}

export function upsertFixture(fixture: {
  id: string;
  name?: string;
  startsAt?: string;
  participant1?: string;
  participant2?: string;
  raw: unknown;
}) {
  db.prepare(
    `INSERT INTO fixtures (id, name, starts_at, participant_1, participant_2, raw_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       starts_at = excluded.starts_at,
       participant_1 = excluded.participant_1,
       participant_2 = excluded.participant_2,
       raw_json = excluded.raw_json,
       updated_at = CURRENT_TIMESTAMP`
  ).run(
    fixture.id,
    fixture.name ?? null,
    fixture.startsAt ?? null,
    fixture.participant1 ?? null,
    fixture.participant2 ?? null,
    JSON.stringify(fixture.raw)
  );
}

export function listFixtures() {
  return db.prepare("SELECT * FROM fixtures ORDER BY starts_at DESC, created_at DESC").all();
}

export function consumeWalletNonce(input: { wallet: string; action: string; nonce: string; issuedAt: string }) {
  try {
    db.prepare(
      `INSERT INTO wallet_nonces (wallet, action, nonce, issued_at)
       VALUES (?, ?, ?, ?)`
    ).run(input.wallet, input.action, input.nonce, input.issuedAt);
  } catch {
    throw new Error("Signed message nonce has already been used");
  }
}

export function consumeIdempotencyKey(input: { key: string; route: string; wallet?: string }) {
  try {
    db.prepare(
      `INSERT INTO idempotency_keys (key, route, wallet)
       VALUES (?, ?, ?)`
    ).run(input.key, input.route, input.wallet ?? null);
  } catch {
    throw new Error("Idempotency key has already been used");
  }
}

export function insertMarket(input: {
  id: string;
  fixtureId: string;
  creator: string;
  template: string;
  predicate: Predicate;
  lockTs: string;
  marketPda?: string;
  escrowTokenAccount?: string;
  tokenMint?: string;
  createTxSig?: string;
}): MarketRecord {
  db.prepare(
    `INSERT INTO markets (
      id, fixture_id, creator, market_pda, escrow_token_account, token_mint,
      create_tx_sig,
      template, predicate_json, lock_ts, status
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN'
    )`
  ).run(
    input.id,
    input.fixtureId,
    input.creator,
    input.marketPda ?? null,
    input.escrowTokenAccount ?? null,
    input.tokenMint ?? null,
    input.createTxSig ?? null,
    input.template,
    JSON.stringify(input.predicate),
    input.lockTs
  );
  return getMarket(input.id)!;
}

export function getMarket(id: string): MarketRecord | undefined {
  const row = db.prepare("SELECT * FROM markets WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapMarket(row) : undefined;
}

export function listFixtureMarkets(fixtureId: string): MarketRecord[] {
  return db
    .prepare("SELECT * FROM markets WHERE fixture_id = ? ORDER BY created_at DESC")
    .all(fixtureId)
    .map((row) => mapMarket(row as Record<string, unknown>));
}

export function insertPosition(input: {
  id: string;
  marketId: string;
  userWallet: string;
  side: Side;
  amount: string;
  onchainPosition?: string;
}) {
  db.prepare(
    `INSERT INTO positions (id, market_id, user_wallet, side, amount, onchain_position)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(input.id, input.marketId, input.userWallet, input.side, input.amount, input.onchainPosition ?? null);
}

export function recordJoin(marketId: string, side: Side, amount: string, status: MarketStatus, joinTxSig: string) {
  const column = side === "YES" ? "yes_stake" : "no_stake";
  db.prepare(`UPDATE markets SET ${column} = ?, status = ?, join_tx_sig = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
    amount,
    status,
    joinTxSig,
    marketId
  );
}

export function recordSettlement(input: {
  marketId: string;
  status: MarketStatus;
  winningSide?: Side;
  txlineSeq?: string;
  proofHash: string;
  settleTxSig: string;
  rawProof: unknown;
}) {
  db.prepare(
    `UPDATE markets SET
      status = ?,
      winning_side = ?,
      txline_seq = ?,
      proof_hash = ?,
      settle_tx_sig = ?,
      raw_proof_json = ?,
      updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    input.status,
    input.winningSide ?? null,
    input.txlineSeq ?? null,
    input.proofHash,
    input.settleTxSig,
    JSON.stringify(input.rawProof),
    input.marketId
  );
}

export function recordExpiredCancellation(input: {
  marketId: string;
  cancelTxSig: string;
  txlineSeq?: string;
  proofHash?: string;
}) {
  db.prepare(
    `UPDATE markets SET
      status = 'CANCELLED',
      winning_side = NULL,
      txline_seq = ?,
      proof_hash = ?,
      settle_tx_sig = ?,
      raw_proof_json = ?,
      updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    input.txlineSeq ?? null,
    input.proofHash ?? "expired_on_chain",
    input.cancelTxSig,
    JSON.stringify({ cancelTxSig: input.cancelTxSig, reason: "expired_on_chain" }),
    input.marketId
  );
}

function mapMarket(row: Record<string, unknown>): MarketRecord {
  return {
    id: String(row.id),
    fixtureId: String(row.fixture_id),
    creator: String(row.creator),
    marketPda: optionalString(row.market_pda),
    escrowTokenAccount: optionalString(row.escrow_token_account),
    tokenMint: optionalString(row.token_mint),
    createTxSig: optionalString(row.create_tx_sig),
    joinTxSig: optionalString(row.join_tx_sig),
    settleTxSig: optionalString(row.settle_tx_sig),
    template: row.template as MarketRecord["template"],
    predicate: JSON.parse(String(row.predicate_json)) as Predicate,
    lockTs: String(row.lock_ts),
    status: row.status as MarketRecord["status"],
    yesStake: String(row.yes_stake),
    noStake: String(row.no_stake),
    winningSide: row.winning_side as Side | undefined,
    txlineSeq: optionalString(row.txline_seq),
    proofHash: optionalString(row.proof_hash),
    rawProof: row.raw_proof_json ? JSON.parse(String(row.raw_proof_json)) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
