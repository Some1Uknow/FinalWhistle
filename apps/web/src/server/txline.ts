import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { config } from "./config";
import { normalizeScoreEvent } from "./domain";

type GuestSession = {
  jwt: string;
  expiresAt: number;
};

let guestSession: GuestSession | undefined;

export class TxlineClient {
  async listFixtures(): Promise<unknown[]> {
    const schedule = await this.requestJson<unknown>("/scores/schedule");
    if (Array.isArray(schedule)) return schedule;
    if (schedule && typeof schedule === "object") {
      const payload = schedule as { fixtures?: unknown[]; data?: unknown[]; items?: unknown[] };
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

  async openScoreStream(fixtureId?: string): Promise<ReadableStream<Uint8Array>> {
    const search = new URLSearchParams();
    if (fixtureId) search.set("fixtureId", fixtureId);
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    const response = await fetch(`${config.txlineApiBaseUrl}/scores/stream${suffix}`, {
      headers: await this.headers()
    });
    if (!response.ok || !response.body) {
      throw new Error(`TxLINE stream failed with ${response.status}`);
    }
    return response.body;
  }

  async *normalizedScoreStream(fixtureId?: string): AsyncGenerator<Record<string, unknown>> {
    const body = await this.openScoreStream(fixtureId);
    const nodeStream = Readable.fromWeb(body as never);
    let buffer = "";

    for await (const chunk of nodeStream) {
      buffer += Buffer.from(chunk).toString("utf8");
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        const dataLines = event
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim());
        if (dataLines.length === 0) continue;

        const data = dataLines.join("\n");
        try {
          yield normalizeScoreEvent(JSON.parse(data));
        } catch {
          yield normalizeScoreEvent({ data });
        }
      }
    }
  }

  private async requestJson<T>(path: string): Promise<T> {
    const response = await fetch(`${config.txlineApiBaseUrl}${path}`, {
      headers: await this.headers()
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
      accept: "application/json, text/event-stream",
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
    headers: { accept: "application/json" }
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
