import bs58 from "bs58";
import nacl from "tweetnacl";
import { z } from "zod";

const signedMessageSchema = z.object({
  domain: z.literal("finalwhistle"),
  action: z.string().min(1),
  wallet: z.string().min(32),
  issuedAt: z.string().datetime(),
  nonce: z.string().min(8).max(128)
});

export type WalletAuthInput = {
  wallet: string;
  action: string;
  signedMessage: string;
  walletSignature: string;
};

export function verifyWalletAuth(input: WalletAuthInput) {
  let messagePayload: unknown;
  try {
    messagePayload = JSON.parse(input.signedMessage);
  } catch {
    throw new Error("Signed message must be valid JSON");
  }
  const parsed = signedMessageSchema.parse(messagePayload);
  if (parsed.wallet !== input.wallet) throw new Error("Signed wallet does not match request wallet");
  if (parsed.action !== input.action) throw new Error("Signed action does not match request action");

  const issuedAt = Date.parse(parsed.issuedAt);
  if (!Number.isFinite(issuedAt)) throw new Error("Invalid signed message timestamp");
  if (Math.abs(Date.now() - issuedAt) > 5 * 60 * 1000) {
    throw new Error("Signed message is expired");
  }

  const signature = decodeSignature(input.walletSignature);
  const publicKey = bs58.decode(input.wallet);
  const message = new TextEncoder().encode(input.signedMessage);

  if (!nacl.sign.detached.verify(message, signature, publicKey)) {
    throw new Error("Invalid wallet signature");
  }

  return parsed;
}

function decodeSignature(signature: string) {
  try {
    return bs58.decode(signature);
  } catch {
    return Uint8Array.from(Buffer.from(signature, "base64"));
  }
}
