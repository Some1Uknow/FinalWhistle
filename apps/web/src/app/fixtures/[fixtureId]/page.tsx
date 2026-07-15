import Link from "next/link";
import { MarketCard, SectionTag, StatusBadge } from "@/components/nb";
import { CreateMarketPanel } from "@/components/beta-client";
import { CountryFlag } from "@/components/country-flag";
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
  const home = fixture.participant1 ?? "Home team";
  const away = fixture.participant2 ?? "Away team";
  return (
    <main className="page detail-page">
      <Link className="inline-back" href="/matches">← Matches</Link>
      <section className="fixture-detail-hero" aria-labelledby="fixture-title">
        <div className="fixture-detail-top">
          <div>
            <p className="eyebrow">{fixture.name ?? "Football match"}</p>
            <h1 id="fixture-title">Make your pick</h1>
          </div>
          <StatusBadge stale={fixture.stale} />
        </div>
        <div className="fixture-teams" aria-label={`${home} versus ${away}`}>
          <div className="fixture-team">
            <CountryFlag name={home} fallbackClassName="club-initial-home" />
            <strong>{home}</strong>
          </div>
          <span className="fixture-vs">vs</span>
          <div className="fixture-team">
            <CountryFlag name={away} fallbackClassName="club-initial-away" />
            <strong>{away}</strong>
          </div>
        </div>
        <div className="fixture-meta">
          <span>Kickoff</span>
          <strong>{formatKickoff(fixture.startsAt)}</strong>
        </div>
        <p className="fixture-guide">Choose one outcome, enter an amount, then confirm it in your wallet.</p>
      </section>
      <div className="detail-layout page-content-gap">
        <section>
          <div className="section-head">
            <div>
              <p className="eyebrow">Available bets</p>
              <h2>Pick a market</h2>
            </div>
            <SectionTag>{markets.length} open</SectionTag>
          </div>
          <div className="grid">
            {markets.map((market) => (
              <MarketCard
                key={market.id}
                market={market}
                fixtureName={`${home} vs ${away}`}
                participant1={home}
                participant2={away}
                stale={fixture.stale}
              />
            ))}
          </div>
          {markets.length === 0 && (
            <div className="nb-card accent-cyan">
              <SectionTag>Nothing open</SectionTag>
              <h2>No bets yet</h2>
              <p className="muted">Create the first bet for this match.</p>
            </div>
          )}
        </section>
        <aside className="form-grid">
          <CreateMarketPanel
            fixtureId={fixtureId}
            fixtureStale={fixture.stale}
            fixtureStartsAt={fixture.startsAt}
            participant1={home}
            participant2={away}
          />
        </aside>
      </div>
    </main>
  );
}

function formatKickoff(value?: string) {
  if (!value) return "Time to be confirmed";
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return "Time to be confirmed";
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}
