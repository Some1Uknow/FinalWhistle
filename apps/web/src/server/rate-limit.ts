import { config } from "./config";
import { createHash } from "node:crypto";
import { consumeRateLimitBucket } from "./db";

export function clientIp(request: Request) {
  // Forwarded client IP headers are user-controlled unless the deployment is
  // explicitly configured behind a trusted proxy.
  if (!config.trustProxy) return "direct";
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
}

export async function requireRateLimit(input: {
  scope: "fixtures" | "write" | "proof";
  request: Request;
  wallet?: string;
}) {
  const limit =
    input.scope === "fixtures"
      ? { max: 240, windowMs: 60_000 }
      : input.scope === "write"
        ? { max: 20, windowMs: 60_000 }
        : { max: 8, windowMs: 60_000 };
  // This check runs before the wallet signature is verified. A wallet value in
  // an unauthenticated request is attacker-controlled, so using it as the
  // only bucket key would let one client create unbounded buckets by changing
  // that field. Keep the first-line limit IP-scoped.
  const identity = `${input.scope}:ip:${clientIp(input.request)}`;
  const keyHash = createHash("sha256").update(identity).digest("hex");
  await consumeRateLimitBucket({ keyHash, max: limit.max, windowMs: limit.windowMs });
}
