"use client";

import { useEffect, useState } from "react";
import { Radio } from "lucide-react";

export function ScoreTicker({ fixtureId }: { fixtureId?: string }) {
  const [detail, setDetail] = useState(
    fixtureId ? "Keeping an eye on this match…" : "Choose a match and its live moments will show up here."
  );

  useEffect(() => {
    if (!fixtureId) return;
    const stream = new EventSource(`/api/stream/scores?fixtureId=${encodeURIComponent(fixtureId)}`);
    const onScore = (event: Event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as Record<string, unknown>;
        const phase = typeof payload.phase === "string" ? payload.phase : "score update";
        setDetail(matchMoment(phase));
      } catch {
        setDetail("A live match update just landed.");
      }
    };
    const onStreamError = () => setDetail("Still following along—updates will be back in a moment.");
    stream.addEventListener("score", onScore);
    stream.addEventListener("error", onStreamError);
    stream.onerror = onStreamError;
    return () => {
      stream.removeEventListener("score", onScore);
      stream.removeEventListener("error", onStreamError);
      stream.close();
    };
  }, [fixtureId]);

  return (
    <div className="ticker" aria-live="polite">
      <Radio size={18} aria-hidden="true" />
      <span>MATCH PULSE</span>
      <span className="mono">{detail}</span>
    </div>
  );
}

function matchMoment(phase: string) {
  const normalized = phase.toUpperCase();
  if (["F", "FET", "FPE"].includes(normalized)) return "Full time is in. The result is being checked.";
  if (["HT", "H1", "H2"].includes(normalized)) return normalized === "HT" ? "Half-time. Time to defend your call." : "The match is moving—keep cheering.";
  if (["I", "A", "C", "P"].includes(normalized)) return "This match has paused. We’ll wait for a clear final result.";
  return "A live match update just landed.";
}
