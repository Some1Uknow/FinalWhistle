import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FixtureRefreshPanel, ReplayFixtureCards } from "@/components/beta-client";
import { LiveFixtureBoard } from "@/components/live-fixture-board";
import { MarketCard, SectionTag } from "@/components/nb";
import { ScoreTicker } from "@/components/score-ticker";
import { config } from "@/server/config";
import { listAllMarkets, listFixtureViews } from "@/server/db";

/**
 * The board is intentionally isolated from the landing shell. The fixture
 * cache lives in Postgres, which can take a moment to wake on a cold
 * serverless request; keeping it behind a Suspense boundary lets the welcome
 * experience reach the player immediately.
 */
export async function HomeMatchBoard() {
  const [fixtures, markets] = await Promise.all([
    listFixtureViews("cache", false),
    listAllMarkets()
  ]);
  const fixturesById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const marketViews = markets.map((market) => {
    const replay = config.betaReplayFixtureIds.includes(market.fixtureId);
    const fixture = fixturesById.get(market.fixtureId);
    return {
      market,
      fixtureName: fixture?.name ?? (replay ? `Replay fixture ${market.fixtureId}` : `Fixture ${market.fixtureId}`),
      stale: replay || !fixture || fixture.stale
    };
  });

  return (
    <>
      <section className="match-section" id="matches" aria-labelledby="matches-title">
        <div className="section-intro section-intro-wide">
          <p className="eyebrow">The match board</p>
          <h2 id="matches-title">Find a match. Call your shot.</h2>
          <p>Choose a game that feels worth the group chat noise. We&apos;ll take care of the score check after the whistle.</p>
        </div>
        <ScoreTicker />
        <FixtureRefreshPanel replayEnabled={config.betaReplayFixtureIds.length > 0} />
        <LiveFixtureBoard initialFixtures={fixtures} />
        <ReplayFixtureCards />
      </section>

      <section className="challenge-section" aria-labelledby="challenge-title">
        <div className="section-head friendly-head">
          <div>
            <p className="eyebrow">On the board now</p>
            <h2 id="challenge-title">Friends have made these calls.</h2>
          </div>
          {marketViews.length > 0 && <SectionTag>{marketViews.length} open</SectionTag>}
        </div>
        {marketViews.length > 0 ? (
          <div className="challenge-grid">
            {marketViews.map(({ market, fixtureName, stale }) => (
              <MarketCard key={market.id} market={market} fixtureName={fixtureName} stale={stale} />
            ))}
          </div>
        ) : (
          <div className="club-note">
            <div>
              <span className="club-note-mark">FW</span>
              <p><strong>No calls on the board yet.</strong> Be the friend who starts the first one.</p>
            </div>
            <Link href="#matches" className="quiet-link">Choose a match <ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
        )}
      </section>
    </>
  );
}

export function HomeMatchBoardSkeleton() {
  return (
    <section className="match-section" id="matches" aria-busy="true" aria-labelledby="matches-loading-title">
      <div className="section-intro section-intro-wide">
        <p className="eyebrow">The match board</p>
        <h2 id="matches-loading-title">Getting the board ready.</h2>
        <p>Your match-night welcome is already here. We&apos;re loading the latest calls in the background.</p>
      </div>
      <div className="board-loading" role="status" aria-live="polite">
        <span className="board-loading-pulse" aria-hidden="true" />
        <span>Checking the latest match list…</span>
      </div>
      <div className="match-card-grid" aria-hidden="true">
        <div className="match-card match-card-skeleton"><span /><span /><span /></div>
        <div className="match-card match-card-skeleton"><span /><span /><span /></div>
        <div className="match-card match-card-skeleton"><span /><span /><span /></div>
      </div>
    </section>
  );
}
