import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AppWalletButton } from "@/components/app-wallet";
import { SiteFooter } from "@/components/site-footer";
import { optionalPublicOrigin } from "@/lib/public-origin";
import { Providers } from "./providers";
import "@solana/wallet-adapter-react-ui/styles.css";
import "flag-icons/css/flag-icons.min.css";
import "./globals.css";

const metadataBase = optionalPublicOrigin(process.env.PUBLIC_ORIGIN);

export const metadata: Metadata = {
  title: "Final Whistle — Head-to-head football predictions",
  description: "Pick a football result, match the same amount against someone on the opposite side, and let the verified score decide the winner.",
  ...(metadataBase
    ? {
        metadataBase,
        alternates: { canonical: "/" }
      }
    : {}),
  icons: {
    icon: [
      {
        url: "/favicon.png",
        type: "image/png",
        sizes: "1254x1254"
      }
    ],
    shortcut: "/favicon.png",
    apple: [
      {
        url: "/favicon.png",
        type: "image/png",
        sizes: "1254x1254"
      }
    ]
  }
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
                <Image className="brand-logo" src="/favicon.png" alt="" width={28} height={28} priority />
                <span>Final</span><strong>Whistle</strong>
              </Link>
              <nav className="nav" aria-label="Primary">
                <Link href="/matches">Matches</Link>
                <Link href="/challenges">Challenges</Link>
                <Link href="/portfolio">My picks</Link>
              </nav>
              <AppWalletButton />
            </header>
            {children}
            <SiteFooter />
          </Providers>
        </div>
      </body>
    </html>
  );
}
