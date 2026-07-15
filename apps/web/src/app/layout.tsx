import type { Metadata } from "next";
import Link from "next/link";
import { CircleDot } from "lucide-react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AppWalletButton } from "@/components/app-wallet";
import { Providers } from "./providers";
import "@solana/wallet-adapter-react-ui/styles.css";
import "flag-icons/css/flag-icons.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Final Whistle — Match-night challenges",
  description: "A friendly place to pick a side, share the call, and follow the match through full time."
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
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
              </nav>
              <AppWalletButton />
            </header>
            {children}
            <footer className="site-footer">
              <span className="footer-note">Devnet beta · Test tokens have no cash value</span>
              <span className="footer-links">
                <Link href="/how-it-works">How it works</Link> · <Link href="/eligibility">Eligibility</Link> · <Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link>
              </span>
            </footer>
          </Providers>
        </div>
      </body>
    </html>
  );
}
