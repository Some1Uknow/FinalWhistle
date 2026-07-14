import assert from "node:assert/strict";
import test from "node:test";
import { normalizeScoreEvent } from "../src/server/domain";

test("recognizes the documented TxLINE final outcome record", () => {
  const event = normalizeScoreEvent({
    fixtureId: 17_952_170,
    seq: 42,
    action: "game_finalised",
    statusId: 100,
    period: 100
  });

  assert.equal(event.fixtureId, "17952170");
  assert.equal(event.seq, 42);
  assert.equal(event.isFinal, true);
  assert.equal(event.isCancellation, false);
});

test("does not treat an ordinary score update as a final result", () => {
  const event = normalizeScoreEvent({
    fixtureId: 17_952_170,
    seq: 41,
    action: "goal",
    statusId: 100,
    period: 100
  });

  assert.equal(event.isFinal, false);
});

test("recognizes an explicit cancelled fixture state", () => {
  const event = normalizeScoreEvent({ fixtureId: 17_952_170, seq: 43, gameState: 6 });
  assert.equal(event.isCancellation, true);
});
