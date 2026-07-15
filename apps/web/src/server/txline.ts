import { createHash } from "node:crypto";
import { config } from "./config";

type GuestSession = {
  jwt: string;
  expiresAt: number;
};

let guestSession: GuestSession | undefined;

export class TxlineClient {
  async listFixtures(): Promise<unknown[]> {
    // TxLINE's current Devnet fixture feed lives under /fixtures. The former
    // /scores/schedule route was removed, which made every refresh fail with a
    // 404 even when the deployment had valid credentials.
    const snapshot = await this.requestJson<unknown>("/fixtures/snapshot");
    if (Array.isArray(snapshot)) return snapshot;
    if (snapshot && typeof snapshot === "object") {
      const payload = snapshot as { fixtures?: unknown[]; data?: unknown[]; items?: unknown[] };
      if (Array.isArray(payload.fixtures)) return payload.fixtures;
      if (Array.isArray(payload.data)) return payload.data;
      if (Array.isArray(payload.items)) return payload.items;
    }
    return [];
  }

  async getSnapshot(fixtureId: string, asOf?: string): Promise<unknown> {
    const search = new URLSearchParams();
    if (asOf) search.set("asOf", asOf);
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return this.requestJson(`/scores/snapshot/${encodeURIComponent(fixtureId)}${suffix}`);
  }

  async getHistorical(fixtureId: string): Promise<unknown> {
    return this.requestJson(`/scores/historical/${encodeURIComponent(fixtureId)}`);
  }

  async getStatValidation(input: {
    fixtureId: string;
    seq: string;
    statKey: number;
    statKey2?: number;
  }): Promise<{ raw: unknown; proofHash: string }> {
    const search = new URLSearchParams({
      fixtureId: input.fixtureId,
      seq: input.seq,
      statKey: String(input.statKey)
    });
    if (input.statKey2 !== undefined) search.set("statKey2", String(input.statKey2));

    const raw = await this.requestJson(`/scores/stat-validation?${search.toString()}`);
    return { raw, proofHash: proofHash(raw) };
  }

  private async requestJson<T>(path: string): Promise<T> {
    const response = await fetch(`${config.txlineApiBaseUrl}${path}`, {
      headers: await this.headers(),
      signal: AbortSignal.timeout(config.upstreamTimeoutMs),
      cache: "no-store"
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`TxLINE request failed ${response.status}: ${body}`);
    }
    return (await response.json()) as T;
  }

  private async headers(): Promise<Record<string, string>> {
    const jwt = await getGuestJwt();
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${jwt}`
    };
    if (config.txlineApiToken) headers["x-api-token"] = config.txlineApiToken;
    return headers;
  }
}

async function getGuestJwt(): Promise<string> {
  if (guestSession && guestSession.expiresAt - 30_000 > Date.now()) {
    return guestSession.jwt;
  }

  const response = await fetch(`${config.txlineGuestBaseUrl}/auth/guest/start`, {
    method: "POST",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(config.upstreamTimeoutMs),
    cache: "no-store"
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`TxLINE guest auth failed ${response.status}: ${body}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const jwt = String(payload.jwt ?? payload.token ?? payload.accessToken ?? "");
  if (!jwt) throw new Error("TxLINE guest auth response did not include a JWT");

  const expiresInSeconds = Number(payload.expiresIn ?? payload.expires_in ?? 900);
  guestSession = {
    jwt,
    expiresAt: Date.now() + expiresInSeconds * 1000
  };
  return jwt;
}

export function proofHash(raw: unknown): string {
  return createHash("sha256").update(JSON.stringify(raw)).digest("hex");
}

export const txline = new TxlineClient();
