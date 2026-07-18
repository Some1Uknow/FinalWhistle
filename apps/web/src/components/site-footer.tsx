"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SiteFooter() {
  const pathname = usePathname();
  const note = pathname === "/"
    ? "Football challenges · One call, two sides"
    : "Devnet beta · Devnet SOL has no cash value";

  return (
    <footer className="site-footer">
      <span className="footer-note">{note}</span>
      <span className="footer-links">
        <Link href="/how-it-works">How it works</Link> · <Link href="/eligibility">Eligibility</Link> · <Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link>
      </span>
    </footer>
  );
}
