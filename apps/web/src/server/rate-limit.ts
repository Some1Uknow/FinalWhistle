import { config } from "./config";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
let streamClients = 0;
const fixtureStreams = new Map<string, number>();
const ipStreams = new Map<string, number>();
let bucketChecks = 0;

export function clientIp(request: Request) {
  // Forwarded client IP headers are user-controlled unless the deployment is
  // explicitly configured behind a trusted proxy.
  if (!config.trustProxy) return "direct";
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
}

export function requireRateLimit(input: {
  scope: "fixtures" | "write" | "proof" | "stream";
  request: Request;
  wallet?: string;
}) {
  const limit =
    input.scope === "fixtures"
      ? { max: 240, windowMs: 60_000 }
      : input.scope === "write"
        ? { max: 20, windowMs: 60_000 }
        : input.scope === "proof"
          ? { max: 8, windowMs: 60_000 }
          : { max: 20, windowMs: 60_000 };
  const key = `${input.scope}:${input.wallet ?? "anon"}:${clientIp(input.request)}`;
  const now = Date.now();
  sweepExpiredBuckets(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= config.rateLimitMaxBuckets) {
      throw Object.assign(new Error("Rate limiter is at capacity; retry shortly"), { statusCode: 429 });
    }
    buckets.set(key, { count: 1, resetAt: now + limit.windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit.max) {
    throw Object.assign(new Error("Rate limit exceeded"), { statusCode: 429 });
  }
}

export function enterScoreStream(fixtureId: string, ip: string) {
  if (streamClients >= config.streamMaxClients) {
    throw Object.assign(new Error("Too many score stream clients"), { statusCode: 429 });
  }
  const fixtureKey = fixtureId ?? "*";
  const fixtureCount = fixtureStreams.get(fixtureKey) ?? 0;
  if (fixtureCount >= config.streamMaxFixtureClients) {
    throw Object.assign(new Error("Too many score streams for fixture"), { statusCode: 429 });
  }
  const ipCount = ipStreams.get(ip) ?? 0;
  if (ipCount >= config.streamMaxIpClients) {
    throw Object.assign(new Error("Too many score streams for this client"), { statusCode: 429 });
  }
  streamClients += 1;
  fixtureStreams.set(fixtureKey, fixtureCount + 1);
  ipStreams.set(ip, ipCount + 1);
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    streamClients = Math.max(0, streamClients - 1);
    const next = Math.max(0, (fixtureStreams.get(fixtureKey) ?? 1) - 1);
    if (next === 0) fixtureStreams.delete(fixtureKey);
    else fixtureStreams.set(fixtureKey, next);
    const nextIpCount = Math.max(0, (ipStreams.get(ip) ?? 1) - 1);
    if (nextIpCount === 0) ipStreams.delete(ip);
    else ipStreams.set(ip, nextIpCount);
  };
}

function sweepExpiredBuckets(now: number) {
  bucketChecks += 1;
  if (bucketChecks % 128 !== 0 && buckets.size < config.rateLimitMaxBuckets) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}
