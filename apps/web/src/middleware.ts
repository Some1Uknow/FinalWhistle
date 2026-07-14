import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const rpcSources = configuredRpcSources();
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'self' https://connect.solflare.com",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' https://api.devnet.solana.com https://*.solana.com wss://*.solana.com https://*.helius-rpc.com wss://*.helius-rpc.com ${rpcSources.join(" ")}`,
    "worker-src 'self' blob:",
    ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : [])
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

function configuredRpcSources() {
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  if (!endpoint) return [];
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && url.protocol !== "http:") return [];
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return [];
    const websocketProtocol = url.protocol === "https:" ? "wss:" : "ws:";
    return [...new Set([url.origin, `${websocketProtocol}//${url.host}`])];
  } catch {
    return [];
  }
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" }
      ]
    }
  ]
};
