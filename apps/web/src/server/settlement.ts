import { PublicKey } from "@solana/web3.js";
import { config } from "./config";
import type { MarketRecord } from "./domain";

const CANCELLATION_PHASE_IDS = new Set([14, 15, 16, 17, 18, 19]);
const FINAL_RECORD_PERIOD = 100;
const ALWAYS_TRUE_THRESHOLD = -2_147_483_648;

export type TxlineSettlementProofPayload = {
  mode: "VALIDATED_ON_CHAIN_BY_TXLINE";
  txlineProgramId: string;
  dailyScoresMerkleRoots: string;
  instruction: "settle_market";
  args: {
    fixtureId: string;
    seq: string;
    statKey1: number;
    statKey2?: number;
    outcomeProof: TxlineStatValidationProof;
  };
};

export type TxlineCancellationProofPayload = {
  mode: "VALIDATED_ON_CHAIN_BY_TXLINE";
  txlineProgramId: string;
  dailyScoresMerkleRoots: string;
  instruction: "cancel_market";
  args: {
    fixtureId: string;
    seq: string;
    cancellationProof: TxlineStatValidationProof;
    cancellationPhaseId: number;
  };
};

export type TxlineStatValidationProof = {
  ts: string;
  fixtureSummary: {
    fixtureId: string;
    updateStats: {
      updateCount: number;
      minTimestamp: string;
      maxTimestamp: string;
    };
    eventsSubTreeRoot: number[];
  };
  fixtureProof: Array<{ hash: number[]; isRightSibling: boolean }>;
  mainTreeProof: Array<{ hash: number[]; isRightSibling: boolean }>;
  predicate: {
    threshold: number;
    comparison: { greaterThan: Record<string, never> };
  };
  statA: TxlineStatTerm;
  statB: TxlineStatTerm | null;
  op: { add: Record<string, never> } | { subtract: Record<string, never> } | null;
};

type TxlineStatTerm = {
  statToProve: {
    key: number;
    value: number;
    period: number;
  };
  eventStatRoot: number[];
  statProof: Array<{ hash: number[]; isRightSibling: boolean }>;
};

export function deriveMarketPda(input: { creator: string; fixtureId: string; marketNonce: string }) {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("market"),
      new PublicKey(input.creator).toBuffer(),
      Buffer.from(input.fixtureId),
      u64Le(BigInt(input.marketNonce))
    ],
    new PublicKey(config.programId)
  );
  return pda.toBase58();
}

export function buildTxlineSettlementProofPayload(input: {
  market: MarketRecord;
  seq: string;
  outcomeProof: unknown;
}): TxlineSettlementProofPayload {
  const outcomeProof = toTxlineStatValidationProof(input.outcomeProof, {
    statKey1: input.market.predicate.statKey1,
    statKey2: input.market.predicate.statKey2,
    operator: input.market.predicate.operator
  });
  assertFinalRecordPeriod(outcomeProof);
  const outcomeDailyScores = deriveDailyScoresPda(extractMinTimestamp(outcomeProof));

  return {
    mode: "VALIDATED_ON_CHAIN_BY_TXLINE",
    txlineProgramId: config.txlineProgramId,
    dailyScoresMerkleRoots: outcomeDailyScores,
    instruction: "settle_market",
    args: {
      fixtureId: input.market.fixtureId,
      seq: input.seq,
      statKey1: input.market.predicate.statKey1,
      statKey2: input.market.predicate.statKey2,
      outcomeProof
    }
  };
}

export function buildTxlineCancellationProofPayload(input: {
  market: MarketRecord;
  seq: string;
  cancellationProof: unknown;
}): TxlineCancellationProofPayload {
  const cancellationProof = toTxlineStatValidationProof(input.cancellationProof, {
    statKey1: input.market.predicate.statKey1,
    operator: "NONE"
  });
  const cancellationPhaseId = cancellationProof.statA.statToProve.period;
  if (!CANCELLATION_PHASE_IDS.has(cancellationPhaseId)) {
    throw new Error(`TxLINE proof phase is not cancellable: ${cancellationPhaseId}`);
  }
  return {
    mode: "VALIDATED_ON_CHAIN_BY_TXLINE",
    txlineProgramId: config.txlineProgramId,
    dailyScoresMerkleRoots: deriveDailyScoresPda(extractMinTimestamp(cancellationProof)),
    instruction: "cancel_market",
    args: {
      fixtureId: input.market.fixtureId,
      seq: input.seq,
      cancellationProof,
      cancellationPhaseId
    }
  };
}

export function toTxlineStatValidationProof(
  proof: unknown,
  expected: { statKey1: number; statKey2?: number; operator: MarketRecord["predicate"]["operator"] }
): TxlineStatValidationProof {
  const source = proofRecord(proof);
  const summary = proofRecord(source.summary ?? source.fixtureSummary ?? source.fixture_summary);
  const updateStats = proofRecord(summary.updateStats ?? summary.update_stats);
  const minTimestamp = requiredInteger(updateStats.minTimestamp ?? updateStats.min_timestamp, "summary.updateStats.minTimestamp");

  const statA = source.statA ?? source.stat_a
    ? toExistingStatTerm(source.statA ?? source.stat_a, "statA")
    : toStatTerm({
        statToProve: source.statToProve ?? source.stat_to_prove,
        eventStatRoot: source.eventStatRoot ?? source.event_stat_root,
        statProof: source.statProof ?? source.stat_proof
      });
  if (statA.statToProve.key !== expected.statKey1) {
    throw new Error(`TxLINE proof first stat key ${statA.statToProve.key} did not match ${expected.statKey1}`);
  }

  const statB = expected.statKey2 === undefined
    ? null
    : source.statB ?? source.stat_b
      ? toExistingStatTerm(source.statB ?? source.stat_b, "statB")
      : toStatTerm({
          statToProve: source.statToProve2 ?? source.stat_to_prove_2,
          eventStatRoot: source.eventStatRoot2 ?? source.event_stat_root_2 ?? source.eventStatRoot ?? source.event_stat_root,
          statProof: source.statProof2 ?? source.stat_proof_2
        });
  if (statB && statB.statToProve.key !== expected.statKey2) {
    throw new Error(`TxLINE proof second stat key ${statB.statToProve.key} did not match ${expected.statKey2}`);
  }

  return {
    ts: String(minTimestamp),
    fixtureSummary: {
      fixtureId: String(requiredInteger(summary.fixtureId ?? summary.fixture_id, "summary.fixtureId")),
      updateStats: {
        updateCount: requiredInteger(updateStats.updateCount ?? updateStats.update_count, "summary.updateStats.updateCount"),
        minTimestamp: String(minTimestamp),
        maxTimestamp: String(requiredInteger(updateStats.maxTimestamp ?? updateStats.max_timestamp, "summary.updateStats.maxTimestamp"))
      },
      eventsSubTreeRoot: toBytes32(
        summary.eventsSubTreeRoot ??
          summary.events_sub_tree_root ??
          summary.eventStatsSubTreeRoot ??
          summary.event_stats_sub_tree_root,
        "summary.eventsSubTreeRoot"
      )
    },
    fixtureProof: toProofNodes(source.fixtureProof ?? source.fixture_proof ?? source.subTreeProof, "fixtureProof"),
    mainTreeProof: toProofNodes(source.mainTreeProof ?? source.main_tree_proof, "mainTreeProof"),
    predicate: {
      threshold: ALWAYS_TRUE_THRESHOLD,
      comparison: { greaterThan: {} }
    },
    statA,
    statB,
    op: expected.operator === "ADD"
      ? { add: {} }
      : expected.operator === "SUBTRACT"
        ? { subtract: {} }
        : null
  };
}

function assertFinalRecordPeriod(proof: TxlineStatValidationProof) {
  const periods = [proof.statA.statToProve.period, proof.statB?.statToProve.period];
  if (periods.some((period) => period !== FINAL_RECORD_PERIOD)) {
    throw new Error(`TxLINE proof is not from a final record (expected period ${FINAL_RECORD_PERIOD})`);
  }
}

export function deriveDailyScoresPda(minTimestampMs: number) {
  const epochDay = Math.floor(minTimestampMs / 86_400_000);
  const seed = Buffer.alloc(2);
  seed.writeUInt16LE(epochDay);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), seed],
    new PublicKey(config.txlineProgramId)
  );
  return pda.toBase58();
}

function extractMinTimestamp(proof: unknown) {
  const source = proofRecord(proof);
  const summary = proofRecord(source.summary ?? source.fixtureSummary ?? source.fixture_summary);
  const updateStats = proofRecord(summary.updateStats ?? summary.update_stats);
  const minTimestamp = Number(updateStats.minTimestamp ?? updateStats.min_timestamp);
  if (!Number.isFinite(minTimestamp) || minTimestamp < 0) {
    throw new Error("TxLINE proof is missing summary.updateStats.minTimestamp");
  }
  return minTimestamp;
}

function proofRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function toStatTerm(input: { statToProve: unknown; eventStatRoot: unknown; statProof: unknown }): TxlineStatTerm {
  const stat = proofRecord(input.statToProve);
  return {
    statToProve: {
      key: requiredInteger(stat.key, "statToProve.key"),
      value: requiredInteger(stat.value, "statToProve.value"),
      period: requiredInteger(stat.period, "statToProve.period")
    },
    eventStatRoot: toBytes32(input.eventStatRoot, "eventStatRoot"),
    statProof: toProofNodes(input.statProof, "statProof")
  };
}

function toExistingStatTerm(value: unknown, label: string): TxlineStatTerm {
  const record = proofRecord(value);
  return toStatTerm({
    statToProve: record.statToProve ?? record.stat_to_prove,
    eventStatRoot: record.eventStatRoot ?? record.event_stat_root,
    statProof: record.statProof ?? record.stat_proof
  });
}

function toProofNodes(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`TxLINE proof is missing ${label}`);
  return value.map((node, index) => {
    const record = proofRecord(node);
    return {
      hash: toBytes32(record.hash, `${label}[${index}].hash`),
      isRightSibling: Boolean(record.isRightSibling ?? record.is_right_sibling)
    };
  });
}

function toBytes32(value: unknown, label: string) {
  let bytes: Buffer;
  if (Array.isArray(value)) {
    bytes = Buffer.from(value);
  } else if (typeof value === "string") {
    bytes = value.startsWith("0x")
      ? Buffer.from(value.slice(2), "hex")
      : /^[0-9a-f]{64}$/i.test(value)
        ? Buffer.from(value, "hex")
        : Buffer.from(value, "base64");
  } else {
    throw new Error(`TxLINE proof is missing ${label}`);
  }
  if (bytes.length !== 32) throw new Error(`TxLINE proof ${label} must be 32 bytes`);
  return Array.from(bytes);
}

function requiredInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`TxLINE proof is missing ${label}`);
  return parsed;
}

function u64Le(value: bigint) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value);
  return buffer;
}
