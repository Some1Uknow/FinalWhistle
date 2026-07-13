import { Suspense } from "react";
import { Check, HeartHandshake, ShieldCheck, UsersRound } from "lucide-react";
import { WalletPanel } from "@/components/beta-client";
import { HomeMatchBoard, HomeMatchBoardSkeleton } from "@/components/home-match-board";
import { MatchNightHero } from "@/components/match-night-hero";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <main className="home-page">
      <div className="home-frame">
        <MatchNightHero />

        <section className="how-it-works" id="how-it-works" aria-labelledby="how-title">
          <div className="section-intro">
            <p className="eyebrow">No playbook needed</p>
            <h2 id="how-title">The game is simple.</h2>
            <p>Make one friendly call on a match, then enjoy having something to argue about until full time.</p>
          </div>
          <ol className="play-steps">
            <li>
              <span className="step-number">01</span>
              <UsersRound size={27} aria-hidden="true" />
              <h3>Choose a match</h3>
              <p>Find a fixture that your group is already talking about.</p>
            </li>
            <li>
              <span className="step-number">02</span>
              <HeartHandshake size={27} aria-hidden="true" />
              <h3>Make your call</h3>
              <p>Pick a side, invite a friend to take the other one, and lock it in.</p>
            </li>
            <li>
              <span className="step-number">03</span>
              <Check size={27} aria-hidden="true" />
              <h3>Let full time decide</h3>
              <p>The match result is checked before the challenge gets its final word.</p>
            </li>
          </ol>
        </section>

        <Suspense fallback={<HomeMatchBoardSkeleton />}>
          <HomeMatchBoard />
        </Suspense>

        <section className="fair-play" aria-labelledby="fair-play-title">
          <div>
            <p className="eyebrow">A fair finish</p>
            <h2 id="fair-play-title">More match day. Less admin.</h2>
            <p>Every challenge is built to feel like a friend&apos;s call—not a spreadsheet you have to babysit.</p>
          </div>
          <div className="fair-play-points">
            <div><ShieldCheck size={21} aria-hidden="true" /><span>Calls lock before the result is known.</span></div>
            <div><Check size={21} aria-hidden="true" /><span>Results are checked after the final whistle.</span></div>
            <div><HeartHandshake size={21} aria-hidden="true" /><span>Designed for friendly test-mode play.</span></div>
          </div>
        </section>

        <section className="ready-section" aria-labelledby="ready-title">
          <div className="ready-copy">
            <p className="eyebrow">Your match pass</p>
            <h2 id="ready-title">Bring a friend. Make a call.</h2>
            <p>Connect when you&apos;re ready to join a challenge. Until then, the board is yours to browse.</p>
          </div>
          <WalletPanel />
        </section>
      </div>
    </main>
  );
}
