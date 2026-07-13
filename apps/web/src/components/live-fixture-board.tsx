"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { FixtureView } from "@/server/db";

export function LiveFixtureBoard({ initialFixtures }: { initialFixtures: FixtureView[] }) {
  const [fixtures, setFixtures] = useState(initialFixtures);
  const [status, setStatus] = useState(initialFixtures.length ? "A few matches are ready to browse." : "Looking for the next match…");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/fixtures");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Live fixtures are unavailable");
      setFixtures(payload.fixtures ?? []);
      const count = payload.fixtures?.length ?? 0;
      setStatus(count ? `${count} ${count === 1 ? "match is" : "matches are"} waiting for a call.` : "Nothing on the board just yet.");
    } catch {
      setStatus("The match board is taking a breather. Try again in a moment.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onRefresh = () => void refresh();
    window.addEventListener("finalwhistle:fixtures-refreshed", onRefresh);
    const interval = window.setInterval(() => void refresh(), 60_000);
    return () => {
      window.removeEventListener("finalwhistle:fixtures-refreshed", onRefresh);
      window.clearInterval(interval);
    };
  }, [refresh]);

  return (
    <section className="fixture-board" aria-labelledby="fixture-board-title">
      <div className="board-heading">
        <div>
          <p className="eyebrow">Pick your game</p>
          <h3 id="fixture-board-title">Matches to call</h3>
        </div>
        <span className="board-count">{fixtures.length} on deck</span>
      </div>
      <p className="board-status" aria-live="polite">{status}</p>
      {fixtures.length > 0 ? (
        <div className="match-card-grid">
          {fixtures.map((fixture) => <LiveFixtureCard fixture={fixture} key={fixture.id} />)}
        </div>
      ) : (
        <div className="empty-match-board">
          <span className="empty-ball" aria-hidden="true">⚽</span>
          <div>
            <h3>No match on the board right now.</h3>
            <p>The next game will show up here as soon as it&apos;s ready to play.</p>
          </div>
        </div>
      )}
    </section>
  );
}

function LiveFixtureCard({ fixture }: { fixture: FixtureView }) {
  const home = fixture.participant1 ?? "Home";
  const away = fixture.participant2 ?? "Away";
  return (
    <article className="match-card">
      <div className="match-card-top">
        <span>{formatKickoff(fixture.startsAt)}</span>
        <span className={`match-state ${fixture.stale ? "waiting" : "ready"}`}>{fixture.stale ? "Checking update" : "Ready to pick"}</span>
      </div>
      <div className="match-teams">
        <div className="match-team">
          <span className="club-initial club-initial-home">{initial(home)}</span>
          <strong>{home}</strong>
        </div>
        <span className="match-versus">vs</span>
        <div className="match-team">
          <span className="club-initial club-initial-away">{initial(away)}</span>
          <strong>{away}</strong>
        </div>
      </div>
      <p className="match-card-note">{fixture.name ?? "A match worth calling with friends."}</p>
      <Link className="match-open" href={`/fixtures/${encodeURIComponent(fixture.id)}`}>
        Open match <ArrowUpRight size={17} aria-hidden="true" />
      </Link>
    </article>
  );
}

function formatKickoff(value?: string) {
  if (!value) return "Kickoff TBD";
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return "Kickoff TBD";
  return new Intl.DateTimeFormat("en", { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function initial(value: string) {
  return value.trim().slice(0, 1).toUpperCase() || "?";
}
