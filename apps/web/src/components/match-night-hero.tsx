import Link from "next/link";

export function MatchNightHero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <p className="eyebrow">Head-to-head football predictions</p>
        <h1 id="hero-title">Head to Head markets for those who like fun.</h1>
        <p className="hero-blurb">You both put in the same amount. After the match, the verified result decides who gets the pot.</p>
        <div className="hero-actions">
          <Link className="hero-button" href="/matches">Pick a match</Link>
          <Link className="hero-link" href="/challenges">See open challenges</Link>
        </div>
      </div>
      <div className="hero-example" aria-label="Example football challenge">
        <p>Simple example</p>
        <h2>Will Spain win?</h2>
        <div className="hero-example-side hero-example-you">
          <span>You pick</span>
          <strong>Yes, Spain wins</strong>
        </div>
        <div className="hero-example-side hero-example-them">
          <span>Someone else picks</span>
          <strong>No, Spain draws or loses</strong>
        </div>
        <p className="hero-example-result">Same amount on both sides. Winner gets the pot.</p>
      </div>
    </section>
  );
}
