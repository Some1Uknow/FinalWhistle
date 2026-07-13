import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

export function MatchNightHero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy hero-reveal">
        <p className="eyebrow"><Sparkles size={15} aria-hidden="true" /> Match-night challenges for friends</p>
        <h1 id="hero-title">Pick a side.<span>Make the match matter.</span></h1>
        <p className="hero-blurb">
          One good call. One friend on the other side. A little more to cheer for until the final whistle.
        </p>
        <div className="hero-actions">
          <Link className="hero-button" href="#matches">
            Find a match <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <Link className="hero-link" href="#how-it-works">See how it works</Link>
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
        <div className="scoreboard-card">
          <div className="scoreboard-topline"><span>TONIGHT&apos;S FRIENDLY</span><span>20:00</span></div>
          <div className="scoreboard-teams">
            <div className="art-team">
              <span className="team-crest team-crest-blue">C</span>
              <strong>Cobalt City</strong>
            </div>
            <span className="scoreboard-vs">VS</span>
            <div className="art-team">
              <span className="team-crest team-crest-coral">N</span>
              <strong>Northshore</strong>
            </div>
          </div>
        </div>
        <div className="art-message art-message-one">I&apos;ve got Cobalt ⚽</div>
        <div className="art-message art-message-two">You&apos;re on.</div>
        <div className="art-ticket">
          <span>YOUR CALL</span>
          <strong>Home side wins</strong>
          <small>friendly challenge</small>
        </div>
      </div>
    </section>
  );
}
