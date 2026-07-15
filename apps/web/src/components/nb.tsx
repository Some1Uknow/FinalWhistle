import Link from "next/link";
import { ExternalLink, ShieldCheck } from "lucide-react";
import type { MarketRecord } from "@/server/domain";

export function SectionTag({ children }: { children: React.ReactNode }) {
  return <span className="tag">{children}</span>;
}

export function StatusBadge({ status, stale }: { status?: string; stale?: boolean }) {
  const state = stale ? "STALE" : status ?? "OPEN";
  const label = stale
    ? "Updating"
    : ({ OPEN: "Open to pick", LOCKED: "Picks locked", SETTLED: "Result verified", CANCELLED: "Called off" } as Record<string, string>)[state] ?? state;
  return <span className={`status ${state.toLowerCase()}`}>{label}</span>;
}

export function MarketCard({ market, fixtureName, participant1, participant2, stale }: { market: MarketRecord; fixtureName?: string; participant1?: string; participant2?: string; stale?: boolean }) {
  const choices = marketChoices(market, participant1, participant2);

  return (
    <article className="challenge-card">
      <div className="challenge-card-top">
        <span className="challenge-type">{market.template === "MATCH_WINNER" ? "Match winner" : "Total goals"}</span>
        <StatusBadge status={market.status} stale={stale} />
      </div>
      <p className="challenge-match">{fixtureName ?? `Match ${market.fixtureId}`}</p>
      <h3>{challengeQuestion(market, participant1)}</h3>
      <div className="challenge-picks" aria-label="Available choices">
        <span>{choices.yes}</span>
        <i>or</i>
        <span>{choices.no}</span>
      </div>
      <div className="challenge-card-footer">
        <span>{market.status === "OPEN" ? `Closes ${formatDate(market.lockTs)}` : formatDate(market.lockTs)}</span>
        <Link href={`/markets/${market.id}`}>View bet <span aria-hidden="true">→</span></Link>
      </div>
    </article>
  );
}

export function ProofReceipt({ receipt }: { receipt: Record<string, unknown> }) {
  const status = String(receipt.status ?? "PENDING");
  const verified = status === "SETTLED" || status === "CANCELLED";
  const result = receipt.winningSide
    ? String(receipt.template) === "MATCH_WINNER"
      ? receipt.winningSide === "YES" ? "Home side won" : "Home side did not win"
      : `${String(receipt.winningSide)} side`
    : verified ? "Result recorded" : "Still waiting";

  return (
    <section className="nb-card accent-green receipt-card">
      <SectionTag>Match result</SectionTag>
      <h1>{verified ? "Result checked." : "Still in play."}</h1>
      <p className="receipt-lead">{verified ? "The final whistle has a recorded result for this challenge." : "This challenge will update once the match has a clear final result."}</p>
      <div className="metric-row">
        <span>Match status</span>
        <strong>{({ SETTLED: "Full time", CANCELLED: "Called off" } as Record<string, string>)[status] ?? "In play"}</strong>
      </div>
      <div className="metric-row">
        <span>Result</span>
        <strong>{result}</strong>
      </div>
      <details className="receipt-details">
        <summary>Technical receipt</summary>
        <div className="metric-row">
          <span>Result reference</span>
          <strong className="mono">{String(receipt.txlineSeq ?? "Waiting")}</strong>
        </div>
        <div className="proof-box mono">{String(receipt.proofHash ?? "No result receipt has been recorded yet")}</div>
      </details>
      <ShieldCheck size={42} aria-hidden="true" />
    </section>
  );
}

export function ExplorerLink({ signature }: { signature?: string }) {
  if (!signature) return null;
  return (
    <a
      className="nb-button"
      href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
      target="_blank"
      rel="noreferrer"
    >
      <ExternalLink size={16} aria-hidden="true" />
      View receipt
    </a>
  );
}

export function truncate(value: string, chars = 4) {
  return value.length <= chars * 2 + 3 ? value : `${value.slice(0, chars)}...${value.slice(-chars)}`;
}

function marketChoices(market: MarketRecord, participant1?: string, participant2?: string) {
  if (market.template === "MATCH_WINNER") {
    const home = participant1 ?? "Home team";
    const away = participant2 ?? "Away team";
    return { yes: `${home} wins`, no: `${away} wins or draw` };
  }
  const line = (market.predicate.thresholdMilli / 1000).toLocaleString("en", { maximumFractionDigits: 2 });
  return { yes: `More than ${line} goals`, no: `${line} goals or fewer` };
}

function challengeQuestion(market: MarketRecord, participant1?: string) {
  if (market.template === "MATCH_WINNER") return `Will ${participant1 ?? "the home team"} win?`;
  const line = (market.predicate.thresholdMilli / 1000).toLocaleString("en", { maximumFractionDigits: 2 });
  return `How many goals will there be? (${line} line)`;
}

function formatDate(value?: string) {
  if (!value) return "Time TBD";
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return "Time TBD";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
