import assert from "node:assert/strict";
import test from "node:test";
import { toTxlineStatValidationProof } from "../src/settlement.js";

const bytes32 = Buffer.alloc(32, 7).toString("base64");

function rawProof(statKey: number, value: number, statKey2?: number, value2?: number) {
  return {
    summary: {
      fixtureId: 12345,
      updateStats: {
        updateCount: 1,
        minTimestamp: 1_783_000_000_000,
        maxTimestamp: 1_783_000_000_001
      },
      eventStatsSubTreeRoot: bytes32
    },
    subTreeProof: [],
    mainTreeProof: [],
    statToProve: { key: statKey, value, period: 0 },
    eventStatRoot: bytes32,
    statProof: [],
    statToProve2: statKey2 === undefined ? undefined : { key: statKey2, value: value2, period: 0 },
    statProof2: statKey2 === undefined ? undefined : []
  };
}

test("converts TxLINE single-stat API proof to Anchor-ready proof args", () => {
  const proof = toTxlineStatValidationProof(rawProof(99, 5), {
    statKey1: 99,
    operator: "NONE"
  });

  assert.equal(proof.fixtureSummary.fixtureId, "12345");
  assert.equal(proof.fixtureSummary.updateStats.minTimestamp, "1783000000000");
  assert.equal(proof.statA.statToProve.key, 99);
  assert.equal(proof.statA.statToProve.value, 5);
  assert.equal(proof.statB, null);
  assert.equal(proof.op, null);
  assert.deepEqual(proof.predicate.comparison, { greaterThan: {} });
});

test("converts TxLINE two-stat API proof with subtract operator", () => {
  const proof = toTxlineStatValidationProof(rawProof(1, 3, 2, 1), {
    statKey1: 1,
    statKey2: 2,
    operator: "SUBTRACT"
  });

  assert.equal(proof.statA.statToProve.key, 1);
  assert.equal(proof.statB?.statToProve.key, 2);
  assert.deepEqual(proof.op, { subtract: {} });
});

test("rejects proofs with unexpected stat keys", () => {
  assert.throws(
    () => toTxlineStatValidationProof(rawProof(1, 3), { statKey1: 2, operator: "NONE" }),
    /did not match/
  );
});
