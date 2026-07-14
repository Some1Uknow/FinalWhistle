import Link from "next/link";
import { ArrowRight, Check, HeartHandshake, UsersRound } from "lucide-react";

export const runtime = "nodejs";

export default function HowItWorksPage() {
  return (
    <main className="page playbook-page">
      <section className="directory-hero directory-hero-sun" aria-labelledby="playbook-title">
        <p className="eyebrow">How it works</p>
        <h1 id="playbook-title">Turn the group-chat take into a proper call.</h1>
        <p>Final Whistle keeps the match, the challenge, and the result in a simple flow that is easy to follow.</p>
      </section>

      <section className="playbook-steps" aria-label="How to make a match call">
        <article>
          <span className="step-number">01</span>
          <UsersRound size={30} aria-hidden="true" />
          <h2>Pick the fixture</h2>
          <p>Start from the match board. You can browse before connecting a wallet, so it&apos;s easy to find the right game first.</p>
        </article>
        <article>
          <span className="step-number">02</span>
          <HeartHandshake size={30} aria-hidden="true" />
          <h2>Choose your side</h2>
          <p>Create a challenge or take an open side. The challenge page shows exactly what is being called and when picks close.</p>
        </article>
        <article>
          <span className="step-number">03</span>
          <Check size={30} aria-hidden="true" />
          <h2>Check back after full time</h2>
          <p>Once the result is available, the challenge updates with the outcome and your personal picks stay together in My picks.</p>
        </article>
      </section>

      <section className="playbook-cta">
        <div>
          <p className="eyebrow">Ready when the match is</p>
          <h2>Find the fixture. Make it interesting.</h2>
        </div>
        <Link href="/matches" className="hero-button">Browse matches <ArrowRight size={18} aria-hidden="true" /></Link>
      </section>
    </main>
  );
}
