import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FixtureRefreshPanel } from "@/components/beta-client";
import { LiveFixtureBoard } from "@/components/live-fixture-board";
import { MarketCard, SectionTag } from "@/components/nb";
import { listAllMarkets, listFixtureViews } from "@/server/db";

export async function MatchDirectory() {
  const fixtures = await listFixtureViews("cache", false, 50);

  return (
    <>
      <section className="directory-hero" aria-labelledby="matches-title">
        <p className="eyebrow">Match board</p>
        <h1 id="matches-title">Find the match worth talking about.</h1>
        <p>Browse the fixtures, pick your angle, and start a challenge when you&apos;re ready.</p>
      </section>
      <section className="directory-content" aria-label="Available matches">
        <FixtureRefreshPanel />
        <LiveFixtureBoard initialFixtures={fixtures} />
      </section>
    </>
  );
}

export async function ChallengeDirectory() {
  const [fixtures, markets] = await Promise.all([
    listFixtureViews("cache", false, 50),
    listAllMarkets(50)
  ]);
  const fixturesById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));

  return (
    <>
      <section className="directory-hero directory-hero-green" aria-labelledby="challenges-title">
        <p className="eyebrow">Open challenges</p>
        <h1 id="challenges-title">See what everyone&apos;s calling.</h1>
        <p>Pick up an open side, follow a locked call, or start one from a match that&apos;s on the board.</p>
      </section>
      <section className="directory-content" aria-label="Challenges on the board">
        <div className="section-head friendly-head">
          <div>
            <p className="eyebrow">On the board</p>
            <h2>Friendly calls, all in one place.</h2>
          </div>
          {markets.length > 0 && <SectionTag>{markets.length} total</SectionTag>}
        </div>
        {markets.length > 0 ? (
          <div className="challenge-grid">
            {markets.map((market) => {
              const fixture = fixturesById.get(market.fixtureId);
              return (
                <MarketCard
                  key={market.id}
                  market={market}
                  fixtureName={fixture?.name ?? `Fixture ${market.fixtureId}`}
                  stale={!fixture || fixture.stale}
                />
              );
            })}
          </div>
        ) : (
          <div className="club-note">
            <div>
              <span className="club-note-mark">FW</span>
              <p><strong>No calls on the board yet.</strong> Start with a match your group is already watching.</p>
            </div>
            <Link href="/matches" className="quiet-link">Browse matches <ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
        )}
      </section>
    </>
  );
}
