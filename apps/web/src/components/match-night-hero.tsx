import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function MatchNightHero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <p className="eyebrow">Final Whistle · Devnet</p>
        <h1 id="hero-title">Match challenges.</h1>
        <p className="hero-blurb">Pick a fixture, choose a side, and track the result.</p>
        <div className="hero-actions">
          <Link className="hero-button" href="/matches">
            Browse matches <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <Link className="hero-link" href="/challenges">View challenges</Link>
        </div>
      </div>
      <div className="hero-status" aria-label="Beta status">
        <span className="live-dot" aria-hidden="true" />
        <div><strong>Devnet beta</strong><span>Test tokens only</span></div>
      </div>
    </section>
  );
}
