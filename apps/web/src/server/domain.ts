export const FINAL_PHASES = new Set(["F", "FET", "FPE", "5", "10", "13"]);
export const CANCELLATION_PHASES = new Set(["I", "A", "C", "TXCC", "TXCS", "P", "14", "15", "16", "17", "18", "19"]);

export const SoccerStatKey = {
  participant1Goals: 1,
  participant2Goals: 2,
  participant1YellowCards: 3,
  participant2YellowCards: 4,
  participant1RedCards: 5,
  participant2RedCards: 6,
  participant1Corners: 7,
  participant2Corners: 8
} as const;

export type MarketTemplate = "MATCH_WINNER" | "TOTAL_GOALS_OVER_UNDER";
export type MarketStatus = "OPEN" | "LOCKED" | "SETTLED" | "CANCELLED";
export type Side = "YES" | "NO";
export type StatOperator = "NONE" | "ADD" | "SUBTRACT";
export type Comparison = "GREATER_THAN" | "LESS_THAN" | "EQUAL";
export type FixtureSource = "txline" | "cache";

export type Predicate = {
  statKey1: number;
  statKey2?: number;
  operator: StatOperator;
  thresholdMilli: number;
  comparison: Comparison;
};

export type MarketRecord = {
  id: string;
  fixtureId: string;
  creator: string;
  marketPda?: string;
  escrowTokenAccount?: string;
  tokenMint?: string;
  createTxSig?: string;
  joinTxSig?: string;
  settleTxSig?: string;
  template: MarketTemplate;
  predicate: Predicate;
  lockTs: string;
  settlementDeadlineTs?: string;
  status: MarketStatus;
  yesStake: string;
  noStake: string;
  winningSide?: Side;
  txlineSeq?: string;
  proofHash?: string;
  rawProof?: unknown;
  createdAt: string;
  updatedAt: string;
};

/** A market safe to serialize to an unauthenticated browser. */
export type PublicMarket = Omit<MarketRecord, "rawProof">;

export function toPublicMarket(market: MarketRecord): PublicMarket {
  const { rawProof: _privateProof, ...publicMarket } = market;
  return publicMarket;
}

export function defaultPredicateForTemplate(template: MarketTemplate, thresholdMilli?: number): Predicate {
  if (template === "MATCH_WINNER") {
    return {
      statKey1: SoccerStatKey.participant1Goals,
      statKey2: SoccerStatKey.participant2Goals,
      operator: "SUBTRACT",
      thresholdMilli: 0,
      comparison: "GREATER_THAN"
    };
  }

  return {
    statKey1: SoccerStatKey.participant1Goals,
    statKey2: SoccerStatKey.participant2Goals,
    operator: "ADD",
    thresholdMilli: thresholdMilli ?? 2500,
    comparison: "GREATER_THAN"
  };
}

export function normalizeScoreEvent(input: unknown): Record<string, unknown> {
  const event = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const fixtureId = firstString(event, ["fixtureId", "fixture_id", "FixtureId", "id", "matchId"]);
  const seq = firstNumber(event, ["seq", "sequence", "txlineSeq"]);
  const phase = firstString(event, ["phase", "matchPhase", "status"]);
  const action = firstString(event, ["action"]);
  const statusId = firstNumber(event, ["statusId", "status_id"]);
  const period = firstNumber(event, ["period"]);
  const gameState = firstString(event, ["gameState", "game_state", "GameState"]);
  const finalOutcome = action === "game_finalised" && statusId === 100 && period === 100;
  const cancelledOutcome = gameState === "6" || ["cancelled", "canceled", "abandoned", "postponed"].includes((gameState ?? "").toLowerCase());

  return {
    fixtureId,
    seq,
    phase,
    action,
    statusId,
    period,
    isFinal: finalOutcome || (phase ? FINAL_PHASES.has(phase) : false),
    isCancellation: cancelledOutcome || (phase ? CANCELLATION_PHASES.has(phase) : false),
    raw: event
  };
}

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function firstNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}
