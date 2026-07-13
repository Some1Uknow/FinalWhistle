import { MarketCard, SectionTag, StatusBadge } from "@/components/nb";
import { CreateMarketPanel, WalletPanel } from "@/components/beta-client";
import { ScoreTicker } from "@/components/score-ticker";
import { notFound } from "next/navigation";
import { config } from "@/server/config";
import { getFixtureView, listFixtureMarkets } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function FixturePage({
  params,
  searchParams
}: {
  params: Promise<{ fixtureId: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const { fixtureId } = await params;
  const { mode } = await searchParams;
  const replay = mode === "replay" && config.betaReplayFixtureIds.includes(fixtureId);
  const [cached, markets] = await Promise.all([
    getFixtureView(fixtureId, replay ? "replay" : "cache", replay),
    listFixtureMarkets(fixtureId)
  ]);
  if (!cached && !replay) notFound();
  const fixture = cached ?? {
    id: fixtureId,
    name: `Replay fixture ${fixtureId}`,
    participant1: "Home",
    participant2: "Away",
    source: "replay" as const,
    stale: true,
    updatedAt: new Date().toISOString()
  };
  return (
    <main className="page">
      <section className="section-head">
        <div>
          <SectionTag>Match night</SectionTag>
          <h1>{fixture.name ?? `Fixture ${fixtureId}`}</h1>
        </div>
        <StatusBadge stale={fixture.stale} />
      </section>
      <ScoreTicker fixtureId={fixtureId} />
      <div className="two-col" style={{ marginTop: 20 }}>
        <section>
          <div className="nb-card accent-yellow">
            <SectionTag>Match</SectionTag>
            <h2>{fixture.participant1 ?? "Home"} vs {fixture.participant2 ?? "Away"}</h2>
            <div className="metric-row">
              <span>Challenge mode</span>
              <strong>{replay ? "Practice match" : "Live match"}</strong>
            </div>
            <div className="metric-row">
              <span>Match board</span>
              <strong>{fixture.stale ? "Checking for an update" : "Ready to call"}</strong>
            </div>
            <div className="metric-row">
              <span>Make a challenge</span>
              <strong>{replay ? "Practice only" : !fixture.stale ? "Ready when you are" : "Wait for a fresh update"}</strong>
            </div>
          </div>
          <div className="section-head">
            <h2>Calls on this match</h2>
            <SectionTag>{markets.length} on board</SectionTag>
          </div>
          <div className="grid">
            {markets.map((market) => (
              <MarketCard key={market.id} market={market} fixtureName={fixture.name} stale={fixture.stale} />
            ))}
          </div>
          {markets.length === 0 && (
            <div className="nb-card accent-cyan">
              <SectionTag>First one in?</SectionTag>
              <h2>No calls yet. Make this match yours.</h2>
            </div>
          )}
        </section>
        <div className="form-grid">
          <WalletPanel />
          <CreateMarketPanel fixtureId={fixtureId} fixtureStale={fixture.stale} />
        </div>
      </div>
    </main>
  );
}
