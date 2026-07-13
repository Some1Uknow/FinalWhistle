import { config, validateConfig } from "../src/server/config";
import { deriveDailyScoresPda } from "../src/server/settlement";
import { txline } from "../src/server/txline";

validateConfig();

async function main() {
  console.log(`TxLINE env: ${config.txlineEnv}`);
  console.log(`Solana cluster: ${config.solanaCluster}`);
  console.log(`TxLINE program: ${config.txlineProgramId}`);

  const fixtures = await txline.listFixtures();
  console.log(`Schedule fixtures: ${fixtures.length}`);

  const first = fixtures.find((fixture) => {
    if (!fixture || typeof fixture !== "object") return false;
    const record = fixture as Record<string, unknown>;
    return record.fixtureId || record.fixture_id || record.id || record.matchId;
  }) as Record<string, unknown> | undefined;

  const fixtureId = first
    ? String(first.fixtureId ?? first.fixture_id ?? first.id ?? first.matchId)
    : undefined;
  if (!fixtureId) {
    console.log("No active fixture found; guest auth and schedule API access passed.");
    console.log(`Daily scores PDA sample: ${deriveDailyScoresPda(Date.now())}`);
    return;
  }

  console.log(`Fixture candidate: ${fixtureId}`);
  const stream = await txline.openScoreStream(fixtureId);
  await stream.cancel().catch(() => undefined);
  console.log("Score stream opened and closed.");

  if (config.txlineFinalityStatKey !== undefined) {
    try {
      const proof = await txline.getStatValidation({
        fixtureId,
        seq: "1",
        statKey: config.txlineFinalityStatKey
      });
      console.log(`Stat-validation proof hash: ${proof.proofHash}`);
    } catch (error) {
      console.log(`Stat-validation proof unavailable for fixture ${fixtureId}: ${(error as Error).message}`);
    }
  } else {
    console.log("TXLINE_FINALITY_STAT_KEY not set; proof fetch skipped.");
  }

  console.log(`Daily scores PDA sample: ${deriveDailyScoresPda(Date.now())}`);
}

await main();
