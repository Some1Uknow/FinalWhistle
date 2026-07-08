import bs58 from "bs58";
import nacl from "tweetnacl";
import { createHash } from "node:crypto";
import { z } from "zod";
import { config } from "./config";
import { BETA_TERMS_VERSION } from "@/lib/legal";

export const signedRequestMessageSchema = z.object({
  domain: z.literal("finalwhistle"),
  version: z.literal(2),
  cluster: z.literal("devnet"),
  programId: z.string().min(32),
  route: z.string().min(1),
  method: z.literal("POST"),
  wallet: z.string().min(32),
  issuedAt: z.string().datetime(),
  nonce: z.string().min(8).max(128),
  idempotencyKey: z.string().min(8).max(256),
  termsVersion: z.literal(BETA_TERMS_VERSION),
  termsAcceptedAt: z.string().datetime(),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/)
});

export type SignedRequestMessage = z.infer<typeof signedRequestMessageSchema>;

export type RequestAuthInput = {
  wallet: string;
  route: string;
  method: "POST";
  params?: Record<string, unknown>;
  body: Record<string, unknown>;
  idempotencyKey: string;
  signedMessage: string;
  walletSignature: string;
};

export function verifySignedRequest(input: RequestAuthInput): SignedRequestMessage {
  let messagePayload: unknown;
  try {
    messagePayload = JSON.parse(input.signedMessage);
  } catch {
    throw new Error("Signed message must be valid JSON");
  }

  const parsed = signedRequestMessageSchema.parse(messagePayload);
  if (parsed.wallet !== input.wallet) throw new Error("Signed wallet does not match request wallet");
  if (parsed.route !== input.route) throw new Error("Signed route does not match request route");
  if (parsed.method !== input.method) throw new Error("Signed method does not match request method");
  if (parsed.programId !== config.programId) throw new Error("Signed program ID does not match server program ID");
  if (parsed.cluster !== config.solanaCluster) throw new Error("Signed cluster does not match server cluster");
  if (parsed.idempotencyKey !== input.idempotencyKey) {
    throw new Error("Signed idempotency key does not match request header");
  }

  const expectedHash = requestHash({
    params: input.params ?? {},
    body: stripAuth(input.body)
  });
  if (parsed.requestHash !== expectedHash) throw new Error("Signed request hash does not match request body");

  const issuedAt = Date.parse(parsed.issuedAt);
  if (!Number.isFinite(issuedAt)) throw new Error("Invalid signed message timestamp");
  if (Math.abs(Date.now() - issuedAt) > 5 * 60 * 1000) {
    throw new Error("Signed message is expired");
  }
  const termsAcceptedAt = Date.parse(parsed.termsAcceptedAt);
  if (!Number.isFinite(termsAcceptedAt) || termsAcceptedAt > issuedAt) {
    throw new Error("Signed message does not contain a valid beta terms acknowledgement");
  }

  const signature = decodeSignature(input.walletSignature);
  const publicKey = bs58.decode(input.wallet);
  const message = new TextEncoder().encode(input.signedMessage);

  if (!nacl.sign.detached.verify(message, signature, publicKey)) {
    throw new Error("Invalid wallet signature");
  }

  return parsed;
}

export function requestHash(input: { params?: Record<string, unknown>; body?: unknown }) {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

export function stripAuth<T>(body: T): T {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const { auth: _auth, signedMessage: _signedMessage, walletSignature: _walletSignature, ...rest } =
    body as Record<string, unknown>;
  return rest as T;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, sortValue(entry)])
  );
}

function decodeSignature(signature: string) {
  try {
    return bs58.decode(signature);
  } catch {
    return Uint8Array.from(Buffer.from(signature, "base64"));
  }
}
