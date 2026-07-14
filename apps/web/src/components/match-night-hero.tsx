import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

export function MatchNightHero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy hero-reveal">
        <p className="eyebrow"><Sparkles size={15} aria-hidden="true" /> Match-night challenges for friends</p>
        <h1 id="hero-title">Pick a side.<span>Make the match matter.</span></h1>
        <p className="hero-blurb">
          One good call. One friend taking the other outcome. A little more to cheer for until the final whistle.
        </p>
        <div className="hero-actions">
          <Link className="hero-button" href="/matches">
            Find a match <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <Link className="hero-link" href="/how-it-works">See how it works</Link>
        </div>
        <div className="hero-safety">
          <span className="live-dot" aria-hidden="true" />
          <span>Built for friendlies. Results check in after full time.</span>
        </div>
      </div>

      <div className="hero-art hero-reveal" aria-hidden="true">
        <div className="art-sun" />
        <div className="art-confetti art-confetti-one" />
        <div className="art-confetti art-confetti-two" />
        <div className="art-confetti art-confetti-three" />
        <div className="hero-pitch">
          <div className="pitch-box pitch-box-top" />
          <div className="pitch-box pitch-box-bottom" />
          <div className="pitch-line" />
          <div className="pitch-circle" />
          <div className="pitch-ball"><span /></div>
        </div>
        <div className="scoreboard-card hero-process-card">
          <div className="scoreboard-topline"><span>FINAL WHISTLE</span><span>FOR FRIENDS</span></div>
          <div className="hero-process" role="presentation">
            <strong>Pick</strong><span>→</span><strong>Share</strong><span>→</span><strong>Settle</strong>
          </div>
        </div>
        <div className="art-ticket">
          <span>FOR THE GROUP CHAT</span>
          <strong>One call. Two sides.</strong>
          <small>Until full time.</small>
        </div>
      </div>
    </section>
  );
}
