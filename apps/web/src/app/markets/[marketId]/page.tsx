import Link from "next/link";
import { ExplorerLink, SectionTag, StatusBadge } from "@/components/nb";
import { MarketActions, WalletPanel } from "@/components/beta-client";
import { getMarket } from "@/server/db";
import { notFound } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function MarketPage({ params }: { params: Promise<{ marketId: string }> }) {
  const { marketId } = await params;
  const market = await getMarket(marketId);

  if (!market) notFound();
  const challengeTitle = market.template === "MATCH_WINNER"
    ? "Who takes this one?"
    : `More than ${(market.predicate.thresholdMilli / 1000).toLocaleString("en", { maximumFractionDigits: 2 })} goals?`;

  return (
    <main className="page">
      <section className="section-head">
        <div>
          <SectionTag>Friendly challenge</SectionTag>
          <h1>{challengeTitle}</h1>
        </div>
        <StatusBadge status={market.status} />
      </section>
      <div className="two-col">
        <section className="form-grid">
          <div className="nb-card accent-yellow">
            <SectionTag>The call</SectionTag>
            <h2>{market.template === "MATCH_WINNER" ? "Back your side." : "Call the goal total."}</h2>
            <div className="metric-row">
              <span>Match</span>
              <Link href={`/fixtures/${market.fixtureId}`}>Open match</Link>
            </div>
            <div className="metric-row">
              <span>Challenge status</span>
              <strong>{({ OPEN: "Open to pick", LOCKED: "Match live", SETTLED: "Full time", CANCELLED: "Called off" } as Record<string, string>)[market.status]}</strong>
            </div>
            <div className="metric-row">
              <span>Closes</span>
              <strong>{new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(market.lockTs))}</strong>
            </div>
            <div className="metric-row">
              <span>Final result</span>
              <strong>{market.winningSide ? `${market.winningSide} side` : "Waiting for full time"}</strong>
            </div>
          </div>
          <MarketActions market={market} />
          <div className="nb-card accent-cyan">
            <SectionTag>After full time</SectionTag>
            <h2>The match gets the last word.</h2>
            <p>When the result is clear, this challenge updates with a result you can check in one place.</p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
              <Link className="nb-button" href={`/markets/${market.id}/proof`}>View match result</Link>
              <ExplorerLink signature={market.createTxSig} />
            </div>
          </div>
        </section>
        <WalletPanel latestSignature={market.settleTxSig ?? market.joinTxSig ?? market.createTxSig} />
      </div>
    </main>
  );
}
