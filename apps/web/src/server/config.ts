import "dotenv/config";
import { PublicKey } from "@solana/web3.js";

export type TxlineEnvironment = "devnet";

// The program accepts only wrapped native SOL. The browser wraps ordinary
// devnet SOL atomically immediately before escrow, so users never need a
// separate token faucet.
export const SUPPORTED_DEVNET_STAKE_MINTS = [
  "So11111111111111111111111111111111111111112"
] as const;

export function isSupportedDevnetStakeMint(mint: string) {
  return (SUPPORTED_DEVNET_STAKE_MINTS as readonly string[]).includes(mint);
}

const txlineEnv = process.env.TXLINE_ENV ?? "devnet";
const solanaCluster = process.env.SOLANA_CLUSTER ?? "devnet";
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
const defaultAllowedStakeMints = [...SUPPORTED_DEVNET_STAKE_MINTS];

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  publicOrigin: process.env.PUBLIC_ORIGIN ?? "",
  txlineEnv,
  txlineGuestBaseUrl:
    process.env.TXLINE_GUEST_BASE_URL ??
    "https://txline-dev.txodds.com",
  txlineApiBaseUrl:
    process.env.TXLINE_API_BASE_URL ??
    "https://txline-dev.txodds.com/api",
  txlineApiToken: process.env.TXLINE_API_TOKEN ?? "",
  solanaCluster,
  solanaRpcUrl:
    process.env.SOLANA_RPC_URL ??
    "https://api.devnet.solana.com",
  programId: process.env.FINAL_WHISTLE_PROGRAM_ID ?? "Hf4KSaGy7EHEaT9jMCo9nKx2uQRz6BEsYS3DrprkDaPw",
  txlineProgramId:
    process.env.TXLINE_PROGRAM_ID ??
    "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
  allowedStakeMints: parseCsv(process.env.ALLOWED_STAKE_MINTS) ?? defaultAllowedStakeMints,
  devnetTokenFaucetUrl: process.env.DEVNET_TOKEN_FAUCET_URL ?? "",
  requireIdempotencyKeys: process.env.REQUIRE_IDEMPOTENCY_KEYS !== "false",
  fixtureCacheMaxAgeMs: Number(process.env.FIXTURE_CACHE_MAX_AGE_MS ?? 120_000),
  fixtureRefreshMinIntervalMs: Number(process.env.FIXTURE_REFRESH_MIN_INTERVAL_MS ?? 30_000),
  upstreamTimeoutMs: Number(process.env.UPSTREAM_TIMEOUT_MS ?? 8_000),
  rateLimitMaxBuckets: Number(process.env.RATE_LIMIT_MAX_BUCKETS ?? 10_000),
  trustProxy: process.env.TRUST_PROXY === "true"
};

export function isProductionRuntime() {
  return config.nodeEnv === "production" && !isBuildPhase;
}

export function validateConfig() {
  const errors: string[] = [];
  if (config.txlineEnv !== "devnet") errors.push("FinalWhistle is devnet-only; set TXLINE_ENV=devnet");
  if (!Number.isFinite(config.port) || config.port <= 0) errors.push("PORT must be a positive number");
  for (const [name, value] of [
    ["FINAL_WHISTLE_PROGRAM_ID", config.programId],
    ["TXLINE_PROGRAM_ID", config.txlineProgramId]
  ] as const) {
    try {
      new PublicKey(value);
    } catch {
      errors.push(`${name} must be a valid Solana public key`);
    }
  }
  if (config.allowedStakeMints.length === 0) errors.push("ALLOWED_STAKE_MINTS must include at least one mint");
  for (const mint of config.allowedStakeMints) {
    try {
      new PublicKey(mint);
    } catch {
      errors.push(`Invalid stake mint: ${mint}`);
      continue;
    }
    if (!isSupportedDevnetStakeMint(mint)) {
      errors.push("ALLOWED_STAKE_MINTS must only contain devnet mints supported by the deployed program");
    }
  }
  if (!Number.isInteger(config.fixtureRefreshMinIntervalMs) || config.fixtureRefreshMinIntervalMs < 5_000) {
    errors.push("FIXTURE_REFRESH_MIN_INTERVAL_MS must be an integer of at least 5000");
  }
  if (!Number.isInteger(config.upstreamTimeoutMs) || config.upstreamTimeoutMs < 1_000) {
    errors.push("UPSTREAM_TIMEOUT_MS must be an integer of at least 1000");
  }
  if (!Number.isInteger(config.rateLimitMaxBuckets) || config.rateLimitMaxBuckets < 100) {
    errors.push("RATE_LIMIT_MAX_BUCKETS must be an integer of at least 100");
  }

  let publicOrigin: URL | undefined;
  if (config.publicOrigin) {
    try {
      publicOrigin = new URL(config.publicOrigin);
    } catch {
      errors.push("PUBLIC_ORIGIN must be an absolute URL");
    }
  }

  if (config.solanaCluster !== "devnet") errors.push("FinalWhistle is devnet-only; set SOLANA_CLUSTER=devnet");

  if (config.devnetTokenFaucetUrl) {
    try {
      const faucetUrl = new URL(config.devnetTokenFaucetUrl);
      if (isProductionRuntime() && faucetUrl.protocol !== "https:") {
        errors.push("DEVNET_TOKEN_FAUCET_URL must use HTTPS in production");
      }
    } catch {
      errors.push("DEVNET_TOKEN_FAUCET_URL must be an absolute URL when provided");
    }
  }

  if (isProductionRuntime()) {
    if (!publicOrigin) errors.push("PUBLIC_ORIGIN is required in production");
    if (publicOrigin && publicOrigin.protocol !== "https:") {
      errors.push("PUBLIC_ORIGIN must use HTTPS in production");
    }
    if (!config.txlineApiToken) errors.push("TXLINE_API_TOKEN is required in production");
    if (!config.databaseUrl) errors.push("DATABASE_URL is required in production");
    if (!process.env.ALLOWED_STAKE_MINTS) errors.push("ALLOWED_STAKE_MINTS must be explicitly set in production");
    if (!process.env.SOLANA_RPC_URL) errors.push("SOLANA_RPC_URL must be explicitly set in production");
    if (!config.requireIdempotencyKeys) errors.push("REQUIRE_IDEMPOTENCY_KEYS must not be disabled in production");
  }

  if (config.databaseUrl) {
    try {
      const databaseUrl = new URL(config.databaseUrl);
      if (databaseUrl.protocol !== "postgres:" && databaseUrl.protocol !== "postgresql:") {
        errors.push("DATABASE_URL must be a PostgreSQL connection URL");
      }
    } catch {
      errors.push("DATABASE_URL must be a valid PostgreSQL connection URL");
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
}

/**
 * Fixture refresh is a read-and-cache path. It must remain available while
 * settlement is intentionally disabled, but it still requires an activated
 * TxLINE token and a database to write the verified feed into.
 */
export function validateFixtureFeedConfig() {
  const errors: string[] = [];

  if (config.txlineEnv !== "devnet") errors.push("FinalWhistle is devnet-only; set TXLINE_ENV=devnet");
  if (config.solanaCluster !== "devnet") errors.push("FinalWhistle is devnet-only; set SOLANA_CLUSTER=devnet");
  if (!config.txlineApiToken) errors.push("TXLINE_API_TOKEN is required to refresh fixtures");
  if (!config.databaseUrl && process.env.FINAL_WHISTLE_DATABASE_MODE !== "memory") {
    errors.push("DATABASE_URL is required to refresh fixtures");
  }
  if (!Number.isInteger(config.fixtureRefreshMinIntervalMs) || config.fixtureRefreshMinIntervalMs < 5_000) {
    errors.push("FIXTURE_REFRESH_MIN_INTERVAL_MS must be an integer of at least 5000");
  }
  if (!Number.isInteger(config.upstreamTimeoutMs) || config.upstreamTimeoutMs < 1_000) {
    errors.push("UPSTREAM_TIMEOUT_MS must be an integer of at least 1000");
  }
  if (!Number.isInteger(config.rateLimitMaxBuckets) || config.rateLimitMaxBuckets < 100) {
    errors.push("RATE_LIMIT_MAX_BUCKETS must be an integer of at least 100");
  }

  if (errors.length > 0) {
    throw new Error(`Invalid fixture feed configuration:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
}

function parseCsv(value?: string) {
  if (!value) return undefined;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
