export default function Loading() {
  return (
    <main className="page" aria-busy="true">
      <div className="board-loading" role="status" aria-live="polite">
        <span className="board-loading-pulse" aria-hidden="true" />
        <span>Loading the match board…</span>
      </div>
    </main>
  );
}
