import Link from "next/link";
import { ExplorerLink, SectionTag, StatusBadge } from "@/components/nb";
import { MarketActions } from "@/components/beta-client";
import { getMarket } from "@/server/db";
import { toPublicMarket } from "@/server/domain";
import { notFound } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function MarketPage({ params }: { params: Promise<{ marketId: string }> }) {
  const { marketId } = await params;
  const market = await getMarket(marketId);

  if (!market) notFound();
  const publicMarket = toPublicMarket(market);
  const challengeTitle = publicMarket.template === "MATCH_WINNER"
    ? "Will the home side win?"
    : `More than ${(publicMarket.predicate.thresholdMilli / 1000).toLocaleString("en", { maximumFractionDigits: 2 })} goals?`;

  return (
    <main className="page detail-page">
      <Link className="inline-back" href="/challenges">← Back to challenges</Link>
      <section className="section-head">
        <div>
          <SectionTag>Friendly challenge</SectionTag>
          <h1>{challengeTitle}</h1>
        </div>
        <StatusBadge status={publicMarket.status} />
      </section>
      <div className="detail-layout">
        <section className="form-grid">
          <div className="nb-card accent-yellow">
            <SectionTag>The call</SectionTag>
            <h2>{publicMarket.template === "MATCH_WINNER" ? "Back a home win—or not." : "Call the goal total."}</h2>
            <div className="metric-row">
              <span>Match</span>
              <Link href={`/fixtures/${publicMarket.fixtureId}`}>Open match</Link>
            </div>
            <div className="metric-row">
              <span>Challenge status</span>
              <strong>{({ OPEN: "Open to pick", LOCKED: "Picks locked", SETTLED: "Result verified", CANCELLED: "Called off" } as Record<string, string>)[publicMarket.status]}</strong>
            </div>
            <div className="metric-row">
              <span>Closes</span>
              <strong>{new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(publicMarket.lockTs))}</strong>
            </div>
            <div className="metric-row">
              <span>Final result</span>
              <strong>{publicMarket.winningSide
                ? publicMarket.template === "MATCH_WINNER"
                  ? publicMarket.winningSide === "YES" ? "Home side won" : "Home side did not win"
                  : `${publicMarket.winningSide} side`
                : "Waiting for a verified result"}</strong>
            </div>
          </div>
          <div className="nb-card accent-cyan">
            <SectionTag>After full time</SectionTag>
            <h2>The match gets the last word.</h2>
            <p>When the result is clear, this challenge updates with a result you can check in one place.</p>
            <div className="receipt-actions">
              <Link className="nb-button" href={`/markets/${publicMarket.id}/proof`}>View match result</Link>
              <ExplorerLink signature={publicMarket.createTxSig} />
            </div>
          </div>
        </section>
        <aside>
          <MarketActions market={publicMarket} />
        </aside>
      </div>
    </main>
  );
}
