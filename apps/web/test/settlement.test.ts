import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMatchingTxlineSnapshot,
  type TxlineStatValidationProof
} from "../src/server/settlement";

function proof(input: { updateCount?: number; rootByte?: number } = {}): TxlineStatValidationProof {
  return {
    ts: "1700000000000",
    fixtureSummary: {
      fixtureId: "17952170",
      updateStats: {
        updateCount: input.updateCount ?? 3,
        minTimestamp: "1700000000000",
        maxTimestamp: "1700000050000"
      },
      eventsSubTreeRoot: Array(32).fill(input.rootByte ?? 7)
    },
    fixtureProof: [],
    mainTreeProof: [],
    predicate: { threshold: -2_147_483_648, comparison: { greaterThan: {} } },
    statA: {
      statToProve: { key: 1, value: 2, period: 0 },
      eventStatRoot: Array(32).fill(0),
      statProof: []
    },
    statB: null,
    op: null
  };
}

test("settlement proof pairs must come from one TxLINE fixture snapshot", () => {
  const outcome = proof();
  assert.doesNotThrow(() => assertMatchingTxlineSnapshot(outcome, proof()));

  assert.throws(
    () => assertMatchingTxlineSnapshot(outcome, proof({ updateCount: 4 })),
    /same fixture snapshot/
  );
  assert.throws(
    () => assertMatchingTxlineSnapshot(outcome, proof({ rootByte: 8 })),
    /same fixture snapshot/
  );
});
