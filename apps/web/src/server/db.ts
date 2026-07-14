import { Pool } from "pg";
import { config, isProductionRuntime } from "./config";
import type { FixtureSource, MarketRecord, MarketStatus, Predicate, Side } from "./domain";

type Row = Record<string, unknown>;

export type DatabaseExecutor = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Row[]; rowCount?: number | null }>;
};

type DatabaseClient = DatabaseExecutor & { release: () => void };
type DatabasePool = DatabaseExecutor & {
  connect: () => Promise<DatabaseClient>;
  end?: () => Promise<void>;
};

const DEFAULT_READ_LIMIT = 50;
const MAX_READ_LIMIT = 100;

let pool: DatabasePool | undefined;
let schemaPromise: Promise<void> | undefined;
let memoryDatabase: { backup: () => { restore: () => void } } | undefined;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS fixtures (
    id TEXT PRIMARY KEY,
    name TEXT,
    starts_at TEXT,
    participant_1 TEXT,
    participant_2 TEXT,
    raw_json TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS markets (
    id TEXT PRIMARY KEY,
    fixture_id TEXT NOT NULL,
    creator TEXT NOT NULL,
    market_pda TEXT UNIQUE,
    escrow_token_account TEXT,
    token_mint TEXT,
    settlement_verifier TEXT,
    create_tx_sig TEXT UNIQUE,
    join_tx_sig TEXT UNIQUE,
    settle_tx_sig TEXT UNIQUE,
    template TEXT NOT NULL,
    predicate_json TEXT NOT NULL,
    lock_ts TEXT NOT NULL,
    settlement_deadline_ts TEXT,
    status TEXT NOT NULL,
    yes_stake TEXT NOT NULL DEFAULT '0',
    no_stake TEXT NOT NULL DEFAULT '0',
    winning_side TEXT,
    txline_seq TEXT,
    proof_hash TEXT,
    raw_proof_json TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS positions (
    id TEXT PRIMARY KEY,
    market_id TEXT NOT NULL REFERENCES markets(id),
    user_wallet TEXT NOT NULL,
    side TEXT NOT NULL,
    amount TEXT NOT NULL,
    onchain_position TEXT UNIQUE,
    claimed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(market_id, user_wallet)
  )`,
  `CREATE TABLE IF NOT EXISTS wallet_nonces (
    wallet TEXT NOT NULL,
    action TEXT NOT NULL,
    nonce TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    consumed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(wallet, action, nonce)
  )`,
  `CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    route TEXT NOT NULL,
    wallet TEXT,
    request_hash TEXT,
    response_json TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    key_hash TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    reset_at TIMESTAMPTZ NOT NULL
  )`,
  "ALTER TABLE markets ADD COLUMN IF NOT EXISTS settlement_deadline_ts TEXT",
  "CREATE INDEX IF NOT EXISTS markets_fixture_id_idx ON markets(fixture_id)",
  "CREATE INDEX IF NOT EXISTS positions_user_wallet_idx ON positions(user_wallet)",
  "CREATE INDEX IF NOT EXISTS fixtures_updated_at_idx ON fixtures(updated_at)",
  "CREATE INDEX IF NOT EXISTS rate_limit_reset_at_idx ON rate_limit_buckets(reset_at)"
];

/**
 * The app uses a pooled, serverless-safe PostgreSQL connection in every real
 * runtime. `pg-mem` is loaded only for the isolated unit-test process; there
 * is deliberately no SQLite or filesystem fallback for deployments.
 */
export function normalizePooledDatabaseUrl(connectionString: string) {
  const url = new URL(connectionString);
  const sslMode = url.searchParams.get("sslmode");

  // Neon supplies `sslmode=require`. pg currently treats that as
  // verify-full, but its next major version will adopt weaker libpq
  // semantics. Make the intended certificate and hostname verification
  // explicit so the deployment stays secure across that upgrade.
  if (sslMode === "prefer" || sslMode === "require" || sslMode === "verify-ca") {
    url.searchParams.set("sslmode", "verify-full");
  }

  return url.toString();
}

async function getPool(): Promise<DatabasePool> {
  if (pool) return pool;

  if (process.env.FINAL_WHISTLE_DATABASE_MODE === "memory") {
    const { newDb } = await import("pg-mem");
    const memory = newDb({ autoCreateForeignKeyIndices: true });
    memoryDatabase = memory;
    const adapter = memory.adapters.createPg();
    pool = new adapter.Pool() as unknown as DatabasePool;
    return pool;
  }

  if (!config.databaseUrl) {
    throw Object.assign(new Error("DATABASE_URL is required"), { statusCode: 503 });
  }

  pool = new Pool({
    connectionString: normalizePooledDatabaseUrl(config.databaseUrl),
    // A small pool prevents connection storms across Vercel function instances.
    max: 3,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000
  }) as unknown as DatabasePool;
  return pool;
}

export async function ensureDatabaseSchema() {
  // Schema DDL belongs to the deployment step, not a public request. In a
  // serverless runtime, bootstrapping here turns a cold page visit into many
  // cross-region database round trips. Existing production schemas are
  // checked by normal queries and fail closed if they are unavailable.
  if (isProductionRuntime()) return;
  return bootstrapDatabaseSchema();
}

/** Run explicitly by `pnpm --filter @final-whistle/web db:migrate`. */
export async function bootstrapDatabaseSchema() {
  if (!schemaPromise) {
    schemaPromise = initializeSchema().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}

export async function closeDatabasePool() {
  const activePool = pool;
  pool = undefined;
  schemaPromise = undefined;
  await activePool?.end?.();
}

async function initializeSchema() {
  const database = await getPool();
  const client = await database.connect();
  const useAdvisoryLock = process.env.FINAL_WHISTLE_DATABASE_MODE !== "memory";
  try {
    // Multiple cold starts may initialize at once. The advisory lock keeps DDL
    // and any future schema changes serialized without exposing a migration UI.
    if (useAdvisoryLock) await client.query("SELECT pg_advisory_lock($1)", [1_937_056_901]);
    for (const statement of schemaStatements) await client.query(statement);
  } finally {
    if (useAdvisoryLock) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [1_937_056_901]);
      } catch {
        // The connection may have failed before the advisory lock was acquired.
      }
    }
    client.release();
  }
}

export async function databaseHealth() {
  await ensureDatabaseSchema();
  const database = await getPool();
  await database.query("SELECT 1");
}

export async function consumeRateLimitBucket(input: {
  keyHash: string;
  max: number;
  windowMs: number;
}) {
  const database = await executorFor();
  const now = new Date();
  const resetAt = new Date(now.getTime() + input.windowMs);
  const existing = await database.query(
    "SELECT key_hash FROM rate_limit_buckets WHERE key_hash = $1",
    [input.keyHash]
  );
  if (!existing.rows[0]) {
    await database.query("DELETE FROM rate_limit_buckets WHERE reset_at <= $1", [now]);
    const capacity = await database.query("SELECT COUNT(*) AS count FROM rate_limit_buckets");
    if (Number(capacity.rows[0]?.count ?? 0) >= config.rateLimitMaxBuckets) {
      throw Object.assign(new Error("Request capacity reached; try again shortly"), { statusCode: 429 });
    }
  }
  const result = await database.query(
    `INSERT INTO rate_limit_buckets (key_hash, count, reset_at)
     VALUES ($1, 1, $2)
     ON CONFLICT(key_hash) DO UPDATE SET
       count = CASE WHEN rate_limit_buckets.reset_at <= $3 THEN 1 ELSE rate_limit_buckets.count + 1 END,
       reset_at = CASE WHEN rate_limit_buckets.reset_at <= $3
         THEN $2
         ELSE rate_limit_buckets.reset_at END
     RETURNING count, reset_at`,
    [input.keyHash, resetAt, now]
  );
  const count = Number(result.rows[0]?.count ?? input.max + 1);
  if (count > input.max) {
    throw Object.assign(new Error("Too many requests; try again shortly"), { statusCode: 429 });
  }
}

async function executorFor(executor?: DatabaseExecutor) {
  if (executor) return executor;
  await ensureDatabaseSchema();
  return getPool();
}

export async function withTransaction<T>(work: (executor: DatabaseExecutor) => Promise<T>): Promise<T> {
  await ensureDatabaseSchema();
  const database = await getPool();
  const client = await database.connect();
  const memoryBackup = process.env.FINAL_WHISTLE_DATABASE_MODE === "memory" ? memoryDatabase?.backup() : undefined;
  try {
    if (!memoryBackup) await client.query("BEGIN");
    const value = await work(client);
    if (!memoryBackup) await client.query("COMMIT");
    return value;
  } catch (error) {
    if (memoryBackup) memoryBackup.restore();
    else {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The transaction may have failed before it was opened.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function upsertFixture(input: {
  id: string;
  name?: string;
  startsAt?: string;
  participant1?: string;
  participant2?: string;
  raw: unknown;
}, executor?: DatabaseExecutor) {
  const database = await executorFor(executor);
  await database.query(
    `INSERT INTO fixtures (id, name, starts_at, participant_1, participant_2, raw_json, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       name = EXCLUDED.name,
       starts_at = EXCLUDED.starts_at,
       participant_1 = EXCLUDED.participant_1,
       participant_2 = EXCLUDED.participant_2,
       raw_json = EXCLUDED.raw_json,
       updated_at = CURRENT_TIMESTAMP`,
    [
      input.id,
      input.name ?? null,
      input.startsAt ?? null,
      input.participant1 ?? null,
      input.participant2 ?? null,
      JSON.stringify(input.raw)
    ]
  );
}

export async function listFixtures(executor?: DatabaseExecutor) {
  const database = await executorFor(executor);
  const result = await database.query("SELECT * FROM fixtures ORDER BY starts_at DESC NULLS LAST, created_at DESC");
  return result.rows;
}

export type FixtureView = {
  id: string;
  name?: string;
  startsAt?: string;
  participant1?: string;
  participant2?: string;
  source: FixtureSource;
  stale: boolean;
  updatedAt: string;
};

export async function listFixtureViews(
  source: FixtureSource,
  stale: boolean,
  limit = DEFAULT_READ_LIMIT,
  executor?: DatabaseExecutor
): Promise<FixtureView[]> {
  const database = await executorFor(executor);
  const result = await database.query(
    `SELECT id, name, starts_at, participant_1, participant_2, raw_json, updated_at
     FROM fixtures
     ORDER BY starts_at DESC NULLS LAST, created_at DESC
     LIMIT $1`,
    [readLimit(limit)]
  );
  const views = result.rows.map((row) => mapFixtureView(row, source, stale));
  return views;
}

export async function getFixtureView(
  id: string,
  source: FixtureSource = "cache",
  stale = false,
  executor?: DatabaseExecutor
): Promise<FixtureView | undefined> {
  const database = await executorFor(executor);
  const result = await database.query(
    "SELECT id, name, starts_at, participant_1, participant_2, raw_json, updated_at FROM fixtures WHERE id = $1",
    [id]
  );
  const row = result.rows[0];
  return row ? mapFixtureView(row, source, stale) : undefined;
}

export async function newestFixtureUpdatedAt(executor?: DatabaseExecutor): Promise<number | undefined> {
  const database = await executorFor(executor);
  const result = await database.query("SELECT MAX(updated_at) AS updated_at FROM fixtures");
  const value = result.rows[0]?.updated_at;
  const updatedAt = timestampMillis(value);
  return Number.isFinite(updatedAt) ? updatedAt : undefined;
}

export async function fixtureIsFresh(id: string, executor?: DatabaseExecutor) {
  const fixture = await getFixtureView(id, "cache", false, executor);
  return Boolean(fixture && !fixture.stale);
}

export async function consumeWalletNonce(
  input: { wallet: string; action: string; nonce: string; issuedAt: string },
  executor?: DatabaseExecutor
) {
  const database = await executorFor(executor);
  try {
    await database.query(
      `INSERT INTO wallet_nonces (wallet, action, nonce, issued_at)
       VALUES ($1, $2, $3, $4)`,
      [input.wallet, input.action, input.nonce, input.issuedAt]
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new Error("Signed message nonce has already been used");
    throw error;
  }
}

export async function getIdempotencyResponse(
  input: { key: string; route: string; wallet?: string; requestHash: string },
  executor?: DatabaseExecutor
) {
  const database = await executorFor(executor);
  const result = await database.query(
    "SELECT route, wallet, request_hash, response_json FROM idempotency_keys WHERE key = $1",
    [input.key]
  );
  const row = result.rows[0];
  if (!row) return { found: false as const };
  if (
    row.route !== input.route ||
    optionalString(row.wallet) !== input.wallet ||
    row.request_hash !== input.requestHash
  ) {
    throw new Error("Idempotency key is already associated with a different request");
  }
  if (!row.response_json) {
    throw new Error("Prior idempotent request cannot be replayed safely; retry with a new signed request");
  }
  return { found: true as const, response: JSON.parse(String(row.response_json)) as unknown };
}

export async function consumeIdempotencyKey(
  input: { key: string; route: string; wallet?: string; requestHash: string; response: unknown },
  executor?: DatabaseExecutor
) {
  const database = await executorFor(executor);
  try {
    await database.query(
      `INSERT INTO idempotency_keys (key, route, wallet, request_hash, response_json)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.key, input.route, input.wallet ?? null, input.requestHash, JSON.stringify(input.response)]
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new Error("Idempotency key has already been used");
    throw error;
  }
}

export async function insertMarket(input: {
  id: string;
  fixtureId: string;
  creator: string;
  template: string;
  predicate: Predicate;
  lockTs: string;
  settlementDeadlineTs?: string;
  marketPda?: string;
  escrowTokenAccount?: string;
  tokenMint?: string;
  createTxSig?: string;
}, executor?: DatabaseExecutor): Promise<MarketRecord> {
  const database = await executorFor(executor);
  await database.query(
    `INSERT INTO markets (
      id, fixture_id, creator, market_pda, escrow_token_account, token_mint,
      create_tx_sig, template, predicate_json, lock_ts, settlement_deadline_ts, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'OPEN')`,
    [
      input.id,
      input.fixtureId,
      input.creator,
      input.marketPda ?? null,
      input.escrowTokenAccount ?? null,
      input.tokenMint ?? null,
      input.createTxSig ?? null,
      input.template,
      JSON.stringify(input.predicate),
      input.lockTs,
      input.settlementDeadlineTs ?? null
    ]
  );
  return (await getMarket(input.id, database))!;
}

export async function getMarket(id: string, executor?: DatabaseExecutor): Promise<MarketRecord | undefined> {
  const database = await executorFor(executor);
  const result = await database.query("SELECT * FROM markets WHERE id = $1", [id]);
  return result.rows[0] ? mapMarket(result.rows[0]) : undefined;
}

export async function getMarketByPda(marketPda: string, executor?: DatabaseExecutor): Promise<MarketRecord | undefined> {
  const database = await executorFor(executor);
  const result = await database.query("SELECT * FROM markets WHERE market_pda = $1", [marketPda]);
  return result.rows[0] ? mapMarket(result.rows[0]) : undefined;
}

export async function listFixtureMarkets(
  fixtureId: string,
  limit = DEFAULT_READ_LIMIT,
  executor?: DatabaseExecutor
): Promise<MarketRecord[]> {
  const database = await executorFor(executor);
  const result = await database.query(
    "SELECT * FROM markets WHERE fixture_id = $1 ORDER BY created_at DESC LIMIT $2",
    [fixtureId, readLimit(limit)]
  );
  return result.rows.map(mapMarket);
}

export async function listAllMarkets(limit = DEFAULT_READ_LIMIT, executor?: DatabaseExecutor): Promise<MarketRecord[]> {
  const database = await executorFor(executor);
  const result = await database.query("SELECT * FROM markets ORDER BY created_at DESC LIMIT $1", [readLimit(limit)]);
  return result.rows.map(mapMarket);
}

export async function insertPosition(input: {
  id: string;
  marketId: string;
  userWallet: string;
  side: Side;
  amount: string;
  onchainPosition?: string;
}, executor?: DatabaseExecutor) {
  const database = await executorFor(executor);
  await database.query(
    `INSERT INTO positions (id, market_id, user_wallet, side, amount, onchain_position)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.id, input.marketId, input.userWallet, input.side, input.amount, input.onchainPosition ?? null]
  );
}

/**
 * Idempotently mirrors a FinalWhistle Market account into PostgreSQL. This is
 * used by the operator-only reconciler to repair an interrupted browser/API
 * flow; it never fabricates a transaction or settlement proof.
 */
export async function reconcileOnchainMarket(input: {
  marketPda: string;
  fixtureId: string;
  creator: string;
  escrowTokenAccount: string;
  tokenMint: string;
  template: MarketRecord["template"];
  predicate: Predicate;
  lockTs: string;
  settlementDeadlineTs?: string;
  status: MarketStatus;
  yesStake: string;
  noStake: string;
  winningSide?: Side;
  txlineSeq: string;
  proofHash: string;
}, executor?: DatabaseExecutor): Promise<MarketRecord> {
  const database = await executorFor(executor);
  const existing = await getMarketByPda(input.marketPda, database);
  const id = existing?.id ?? `onchain:${input.marketPda}`;
  if (!existing) {
    await database.query(
      `INSERT INTO markets (
        id, fixture_id, creator, market_pda, escrow_token_account, token_mint,
        template, predicate_json, lock_ts, settlement_deadline_ts, status, yes_stake, no_stake,
        winning_side, txline_seq, proof_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        id,
        input.fixtureId,
        input.creator,
        input.marketPda,
        input.escrowTokenAccount,
        input.tokenMint,
        input.template,
        JSON.stringify(input.predicate),
        input.lockTs,
        input.settlementDeadlineTs ?? null,
        input.status,
        input.yesStake,
        input.noStake,
        input.winningSide ?? null,
        input.txlineSeq,
        input.proofHash
      ]
    );
  } else {
    await database.query(
      `UPDATE markets SET
        fixture_id = $1, creator = $2, escrow_token_account = $3, token_mint = $4,
        template = $5, predicate_json = $6, lock_ts = $7, settlement_deadline_ts = $8, status = $9, yes_stake = $10, no_stake = $11,
        winning_side = $12, txline_seq = $13, proof_hash = $14, updated_at = CURRENT_TIMESTAMP
       WHERE market_pda = $15`,
      [
        input.fixtureId,
        input.creator,
        input.escrowTokenAccount,
        input.tokenMint,
        input.template,
        JSON.stringify(input.predicate),
        input.lockTs,
        input.settlementDeadlineTs ?? null,
        input.status,
        input.yesStake,
        input.noStake,
        input.winningSide ?? null,
        input.txlineSeq,
        input.proofHash,
        input.marketPda
      ]
    );
  }
  return (await getMarket(id, database))!;
}

export async function reconcileOnchainPosition(input: {
  marketId: string;
  userWallet: string;
  side: Side;
  amount: string;
  onchainPosition: string;
  claimed: boolean;
}, executor?: DatabaseExecutor): Promise<PositionRecord | undefined> {
  const database = await executorFor(executor);
  await database.query(
    `INSERT INTO positions (id, market_id, user_wallet, side, amount, onchain_position, claimed)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(market_id, user_wallet) DO UPDATE SET
       side = EXCLUDED.side,
       amount = EXCLUDED.amount,
       onchain_position = EXCLUDED.onchain_position,
       claimed = EXCLUDED.claimed`,
    [
      `onchain:${input.onchainPosition}`,
      input.marketId,
      input.userWallet,
      input.side,
      input.amount,
      input.onchainPosition,
      input.claimed
    ]
  );
  return getPositionForWallet({ marketId: input.marketId, userWallet: input.userWallet }, database);
}

export type PositionRecord = {
  id: string;
  marketId: string;
  userWallet: string;
  side: Side;
  amount: string;
  onchainPosition?: string;
  claimed: boolean;
  createdAt: string;
};

export async function getPositionForWallet(
  input: { marketId: string; userWallet: string },
  executor?: DatabaseExecutor
): Promise<PositionRecord | undefined> {
  const database = await executorFor(executor);
  const result = await database.query(
    "SELECT * FROM positions WHERE market_id = $1 AND user_wallet = $2",
    [input.marketId, input.userWallet]
  );
  return result.rows[0] ? mapPosition(result.rows[0]) : undefined;
}

export async function listWalletPositions(userWallet: string, limit = DEFAULT_READ_LIMIT, executor?: DatabaseExecutor) {
  const database = await executorFor(executor);
  const result = await database.query(
    `SELECT
      positions.*,
      markets.fixture_id,
      markets.template,
      markets.status,
      markets.winning_side,
      markets.yes_stake,
      markets.no_stake,
      markets.proof_hash,
      markets.settle_tx_sig
    FROM positions
    JOIN markets ON markets.id = positions.market_id
    WHERE positions.user_wallet = $1
    ORDER BY positions.created_at DESC
    LIMIT $2`,
    [userWallet, readLimit(limit)]
  );
  return result.rows.map((record) => ({
    position: mapPosition(record),
    market: {
      id: String(record.market_id),
      fixtureId: String(record.fixture_id),
      template: String(record.template),
      status: String(record.status),
      winningSide: optionalString(record.winning_side),
      yesStake: String(record.yes_stake),
      noStake: String(record.no_stake),
      proofHash: optionalString(record.proof_hash),
      settleTxSig: optionalString(record.settle_tx_sig)
    }
  }));
}

export async function recordPositionClaimed(
  input: { marketId: string; userWallet: string },
  executor?: DatabaseExecutor
) {
  const database = await executorFor(executor);
  await database.query("UPDATE positions SET claimed = TRUE WHERE market_id = $1 AND user_wallet = $2", [input.marketId, input.userWallet]);
}

export async function recordJoin(
  marketId: string,
  side: Side,
  amount: string,
  status: MarketStatus,
  joinTxSig: string,
  executor?: DatabaseExecutor
) {
  const database = await executorFor(executor);
  const column = side === "YES" ? "yes_stake" : "no_stake";
  await database.query(
    `UPDATE markets SET ${column} = $1, status = $2, join_tx_sig = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
    [amount, status, joinTxSig, marketId]
  );
}

export async function recordSettlement(input: {
  marketId: string;
  status: MarketStatus;
  winningSide?: Side;
  txlineSeq?: string;
  proofHash: string;
  settleTxSig: string;
  rawProof: unknown;
}, executor?: DatabaseExecutor) {
  const database = await executorFor(executor);
  await database.query(
    `UPDATE markets SET
      status = $1,
      winning_side = $2,
      txline_seq = $3,
      proof_hash = $4,
      settle_tx_sig = $5,
      raw_proof_json = $6,
      updated_at = CURRENT_TIMESTAMP
     WHERE id = $7`,
    [
      input.status,
      input.winningSide ?? null,
      input.txlineSeq ?? null,
      input.proofHash,
      input.settleTxSig,
      JSON.stringify(input.rawProof),
      input.marketId
    ]
  );
}

export async function recordExpiredCancellation(input: {
  marketId: string;
  cancelTxSig: string;
  txlineSeq?: string;
  proofHash?: string;
}, executor?: DatabaseExecutor) {
  const database = await executorFor(executor);
  await database.query(
    `UPDATE markets SET
      status = 'CANCELLED',
      winning_side = NULL,
      txline_seq = $1,
      proof_hash = $2,
      settle_tx_sig = $3,
      raw_proof_json = $4,
      updated_at = CURRENT_TIMESTAMP
     WHERE id = $5`,
    [
      input.txlineSeq ?? null,
      input.proofHash ?? "expired_on_chain",
      input.cancelTxSig,
      JSON.stringify({ cancelTxSig: input.cancelTxSig, reason: "expired_on_chain" }),
      input.marketId
    ]
  );
}

function mapMarket(row: Row): MarketRecord {
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
    settlementDeadlineTs: optionalString(row.settlement_deadline_ts),
    status: row.status as MarketRecord["status"],
    yesStake: String(row.yes_stake),
    noStake: String(row.no_stake),
    winningSide: optionalString(row.winning_side) as Side | undefined,
    txlineSeq: optionalString(row.txline_seq),
    proofHash: optionalString(row.proof_hash),
    rawProof: row.raw_proof_json ? JSON.parse(String(row.raw_proof_json)) : undefined,
    createdAt: timestampString(row.created_at),
    updatedAt: timestampString(row.updated_at)
  };
}

function mapFixtureView(row: Row, source: FixtureSource, stale: boolean): FixtureView {
  return {
    id: String(row.id),
    name: optionalString(row.name),
    startsAt: optionalString(row.starts_at),
    participant1: optionalString(row.participant_1),
    participant2: optionalString(row.participant_2),
    source,
    stale: stale || !isFreshTimestamp(row.updated_at),
    updatedAt: timestampString(row.updated_at)
  };
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function mapPosition(row: Row): PositionRecord {
  return {
    id: String(row.id),
    marketId: String(row.market_id),
    userWallet: String(row.user_wallet),
    side: row.side as Side,
    amount: String(row.amount),
    onchainPosition: optionalString(row.onchain_position),
    claimed: row.claimed === true || row.claimed === 1 || row.claimed === "1" || row.claimed === "t",
    createdAt: timestampString(row.created_at)
  };
}

function isFreshTimestamp(value: unknown) {
  const updatedAt = timestampMillis(value);
  return Number.isFinite(updatedAt) && Date.now() - updatedAt <= config.fixtureCacheMaxAgeMs;
}

function timestampMillis(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== "string") return Number.NaN;
  return Date.parse(value);
}

function timestampString(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readLimit(value: number) {
  if (!Number.isSafeInteger(value)) return DEFAULT_READ_LIMIT;
  return Math.min(Math.max(value, 1), MAX_READ_LIMIT);
}

function isUniqueViolation(error: unknown) {
  return typeof (error as { code?: unknown })?.code === "string" && (error as { code: string }).code === "23505";
}
