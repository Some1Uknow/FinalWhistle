export const DEFAULT_MARKET_CLOSE_BUFFER_MINUTES = 30;
export const MIN_MARKET_CLOSE_BUFFER_MINUTES = 5;
export const MAX_MARKET_CLOSE_BUFFER_MINUTES = 1_440;
export const MAX_MARKET_OPEN_MINUTES = 1_440;

const MINUTE_MS = 60_000;
const MAX_MARKET_OPEN_MS = MAX_MARKET_OPEN_MINUTES * MINUTE_MS;

export type MarketTiming =
  | { status: "ready"; lockTimeMs: number }
  | { status: "too_early"; lockTimeMs: number; availableAtMs: number }
  | { status: "close_passed"; lockTimeMs: number }
  | { status: "betting_closed" }
  | { status: "fixture_started" }
  | { status: "invalid_buffer" }
  | { status: "invalid_kickoff" };

export function resolveMarketTiming(input: {
  kickoffMs: number;
  bufferMinutes: number;
  nowMs?: number;
}): MarketTiming {
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(input.kickoffMs)) return { status: "invalid_kickoff" };
  if (
    !Number.isInteger(input.bufferMinutes) ||
    input.bufferMinutes < MIN_MARKET_CLOSE_BUFFER_MINUTES ||
    input.bufferMinutes > MAX_MARKET_CLOSE_BUFFER_MINUTES
  ) {
    return { status: "invalid_buffer" };
  }
  if (input.kickoffMs <= nowMs) return { status: "fixture_started" };
  if (input.kickoffMs - nowMs <= MIN_MARKET_CLOSE_BUFFER_MINUTES * MINUTE_MS) {
    return { status: "betting_closed" };
  }

  // Solana timestamps are whole seconds, so the preview and instruction must
  // resolve to the same value even if an upstream kickoff includes milliseconds.
  const lockTimeMs = Math.floor(
    (input.kickoffMs - input.bufferMinutes * MINUTE_MS) / 1_000
  ) * 1_000;
  if (lockTimeMs <= nowMs) return { status: "close_passed", lockTimeMs };

  const availableAtMs = lockTimeMs - MAX_MARKET_OPEN_MS;
  if (nowMs < availableAtMs) {
    return { status: "too_early", lockTimeMs, availableAtMs };
  }
  return { status: "ready", lockTimeMs };
}

export type MarketLockValidation =
  | { ok: true; bufferMinutes: number }
  | {
      ok: false;
      reason:
        | "invalid_timestamp"
        | "fixture_started"
        | "lock_not_future"
        | "lock_not_before_kickoff"
        | "invalid_buffer"
        | "market_open_too_long";
    };

export function validateRequestedMarketLock(input: {
  kickoffMs: number;
  lockTimeMs: number;
  expectedBufferMinutes?: number;
  nowMs?: number;
}): MarketLockValidation {
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(input.kickoffMs) || !Number.isFinite(input.lockTimeMs)) {
    return { ok: false, reason: "invalid_timestamp" };
  }
  if (input.kickoffMs <= nowMs) return { ok: false, reason: "fixture_started" };
  if (input.lockTimeMs <= nowMs) return { ok: false, reason: "lock_not_future" };

  const bufferMs = input.kickoffMs - input.lockTimeMs;
  if (bufferMs <= 0) return { ok: false, reason: "lock_not_before_kickoff" };
  if (input.lockTimeMs - nowMs > MAX_MARKET_OPEN_MS) {
    return { ok: false, reason: "market_open_too_long" };
  }
  if (input.expectedBufferMinutes !== undefined) {
    if (
      !Number.isInteger(input.expectedBufferMinutes) ||
      input.expectedBufferMinutes < MIN_MARKET_CLOSE_BUFFER_MINUTES ||
      input.expectedBufferMinutes > MAX_MARKET_CLOSE_BUFFER_MINUTES ||
      bufferMs !== input.expectedBufferMinutes * MINUTE_MS
    ) {
      return { ok: false, reason: "invalid_buffer" };
    }
  }
  return { ok: true, bufferMinutes: bufferMs / MINUTE_MS };
}
