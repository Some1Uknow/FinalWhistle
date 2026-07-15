import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTxlineCancellationProofPayload,
  buildTxlineSettlementProofPayload,
  type TxlineStatValidationProof
} from "../src/server/settlement";
import type { MarketRecord } from "../src/server/domain";

const market: MarketRecord = {
  id: "market-1",
  fixtureId: "17952170",
  creator: "11111111111111111111111111111111",
  template: "MATCH_WINNER",
  predicate: {
    statKey1: 1,
    statKey2: 2,
    operator: "SUBTRACT",
    thresholdMilli: 0,
    comparison: "GREATER_THAN"
  },
  lockTs: "2026-01-01T00:00:00.000Z",
  status: "LOCKED",
  yesStake: "1000000000",
  noStake: "1000000000",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

function proof(period: number): TxlineStatValidationProof {
  return {
    ts: "1700000000000",
    fixtureSummary: {
      fixtureId: market.fixtureId,
      updateStats: {
        updateCount: 3,
        minTimestamp: "1700000000000",
        maxTimestamp: "1700000050000"
      },
      eventsSubTreeRoot: Array(32).fill(7)
    },
    fixtureProof: [],
    mainTreeProof: [],
    predicate: { threshold: -2_147_483_648, comparison: { greaterThan: {} } },
    statA: {
      statToProve: { key: 1, value: 2, period },
      eventStatRoot: Array(32).fill(0),
      statProof: []
    },
    statB: {
      statToProve: { key: 2, value: 1, period },
      eventStatRoot: Array(32).fill(0),
      statProof: []
    },
    op: { subtract: {} }
  };
}

test("settlement accepts only a Merkle-proven final TxLINE record", () => {
  const payload = buildTxlineSettlementProofPayload({
    market,
    seq: "1087",
    outcomeProof: proof(100)
  });

  assert.equal(payload.args.outcomeProof.statA.statToProve.period, 100);
  assert.equal(payload.args.outcomeProof.statB?.statToProve.period, 100);
  assert.throws(
    () => buildTxlineSettlementProofPayload({ market, seq: "1087", outcomeProof: proof(5) }),
    /final record/
  );
});

test("cancellation accepts only documented cancellation periods on the market stat", () => {
  const cancellationMarket: MarketRecord = {
    ...market,
    predicate: { ...market.predicate, statKey2: undefined, operator: "NONE" },
    status: "OPEN"
  };
  const raw = proof(14);
  raw.statB = null;
  raw.op = null;
  const payload = buildTxlineCancellationProofPayload({
    market: cancellationMarket,
    seq: "1088",
    cancellationProof: raw
  });
  assert.equal(payload.args.cancellationPhaseId, 14);

  const nonCancellation = proof(100);
  nonCancellation.statB = null;
  nonCancellation.op = null;
  assert.throws(
    () => buildTxlineCancellationProofPayload({
      market: cancellationMarket,
      seq: "1088",
      cancellationProof: nonCancellation
    }),
    /not cancellable/
  );
});
