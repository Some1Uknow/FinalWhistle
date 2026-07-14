import Link from "next/link";
import { ArrowRight } from "lucide-react";
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
            <span className="route-kicker">Fixtures</span>
            <strong>Matches</strong>
            <span>Browse available fixtures.</span>
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <Link href="/challenges" className="route-card route-card-coral">
            <span className="route-kicker">Markets</span>
            <strong>Challenges</strong>
            <span>View open and settled calls.</span>
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <Link href="/portfolio" className="route-card route-card-blue">
            <span className="route-kicker">Account</span>
            <strong>My picks</strong>
            <span>Track positions and results.</span>
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </section>
      </div>
    </main>
  );
}
