import Link from "next/link";
import { MatchNightHero } from "@/components/match-night-hero";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <main className="home-page">
      <div className="home-frame">
        <MatchNightHero />

        <section className="home-section home-how" aria-labelledby="home-how-title">
          <div className="home-section-heading">
            <p className="eyebrow">How it works</p>
            <h2 id="home-how-title">Three steps. No complicated odds.</h2>
          </div>
          <div className="home-steps">
            <article className="home-step">
              <span className="home-step-number">01</span>
              <h3>Pick a side</h3>
              <p>Choose a match and say what you think will happen.</p>
            </article>
            <article className="home-step">
              <span className="home-step-number">02</span>
              <h3>Get matched</h3>
              <p>Someone takes the opposite side and puts in the same amount.</p>
            </article>
            <article className="home-step">
              <span className="home-step-number">03</span>
              <h3>Winner collects</h3>
              <p>After the final score is verified, the winner can collect the pot.</p>
            </article>
          </div>
        </section>

        <section className="home-market-guide" aria-labelledby="market-guide-title">
          <div className="home-market-copy">
            <p className="eyebrow">What can you pick?</p>
            <h2 id="market-guide-title">Two simple types of challenge.</h2>
            <p>Choose who wins, or choose how many total goals the match will have.</p>
            <Link className="quiet-link" href="/matches">See available matches</Link>
          </div>
          <div className="home-market-board">
            <article className="market-guide-card market-guide-winner">
              <span>Match winner</span>
              <h3>You pick a team to win.</h3>
              <p>The other person gets the opposite result: that team draws or loses.</p>
            </article>
            <article className="market-guide-card market-guide-goals">
              <span>Total goals — 2.5 example</span>
              <h3>Count both teams&apos; goals together.</h3>
              <div className="goal-line-explainer">
                <div><strong>3 or more goals</strong><small>Over 2.5 wins</small></div>
                <div><strong>0, 1, or 2 goals</strong><small>Under 2.5 wins</small></div>
              </div>
              <p>There cannot be exactly 2.5 goals, so one side always wins.</p>
            </article>
          </div>
        </section>

        <section className="home-section home-safety" aria-labelledby="home-safety-title">
          <div className="home-section-heading">
            <p className="eyebrow">What happens to your amount?</p>
            <h2 id="home-safety-title">You win, lose, or get it back.</h2>
          </div>
          <div className="home-outcomes">
            <article className="home-outcome home-outcome-win"><span>Match completed</span><h3>The verified winner collects the pot.</h3></article>
            <article className="home-outcome home-outcome-open"><span>Nobody joins</span><h3>You can collect your original amount back.</h3></article>
            <article className="home-outcome home-outcome-cancel"><span>Match cancelled</span><h3>Both people can collect their original amounts.</h3></article>
          </div>
          <p className="home-fixed-rule"><strong>The rule cannot change after the challenge is created.</strong> The match, prediction, amount, and closing time stay fixed.</p>
        </section>

        <section className="home-final-cta" aria-labelledby="home-cta-title">
          <div>
            <p className="eyebrow">Ready?</p>
            <h2 id="home-cta-title">Choose a match and make your pick.</h2>
          </div>
          <Link className="hero-button" href="/matches">Pick a match</Link>
        </section>
      </div>
    </main>
  );
}
