import "dotenv/config";

export type TxlineEnvironment = "mainnet" | "devnet";

const txlineEnv = (process.env.TXLINE_ENV ?? "devnet") as TxlineEnvironment;
const solanaCluster = process.env.SOLANA_CLUSTER ?? "devnet";
const defaultAllowedStakeMints = [
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh"
];

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 8787),
  databasePath: process.env.DATABASE_PATH ?? "./finalwhistle.db",
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
  requireIdempotencyKeys: process.env.REQUIRE_IDEMPOTENCY_KEYS !== "false"
};

export function validateConfig() {
  const errors: string[] = [];
  if (!["mainnet", "devnet"].includes(config.txlineEnv)) errors.push("TXLINE_ENV must be mainnet or devnet");
  if (!Number.isFinite(config.port) || config.port <= 0) errors.push("PORT must be a positive number");
  if (!Number.isInteger(config.txlineFinalityStatKey ?? 0)) {
    errors.push("TXLINE_FINALITY_STAT_KEY must be an integer when provided");
  }
  if (config.allowedStakeMints.length === 0) errors.push("ALLOWED_STAKE_MINTS must include at least one mint");

  if (config.nodeEnv === "production") {
    if (!config.publicOrigin) errors.push("PUBLIC_ORIGIN is required in production");
    if (!config.txlineApiToken) errors.push("TXLINE_API_TOKEN is required in production");
    if (config.txlineFinalityStatKey === undefined) {
      errors.push("TXLINE_FINALITY_STAT_KEY is required in production");
    }
    if (config.solanaCluster !== "mainnet-beta") {
      errors.push("SOLANA_CLUSTER must be mainnet-beta in production");
    }
    if (config.txlineEnv !== "mainnet") {
      errors.push("TXLINE_ENV must be mainnet in production");
    }
    if (config.solanaRpcUrl.includes("api.mainnet-beta.solana.com")) {
      errors.push("SOLANA_RPC_URL must use a paid production RPC endpoint, not public mainnet RPC");
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
