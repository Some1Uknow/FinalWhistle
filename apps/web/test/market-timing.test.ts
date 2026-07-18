import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_MARKET_CLOSE_BUFFER_MINUTES,
  MIN_MARKET_CLOSE_BUFFER_MINUTES,
  resolveMarketTiming,
  validateRequestedMarketLock
} from "../src/lib/market-timing";

const minute = 60_000;
const hour = 60 * minute;

test("resolves the market close time from kickoff instead of creation time", () => {
  const kickoffMs = Date.parse("2026-07-19T19:00:00.000Z");
  const timing = resolveMarketTiming({
    kickoffMs,
    bufferMinutes: 30,
    nowMs: Date.parse("2026-07-18T19:00:00.000Z")
  });

  assert.deepEqual(timing, {
    status: "ready",
    lockTimeMs: Date.parse("2026-07-19T18:30:00.000Z")
  });
});

test("reports when the desired close time is outside the 24-hour creation window", () => {
  const kickoffMs = Date.parse("2026-07-19T19:00:00.000Z");
  const timing = resolveMarketTiming({
    kickoffMs,
    bufferMinutes: 30,
    nowMs: Date.parse("2026-07-18T07:36:00.000Z")
  });

  assert.deepEqual(timing, {
    status: "too_early",
    lockTimeMs: Date.parse("2026-07-19T18:30:00.000Z"),
    availableAtMs: Date.parse("2026-07-18T18:30:00.000Z")
  });
});

test("accepts the minimum and maximum kickoff buffers", () => {
  const nowMs = Date.parse("2026-07-18T00:00:00.000Z");

  assert.equal(resolveMarketTiming({
    kickoffMs: nowMs + 2 * hour,
    bufferMinutes: MIN_MARKET_CLOSE_BUFFER_MINUTES,
    nowMs
  }).status, "ready");
  assert.equal(resolveMarketTiming({
    kickoffMs: nowMs + 30 * hour,
    bufferMinutes: MAX_MARKET_CLOSE_BUFFER_MINUTES,
    nowMs
  }).status, "ready");
});

test("rejects invalid buffers and close times that have passed", () => {
  const nowMs = Date.parse("2026-07-18T00:00:00.000Z");

  assert.equal(resolveMarketTiming({ kickoffMs: nowMs + hour, bufferMinutes: 4, nowMs }).status, "invalid_buffer");
  assert.equal(resolveMarketTiming({ kickoffMs: nowMs + hour, bufferMinutes: 1_441, nowMs }).status, "invalid_buffer");
  assert.equal(resolveMarketTiming({ kickoffMs: nowMs + hour, bufferMinutes: 5.5, nowMs }).status, "invalid_buffer");
  assert.equal(resolveMarketTiming({ kickoffMs: nowMs + 20 * minute, bufferMinutes: 30, nowMs }).status, "close_passed");
  assert.equal(resolveMarketTiming({ kickoffMs: nowMs + 5 * minute, bufferMinutes: 5, nowMs }).status, "betting_closed");
  assert.equal(resolveMarketTiming({ kickoffMs: nowMs, bufferMinutes: 30, nowMs }).status, "fixture_started");
  assert.equal(resolveMarketTiming({ kickoffMs: Number.NaN, bufferMinutes: 30, nowMs }).status, "invalid_kickoff");
});

test("server lock validation enforces kickoff buffer and on-chain duration", () => {
  const nowMs = Date.parse("2026-07-18T00:00:00.000Z");

  assert.deepEqual(validateRequestedMarketLock({
    kickoffMs: nowMs + 24 * hour + 30 * minute,
    lockTimeMs: nowMs + 24 * hour,
    expectedBufferMinutes: 30,
    nowMs
  }), { ok: true, bufferMinutes: 30 });
  assert.deepEqual(validateRequestedMarketLock({
    kickoffMs: nowMs + 24 * hour + 30 * minute + 1_000,
    lockTimeMs: nowMs + 24 * hour + 1_000,
    nowMs
  }), { ok: false, reason: "market_open_too_long" });
  assert.deepEqual(validateRequestedMarketLock({
    kickoffMs: nowMs + hour,
    lockTimeMs: nowMs + hour - 4 * minute,
    expectedBufferMinutes: 4,
    nowMs
  }), { ok: false, reason: "invalid_buffer" });
  assert.deepEqual(validateRequestedMarketLock({
    kickoffMs: nowMs + hour,
    lockTimeMs: nowMs,
    nowMs
  }), { ok: false, reason: "lock_not_future" });
});

test("legacy clients can index valid on-chain locks during a rolling deployment", () => {
  const nowMs = Date.parse("2026-07-18T00:00:00.000Z");
  const legacyRequest = {
    kickoffMs: nowMs + 30 * hour,
    lockTimeMs: nowMs + 5 * hour,
    nowMs
  };

  assert.deepEqual(validateRequestedMarketLock(legacyRequest), {
    ok: true,
    bufferMinutes: 1_500
  });
  assert.deepEqual(validateRequestedMarketLock({
    ...legacyRequest,
    expectedBufferMinutes: 30
  }), { ok: false, reason: "invalid_buffer" });
});
