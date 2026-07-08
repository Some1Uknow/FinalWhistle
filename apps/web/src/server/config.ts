import "dotenv/config";
import { PublicKey } from "@solana/web3.js";

export type TxlineEnvironment = "mainnet" | "devnet";

const txlineEnv = (process.env.TXLINE_ENV ?? "devnet") as TxlineEnvironment;
const solanaCluster = process.env.SOLANA_CLUSTER ?? "devnet";
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
const defaultAllowedStakeMints = [
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  "ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh"
];

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  publicOrigin: process.env.PUBLIC_ORIGIN ?? "",
  txlineEnv,
  txlineGuestBaseUrl:
    process.env.TXLINE_GUEST_BASE_URL ??
    (txlineEnv === "mainnet" ? "https://txline.txodds.com" : "https://txline-dev.txodds.com"),
  txlineApiBaseUrl:
    process.env.TXLINE_API_BASE_URL ??
    (txlineEnv === "mainnet" ? "https://txline.txodds.com/api" : "https://txline-dev.txodds.com/api"),
  txlineApiToken: process.env.TXLINE_API_TOKEN ?? "",
  solanaCluster,
  solanaRpcUrl:
    process.env.SOLANA_RPC_URL ??
    (solanaCluster === "mainnet-beta"
      ? "https://api.mainnet-beta.solana.com"
      : "https://api.devnet.solana.com"),
  programId: process.env.FINAL_WHISTLE_PROGRAM_ID ?? "DaW6BCZ4AKUNwyEaoqik6xbrx9JcuqRbfhwzDstDEJWF",
  txlineProgramId:
    process.env.TXLINE_PROGRAM_ID ??
    (txlineEnv === "mainnet"
      ? "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA"
      : "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"),
  txlineFinalityStatKey: process.env.TXLINE_FINALITY_STAT_KEY ? Number(process.env.TXLINE_FINALITY_STAT_KEY) : undefined,
  allowedStakeMints: parseCsv(process.env.ALLOWED_STAKE_MINTS) ?? defaultAllowedStakeMints,
  betaReplayFixtureIds: parseCsv(process.env.BETA_REPLAY_FIXTURE_IDS) ?? [],
  devnetTokenFaucetUrl: process.env.DEVNET_TOKEN_FAUCET_URL ?? "",
  requireIdempotencyKeys: process.env.REQUIRE_IDEMPOTENCY_KEYS !== "false",
  fixtureCacheMaxAgeMs: Number(process.env.FIXTURE_CACHE_MAX_AGE_MS ?? 120_000),
  streamMaxClients: Number(process.env.STREAM_MAX_CLIENTS ?? 25),
  streamMaxFixtureClients: Number(process.env.STREAM_MAX_FIXTURE_CLIENTS ?? 5),
  streamMaxIpClients: Number(process.env.STREAM_MAX_IP_CLIENTS ?? 3),
  rateLimitMaxBuckets: Number(process.env.RATE_LIMIT_MAX_BUCKETS ?? 10_000),
  trustProxy: process.env.TRUST_PROXY === "true"
};

export function isProductionRuntime() {
  return config.nodeEnv === "production" && !isBuildPhase;
}

export function validateConfig() {
  const errors: string[] = [];
  if (!["mainnet", "devnet"].includes(config.txlineEnv)) errors.push("TXLINE_ENV must be mainnet or devnet");
  if (!Number.isFinite(config.port) || config.port <= 0) errors.push("PORT must be a positive number");
  if (!Number.isInteger(config.txlineFinalityStatKey ?? 0)) {
    errors.push("TXLINE_FINALITY_STAT_KEY must be an integer when provided");
  }
  if (config.txlineFinalityStatKey !== undefined && config.txlineFinalityStatKey <= 0) {
    errors.push("TXLINE_FINALITY_STAT_KEY must be a positive integer");
  }
  if (config.txlineFinalityStatKey !== undefined && config.txlineFinalityStatKey > 0xffff_ffff) {
    errors.push("TXLINE_FINALITY_STAT_KEY must fit in an unsigned 32-bit integer");
  }
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
    }
  }
  if (!Number.isInteger(config.streamMaxClients) || config.streamMaxClients <= 0) {
    errors.push("STREAM_MAX_CLIENTS must be a positive integer");
  }
  if (!Number.isInteger(config.streamMaxFixtureClients) || config.streamMaxFixtureClients <= 0) {
    errors.push("STREAM_MAX_FIXTURE_CLIENTS must be a positive integer");
  }
  if (!Number.isInteger(config.streamMaxIpClients) || config.streamMaxIpClients <= 0) {
    errors.push("STREAM_MAX_IP_CLIENTS must be a positive integer");
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

  if (isProductionRuntime() && config.solanaCluster !== "devnet") {
    errors.push("Public beta deployment is devnet-only; set SOLANA_CLUSTER=devnet");
  }

  if (isProductionRuntime()) {
    if (!publicOrigin) errors.push("PUBLIC_ORIGIN is required in production");
    if (publicOrigin && publicOrigin.protocol !== "https:") {
      errors.push("PUBLIC_ORIGIN must use HTTPS in production");
    }
    if (!config.txlineApiToken) errors.push("TXLINE_API_TOKEN is required in production");
    if (!config.databaseUrl) errors.push("DATABASE_URL is required in production");
    if (!config.txlineFinalityStatKey) errors.push("TXLINE_FINALITY_STAT_KEY is required in production");
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

  const clusterTxlineMismatch =
    (config.solanaCluster === "mainnet-beta" && config.txlineEnv !== "mainnet") ||
    (config.solanaCluster !== "mainnet-beta" && config.txlineEnv !== "devnet");
  if (clusterTxlineMismatch) {
    errors.push("SOLANA_CLUSTER and TXLINE_ENV must target the same network class");
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
}

function parseCsv(value?: string) {
  if (!value) return undefined;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
