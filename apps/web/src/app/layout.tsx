import type { Metadata } from "next";
import Link from "next/link";
import { CircleDot } from "lucide-react";
import { AppWalletButton } from "@/components/app-wallet";
import { Providers } from "./providers";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Final Whistle — Match-night challenges",
  description: "A friendly place to pick a side, share the call, and follow the match through full time."
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <Providers>
            <header className="topbar">
              <Link className="brand" href="/">
                <span className="brand-mark"><CircleDot size={22} aria-hidden="true" /></span>
                <span>Final Whistle</span>
              </Link>
              <nav className="nav" aria-label="Primary">
                <Link href="/matches">Matches</Link>
                <Link href="/challenges">Challenges</Link>
                <Link href="/portfolio">My picks</Link>
                <Link href="/how-it-works">How it works</Link>
              </nav>
              <AppWalletButton />
            </header>
            {children}
            <footer className="site-footer">
              <span className="footer-note">Made for the group chat. Play kindly.</span>
              <span className="footer-links">
                <Link href="/eligibility">Eligibility</Link> · <Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link>
              </span>
            </footer>
          </Providers>
        </div>
      </body>
    </html>
  );
}
