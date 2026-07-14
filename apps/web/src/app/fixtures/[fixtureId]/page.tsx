import Link from "next/link";
import { MarketCard, SectionTag, StatusBadge } from "@/components/nb";
import { CreateMarketPanel } from "@/components/beta-client";
import { notFound } from "next/navigation";
import { getFixtureView, listFixtureMarkets } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function FixturePage({
  params,
}: {
  params: Promise<{ fixtureId: string }>;
}) {
  const { fixtureId } = await params;
  const [cached, markets] = await Promise.all([
    getFixtureView(fixtureId),
    listFixtureMarkets(fixtureId, 50)
  ]);
  if (!cached) notFound();
  const fixture = cached;
  return (
    <main className="page detail-page">
      <Link className="inline-back" href="/matches">← Back to matches</Link>
      <section className="section-head">
        <div>
          <SectionTag>Match center</SectionTag>
          <h1>{fixture.name ?? `Fixture ${fixtureId}`}</h1>
        </div>
        <StatusBadge stale={fixture.stale} />
      </section>
      <div className="detail-layout page-content-gap">
        <section>
          <div className="nb-card accent-yellow">
            <SectionTag>Match</SectionTag>
            <h2>{fixture.participant1 ?? "Home"} vs {fixture.participant2 ?? "Away"}</h2>
            <div className="metric-row">
              <span>Challenge type</span>
              <strong>Friendly match call</strong>
            </div>
            <div className="metric-row">
              <span>Match status</span>
              <strong>{fixture.stale ? "Checking for an update" : "Ready to call"}</strong>
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
              <SectionTag>Empty</SectionTag>
              <h2>No challenges yet</h2>
            </div>
          )}
        </section>
        <aside className="form-grid">
          <CreateMarketPanel fixtureId={fixtureId} fixtureStale={fixture.stale} fixtureStartsAt={fixture.startsAt} />
        </aside>
      </div>
    </main>
  );
}
