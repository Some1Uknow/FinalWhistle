import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page">
      <section className="nb-card accent-magenta">
        <span className="tag">Off the pitch</span>
        <h1>This match has gone missing.</h1>
        <p>It may have finished, been called off, or simply not be on the board anymore.</p>
        <Link className="nb-button" href="/">Back to matches</Link>
      </section>
    </main>
  );
}
