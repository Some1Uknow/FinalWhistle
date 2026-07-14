import Link from "next/link";
import { ArrowRight, Check, HeartHandshake, UsersRound } from "lucide-react";
import { MatchNightHero } from "@/components/match-night-hero";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <main className="home-page">
      <div className="home-frame">
        <MatchNightHero />

        <section className="home-routes" aria-label="Start here">
          <Link href="/matches" className="route-card route-card-lime">
            <span className="route-kicker">Start with the fixture</span>
            <strong>Browse matches</strong>
            <span>Find the game your group is already talking about.</span>
            <ArrowRight size={22} aria-hidden="true" />
          </Link>
          <Link href="/challenges" className="route-card route-card-coral">
            <span className="route-kicker">Join the conversation</span>
            <strong>See challenges</strong>
            <span>Take an open side or follow a call through full time.</span>
            <ArrowRight size={22} aria-hidden="true" />
          </Link>
          <Link href="/portfolio" className="route-card route-card-blue">
            <span className="route-kicker">Keep score</span>
            <strong>My picks</strong>
            <span>Your calls, results, and receipts live in one clean place.</span>
            <ArrowRight size={22} aria-hidden="true" />
          </Link>
        </section>

        <section className="how-it-works home-how-it-works" aria-labelledby="how-title">
          <div className="section-intro">
            <p className="eyebrow">No playbook needed</p>
            <h2 id="how-title">One match. One call. A lot more to say.</h2>
            <p>It takes a minute to get in. The conversation lasts until the whistle.</p>
          </div>
          <ol className="play-steps">
            <li>
              <span className="step-number">01</span>
              <UsersRound size={27} aria-hidden="true" />
              <h3>Choose a match</h3>
              <p>Find a fixture your group already cares about.</p>
            </li>
            <li>
              <span className="step-number">02</span>
              <HeartHandshake size={27} aria-hidden="true" />
              <h3>Make your call</h3>
              <p>Set your side, share it, and let a friend take the other one.</p>
            </li>
            <li>
              <span className="step-number">03</span>
              <Check size={27} aria-hidden="true" />
              <h3>Let full time decide</h3>
              <p>Come back when the result is in and see how the call landed.</p>
            </li>
          </ol>
          <Link className="hero-link how-link" href="/how-it-works">See the full playbook <ArrowRight size={16} aria-hidden="true" /></Link>
        </section>
      </div>
    </main>
  );
}
