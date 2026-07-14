import Link from "next/link";
import { ArrowRight, Check, HeartHandshake, UsersRound } from "lucide-react";

export const runtime = "nodejs";

export default function HowItWorksPage() {
  return (
    <main className="page playbook-page">
      <section className="directory-hero directory-hero-sun" aria-labelledby="playbook-title">
        <p className="eyebrow">How it works</p>
        <h1 id="playbook-title">Three steps</h1>
        <p>Find a fixture, choose a side, and check the result.</p>
      </section>

      <section className="playbook-steps" aria-label="How to make a match call">
        <article>
          <span className="step-number">01</span>
          <UsersRound size={30} aria-hidden="true" />
          <h2>Pick the fixture</h2>
          <p>Browse the match board before connecting a wallet.</p>
        </article>
        <article>
          <span className="step-number">02</span>
          <HeartHandshake size={30} aria-hidden="true" />
          <h2>Choose your side</h2>
          <p>Create a challenge or take an open side before picks close.</p>
        </article>
        <article>
          <span className="step-number">03</span>
          <Check size={30} aria-hidden="true" />
          <h2>Check back after full time</h2>
          <p>The challenge records the outcome. Your positions remain in My picks.</p>
        </article>
      </section>

      <section className="playbook-cta">
        <div>
          <p className="eyebrow">Start</p>
          <h2>Browse available fixtures</h2>
        </div>
        <Link href="/matches" className="hero-button">Browse matches <ArrowRight size={18} aria-hidden="true" /></Link>
      </section>
    </main>
  );
}
