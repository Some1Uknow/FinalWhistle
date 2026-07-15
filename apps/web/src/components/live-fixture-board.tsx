"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { CountryFlag } from "@/components/country-flag";
import type { FixtureView } from "@/server/db";

export function LiveFixtureBoard({ initialFixtures }: { initialFixtures: FixtureView[] }) {
  const [fixtures, setFixtures] = useState(initialFixtures);
  const [status, setStatus] = useState(initialFixtures.length ? `${initialFixtures.length} fixtures available.` : "Loading matches…");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/fixtures");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Fixtures are unavailable");
      setFixtures(payload.fixtures ?? []);
      const count = payload.fixtures?.length ?? 0;
      setStatus(count ? `${count} ${count === 1 ? "fixture" : "fixtures"} available.` : "No upcoming matches in the feed.");
    } catch {
      setStatus("The match board couldn't refresh just now. Try again in a moment.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    return () => {
      window.clearInterval(interval);
    };
  }, [refresh]);

  return (
    <section className="fixture-board" aria-labelledby="fixture-board-title">
      <div className="board-heading">
        <div>
          <h2 id="fixture-board-title">Match board</h2>
        </div>
        <div className="fixture-board-actions">
          <span className="board-count">{fixtures.length}</span>
          <button className="nb-button" type="button" onClick={() => void refresh()}>Refresh</button>
        </div>
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
            <h3>No fixtures available</h3>
            <p>Check again shortly.</p>
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
          <CountryFlag name={home} fallbackClassName="club-initial-home" />
          <strong>{home}</strong>
        </div>
        <span className="match-versus">vs</span>
        <div className="match-team">
          <CountryFlag name={away} fallbackClassName="club-initial-away" />
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
