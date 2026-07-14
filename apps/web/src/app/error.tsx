"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="page">
      <section className="nb-card accent-magenta" role="alert">
        <span className="tag">Temporarily unavailable</span>
        <h1>We couldn&apos;t load this part of the board.</h1>
        <p>No wallet action was submitted by this page error. Try the request again, or return to the match board.</p>
        <div className="action-grid">
          <button className="nb-button primary" type="button" onClick={reset}>Try again</button>
          <a className="nb-button" href="/">Back to matches</a>
        </div>
      </section>
    </main>
  );
}
