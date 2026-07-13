import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, CircleDot } from "lucide-react";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Final Whistle — Make match night matter",
  description: "Pick a side, challenge a friend, and let the final whistle settle the score."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <Link className="brand" href="/">
              <span className="brand-mark"><CircleDot size={22} aria-hidden="true" /></span>
              <span>Final Whistle</span>
            </Link>
            <nav className="nav" aria-label="Primary">
              <Link href="/#matches">Matches</Link>
              <Link href="/#how-it-works">How it works</Link>
              <Link href="/portfolio">My picks</Link>
              <Link className="nav-cta" href="/#matches">
                Play now <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            </nav>
          </header>
          <Providers>{children}</Providers>
          <footer className="site-footer">
            <span className="footer-note">Test mode · no real-money play</span>
            <span className="footer-links">
              <Link href="/eligibility">Eligibility</Link> · <Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link>
            </span>
          </footer>
        </div>
      </body>
    </html>
  );
}
