import { PublicKey } from "@solana/web3.js";
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import { verifySignedRequest } from "./auth";
import { config, validateConfig } from "./config";
import {
  defaultPredicateForTemplate,
  type MarketTemplate,
  type Side
} from "./domain";
import {
  consumeIdempotencyKey,
  consumeWalletNonce,
  databaseHealth,
  type DatabaseExecutor,
  getFixtureView,
  getMarket,
  getPositionForWallet,
  insertMarket,
  insertPosition,
  getIdempotencyResponse,
  listAllMarkets,
  listFixtureMarkets,
  listFixtureViews,
  newestFixtureUpdatedAt,
  listWalletPositions,
  recordPositionClaimed,
  recordExpiredCancellation,
  recordJoin,
  recordSettlement,
  upsertFixture,
  withTransaction
} from "./db";
import { assertProofMatchesSettlement } from "./proof";
import { clientIp, requireRateLimit, enterScoreStream } from "./rate-limit";
import {
  buildTxlineCancellationProofPayload,
  buildTxlineSettlementProofPayload,
  deriveMarketPda
} from "./settlement";
import {
  assertOnchainMarketMatchesCreate,
  deriveProgramConfigPda,
  requireConfirmedFinalWhistleInstruction,
  requireOnchainProgramConfig,
  requireOnchainMarketState,
  requireOnchainPositionState
} from "./solana";
import { txline } from "./txline";

const authBodySchema = z.object({
  signedMessage: z.string().min(1),
  walletSignature: z.string().min(64)
});

const solanaPublicKeySchema = z.string().refine((value) => {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}, "Must be a valid Solana public key");

const createMarketSchema = z.object({
  fixtureId: z.string().min(1).max(64),
  creator: solanaPublicKeySchema,
  marketNonce: z.string().regex(/^\d+$/),
  template: z.enum(["MATCH_WINNER", "TOTAL_GOALS_OVER_UNDER"]),
  lockTs: z.string().datetime(),
  tokenMint: solanaPublicKeySchema,
  escrowTokenAccount: solanaPublicKeySchema,
  thresholdMilli: z.number().int().optional(),
  createTxSig: z.string().min(32),
  auth: authBodySchema
});

const joinMarketSchema = z.object({
  userWallet: solanaPublicKeySchema,
  side: z.enum(["YES", "NO"]),
  amount: z.string().regex(/^\d+$/),
  onchainPosition: solanaPublicKeySchema,
  joinTxSig: z.string().min(32),
  auth: authBodySchema
});

const seqProofSchema = z.object({
  wallet: solanaPublicKeySchema,
  seq: z.string().regex(/^\d+$/),
  auth: authBodySchema
});

const settleSchema = z.object({
  wallet: solanaPublicKeySchema,
  seq: z.string().regex(/^\d+$/),
  settleTxSig: z.string().min(32),
  auth: authBodySchema
});

const cancelSchema = z.object({
  wallet: solanaPublicKeySchema,
  seq: z.string().regex(/^\d+$/),
  cancelTxSig: z.string().min(32),
  auth: authBodySchema
});

const cancelExpiredSchema = z.object({
  wallet: solanaPublicKeySchema,
  cancelTxSig: z.string().min(32),
  auth: authBodySchema
});

const claimSchema = z.object({
  wallet: solanaPublicKeySchema,
  positionPda: solanaPublicKeySchema,
  claimTxSig: z.string().min(32),
  auth: authBodySchema
});

export async function health() {
  const configurationReady = hasOperationalConfig();
  const [txlineResult, programConfigResult, databaseResult] = await Promise.allSettled([
    txline.listFixtures(),
    requireOnchainProgramConfig(),
    databaseHealth()
  ]);
  const dependencies = {
    configuration: configurationReady ? "ok" : "unavailable",
    txline: txlineResult.status === "fulfilled" ? "ok" : "unavailable",
    programConfig: programConfigResult.status === "fulfilled" ? "ok" : "unavailable",
    database: databaseResult.status === "fulfilled" ? "ok" : "unavailable"
  };
  const ok = Object.values(dependencies).every((value) => value === "ok");
  return json({ ok, dependencies }, ok ? undefined : { status: 503 });
}

export async function publicConfig() {
  const deploymentConfigured = hasOperationalConfig();
  let programConfigReady = false;
  try {
    await requireOnchainProgramConfig();
    programConfigReady = true;
  } catch {
    // This public endpoint intentionally reports readiness without leaking
    // upstream error details or configuration values.
  }
  return json({
    cluster: config.solanaCluster,
    programId: config.programId,
    txlineProgramId: config.txlineProgramId,
    allowedStakeMints: config.allowedStakeMints,
    deploymentConfigured,
    finalityConfigured: Boolean(config.txlineFinalityStatKey),
    programConfigReady,
    replayEnabled: config.betaReplayFixtureIds.length > 0,
    devnetTokenFaucetUrl: config.devnetTokenFaucetUrl
  });
}

export async function fixtures(request: Request) {
  requireOperationalConfig();
  requireRateLimit({ scope: "fixtures", request });
  const url = new URL(request.url);
  if (url.searchParams.get("mode") === "replay") {
    return json({
      source: "replay",
      stale: true,
      fixtures: config.betaReplayFixtureIds.map((id) => ({
        id,
        name: `Replay fixture ${id}`,
        participant1: "Home",
        participant2: "Away",
        source: "replay",
        stale: true,
        updatedAt: new Date().toISOString()
      }))
    });
  }
  const refresh = await refreshFixtures();
  if (!refresh.ok) return json(refresh.body, { status: refresh.status });
  return json({ source: refresh.source, stale: refresh.stale, fixtures: await listFixtureViews(refresh.source, refresh.stale) });
}

export async function fixtureMarkets(request: Request, params: { fixtureId: string }) {
  requireOperationalConfig();
  requireRateLimit({ scope: "fixtures", request });
  return json({ markets: await listFixtureMarkets(params.fixtureId) });
}

export async function fixtureMarketability(request: Request, params: { fixtureId: string }) {
  requireOperationalConfig();
  requireRateLimit({ scope: "fixtures", request });
  if (config.betaReplayFixtureIds.includes(params.fixtureId)) {
    return json({ marketable: true, source: "replay", stale: true });
  }
  const fixture = await getFixtureView(params.fixtureId);
  if (!fixture) return json({ marketable: false, reason: "Fixture is not available in the TxLINE cache" });
  const fresh = !fixture.stale;
  return json({
    marketable: fresh,
    source: "cache",
    stale: !fresh,
    reason: fresh ? undefined : "Fixture data is stale; refresh live data before creating a market"
  });
}

export async function listMarkets() {
  requireOperationalConfig();
  const [markets, fixtures] = await Promise.all([
    listAllMarkets(),
    listFixtureViews("cache", false)
  ]);
  const fixturesById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  return json({
    markets: markets.map((market) => {
      const replay = config.betaReplayFixtureIds.includes(market.fixtureId);
      const fixture = replay ? undefined : fixturesById.get(market.fixtureId);
      return {
        ...market,
        fixtureName: fixture?.name ?? (replay ? `Replay fixture ${market.fixtureId}` : `Fixture ${market.fixtureId}`),
        stale: replay || !fixture || fixture.stale
      };
    })
  });
}

export async function portfolio(request: Request) {
  requireOperationalConfig();
  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet");
  if (!wallet) throw badRequest("wallet query parameter is required");
  try {
    new PublicKey(wallet);
  } catch {
    throw badRequest("wallet must be a valid Solana public key");
  }
  requireRateLimit({ scope: "fixtures", request, wallet });
  return json({ positions: await listWalletPositions(wallet) });
}

export async function createMarket(request: Request) {
  requireOperationalConfig();
  const body = createMarketSchema.parse(await request.json());
  requireRateLimit({ scope: "write", request, wallet: body.creator });
  const auth = requireSignedRequest({
    request,
    route: "/api/markets",
    wallet: body.creator,
    body
  });

  const replayFixture = config.betaReplayFixtureIds.includes(body.fixtureId);
  const fixture = replayFixture ? undefined : await getFixtureView(body.fixtureId);
  if (!replayFixture && !fixture) throw badRequest("Fixture not found in TxLINE cache");
  if (!replayFixture && fixture?.stale) throw badRequest("Cannot create a market from stale fixture data");

  const tokenMint = new PublicKey(body.tokenMint).toBase58();
  if (!config.allowedStakeMints.includes(tokenMint)) throw badRequest("Stake token mint is not supported");

  const template = body.template as MarketTemplate;
  const predicate = defaultPredicateForTemplate(template, body.thresholdMilli);
  const lockTs = BigInt(Math.floor(Date.parse(body.lockTs) / 1000));
  if (lockTs <= BigInt(Math.floor(Date.now() / 1000))) throw badRequest("Lock time must be in the future");
  const canonicalLockTs = new Date(Number(lockTs) * 1000).toISOString();
  const marketPda = deriveMarketPda({
    creator: body.creator,
    fixtureId: body.fixtureId,
    marketNonce: body.marketNonce
  });
  const programConfig = deriveProgramConfigPda().toBase58();
  await requireConfirmedFinalWhistleInstruction({
    signature: body.createTxSig,
    instruction: "create_market",
    requiredAccounts: [body.creator, programConfig, marketPda, body.escrowTokenAccount, tokenMint]
  });
  await requireOnchainProgramConfig();
  const onchainMarket = await requireOnchainMarketState({
    marketPda,
    expectedStatus: "OPEN"
  });
  try {
    assertOnchainMarketMatchesCreate({
      onchain: onchainMarket,
      creator: body.creator,
      marketNonce: body.marketNonce,
      template,
      predicate,
      lockTs,
      tokenMint,
      escrowTokenAccount: body.escrowTokenAccount
    });
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : "On-chain market does not match request");
  }

  const committed = await commitAuthenticatedWrite({
    request,
    route: "/api/markets",
    auth,
    wallet: body.creator,
    write: async (executor) => {
      const market = await insertMarket({
        id: randomUUID(),
        fixtureId: body.fixtureId,
        creator: body.creator,
        marketPda,
        escrowTokenAccount: onchainMarket.escrowTokenAccount,
        tokenMint: onchainMarket.tokenMint,
        createTxSig: body.createTxSig,
        template,
        predicate,
        lockTs: canonicalLockTs
      }, executor);
      return {
        market,
        onchain: {
          instruction: "create_market",
          marketPda,
          marketNonce: body.marketNonce,
          mode: "CLIENT_SIGNS_AND_ESCROWS_FUNDS"
        }
      };
    }
  });

  return json(committed.response, { status: committed.replayed ? 200 : 201 });
}

export async function getMarketById(_request: Request, params: { marketId: string }) {
  requireOperationalConfig();
  const market = await getMarket(params.marketId);
  if (!market) throw notFound("Market not found");
  return json({ market });
}

export async function joinMarket(request: Request, params: { marketId: string }) {
  requireOperationalConfig();
  const market = await getMarket(params.marketId);
  if (!market) throw notFound("Market not found");
  if (market.status !== "OPEN") throw badRequest("Market is not open");

  const body = joinMarketSchema.parse(await request.json());
  requireRateLimit({ scope: "write", request, wallet: body.userWallet });
  const auth = requireSignedRequest({
    request,
    route: "/api/markets/[marketId]/join",
    params,
    wallet: body.userWallet,
    body
  });

  const side = body.side as Side;
  const oppositeStake = side === "YES" ? market.noStake : market.yesStake;
  if (oppositeStake !== "0" && oppositeStake !== body.amount) throw badRequest("Direct challenge stakes must match");
  if (!market.marketPda) throw badRequest("Market is missing on-chain PDA");

  await requireConfirmedFinalWhistleInstruction({
    signature: body.joinTxSig,
    instruction: "join_market",
    requiredAccounts: [body.userWallet, market.marketPda, body.onchainPosition]
  });
  const onchainPosition = await requireOnchainPositionState({
    positionPda: body.onchainPosition,
    expectedMarket: market.marketPda,
    expectedUser: body.userWallet,
    expectedSide: side,
    expectedAmount: body.amount
  });
  const onchainMarket = await requireOnchainMarketState({
    marketPda: market.marketPda,
    expectedStatus: onchainPosition.side === "YES" && market.noStake === body.amount ? "LOCKED" : onchainPosition.side === "NO" && market.yesStake === body.amount ? "LOCKED" : "OPEN"
  });

  const committed = await commitAuthenticatedWrite({
    request,
    route: "/api/markets/[marketId]/join",
    auth,
    wallet: body.userWallet,
    write: async (executor) => {
      await insertPosition({
        id: randomUUID(),
        marketId: market.id,
        userWallet: onchainPosition.user,
        side,
        amount: onchainPosition.amount,
        onchainPosition: body.onchainPosition
      }, executor);
      await recordJoin(market.id, side, body.amount, onchainMarket.status, body.joinTxSig, executor);
      return {
        market: await getMarket(market.id, executor),
        onchain: {
          instruction: "join_market",
          mode: "CLIENT_SIGNS_TOKEN_TRANSFER_TO_ESCROW"
        }
      };
    }
  });
  return json(committed.response);
}

export async function settlementProof(request: Request, params: { marketId: string }) {
  requireOperationalConfig();
  const market = await getMarket(params.marketId);
  if (!market) throw notFound("Market not found");
  if (market.status !== "LOCKED") throw badRequest("Market is not locked");
  if (!market.marketPda) throw badRequest("Market is missing on-chain PDA");

  const body = seqProofSchema.parse(await request.json());
  requireRateLimit({ scope: "proof", request, wallet: body.wallet });
  requireSignedRequest({ request, route: "/api/markets/[marketId]/settlement-proof", params, wallet: body.wallet, body });
  if (!config.txlineFinalityStatKey) throw serviceUnavailable("TXLINE_FINALITY_STAT_KEY is required for settlement");
  await requireOnchainProgramConfig();

  const outcomeProof = await txline.getStatValidation({
    fixtureId: market.fixtureId,
    seq: body.seq,
    statKey: market.predicate.statKey1,
    statKey2: market.predicate.statKey2
  });
  const finalityProof = await txline.getStatValidation({
    fixtureId: market.fixtureId,
    seq: body.seq,
    statKey: config.txlineFinalityStatKey
  });
  assertProofMatchesSettlement({
    proof: outcomeProof.raw,
    fixtureId: market.fixtureId,
    seq: body.seq,
    statKey1: market.predicate.statKey1,
    statKey2: market.predicate.statKey2
  });
  assertProofMatchesSettlement({
    proof: finalityProof.raw,
    fixtureId: market.fixtureId,
    seq: body.seq,
    statKey1: config.txlineFinalityStatKey
  });

  return json({
    market,
    settlement: buildTxlineSettlementProofPayload({
      market,
      seq: body.seq,
      outcomeProof: outcomeProof.raw,
      finalityProof: finalityProof.raw
    })
  });
}

export async function cancellationProof(request: Request, params: { marketId: string }) {
  requireOperationalConfig();
  const market = await getMarket(params.marketId);
  if (!market) throw notFound("Market not found");
  if (market.status !== "OPEN" && market.status !== "LOCKED") throw badRequest("Market is not cancellable");
  if (!market.marketPda) throw badRequest("Market is missing on-chain PDA");

  const body = seqProofSchema.parse(await request.json());
  requireRateLimit({ scope: "proof", request, wallet: body.wallet });
  requireSignedRequest({ request, route: "/api/markets/[marketId]/cancellation-proof", params, wallet: body.wallet, body });
  if (!config.txlineFinalityStatKey) throw serviceUnavailable("TXLINE_FINALITY_STAT_KEY is required for cancellation");
  await requireOnchainProgramConfig();

  const cancellationProof = await txline.getStatValidation({
    fixtureId: market.fixtureId,
    seq: body.seq,
    statKey: config.txlineFinalityStatKey
  });
  assertProofMatchesSettlement({
    proof: cancellationProof.raw,
    fixtureId: market.fixtureId,
    seq: body.seq,
    statKey1: config.txlineFinalityStatKey
  });

  return json({
    market,
    cancellation: buildTxlineCancellationProofPayload({
      market,
      seq: body.seq,
      cancellationProof: cancellationProof.raw
    })
  });
}

export async function settleMarket(request: Request, params: { marketId: string }) {
  requireOperationalConfig();
  const market = await getMarket(params.marketId);
  if (!market) throw notFound("Market not found");
  if (market.status !== "LOCKED") throw badRequest("Market is not locked");
  if (!market.marketPda) throw badRequest("Market is missing on-chain PDA");

  const body = settleSchema.parse(await request.json());
  requireRateLimit({ scope: "write", request, wallet: body.wallet });
  const auth = requireSignedRequest({ request, route: "/api/markets/[marketId]/settle", params, wallet: body.wallet, body });
  const programConfig = deriveProgramConfigPda().toBase58();
  await requireConfirmedFinalWhistleInstruction({
    signature: body.settleTxSig,
    instruction: "settle_market",
    requiredAccounts: [programConfig, market.marketPda]
  });
  await requireOnchainProgramConfig();
  const onchainMarket = await requireOnchainMarketState({
    marketPda: market.marketPda,
    expectedStatus: "SETTLED",
    expectedSeq: body.seq
  });
  const committed = await commitAuthenticatedWrite({
    request,
    route: "/api/markets/[marketId]/settle",
    auth,
    wallet: body.wallet,
    write: async (executor) => {
      await recordSettlement({
        marketId: market.id,
        status: "SETTLED",
        winningSide: onchainMarket.winningSide,
        txlineSeq: body.seq,
        proofHash: onchainMarket.proofHash,
        settleTxSig: body.settleTxSig,
        rawProof: { settlementTxSig: body.settleTxSig, onchainMarket }
      }, executor);
      return {
        market: await getMarket(market.id, executor),
        settlement: {
          mode: "VALIDATED_ON_CHAIN_BY_TXLINE",
          txlineSeq: body.seq,
          proofHash: onchainMarket.proofHash,
          winningSide: onchainMarket.winningSide,
          settlementTxSig: body.settleTxSig
        }
      };
    }
  });
  return json(committed.response);
}

export async function cancelMarket(request: Request, params: { marketId: string }) {
  requireOperationalConfig();
  const market = await getMarket(params.marketId);
  if (!market) throw notFound("Market not found");
  if (market.status !== "OPEN" && market.status !== "LOCKED") throw badRequest("Market is not cancellable");
  if (!market.marketPda) throw badRequest("Market is missing on-chain PDA");

  const body = cancelSchema.parse(await request.json());
  requireRateLimit({ scope: "write", request, wallet: body.wallet });
  const auth = requireSignedRequest({ request, route: "/api/markets/[marketId]/cancel", params, wallet: body.wallet, body });
  const programConfig = deriveProgramConfigPda().toBase58();
  await requireConfirmedFinalWhistleInstruction({
    signature: body.cancelTxSig,
    instruction: "cancel_market",
    requiredAccounts: [programConfig, market.marketPda]
  });
  await requireOnchainProgramConfig();
  const onchainMarket = await requireOnchainMarketState({
    marketPda: market.marketPda,
    expectedStatus: "CANCELLED",
    expectedSeq: body.seq
  });
  const committed = await commitAuthenticatedWrite({
    request,
    route: "/api/markets/[marketId]/cancel",
    auth,
    wallet: body.wallet,
    write: async (executor) => {
      await recordSettlement({
        marketId: market.id,
        status: "CANCELLED",
        txlineSeq: body.seq,
        proofHash: onchainMarket.proofHash,
        settleTxSig: body.cancelTxSig,
        rawProof: { cancelTxSig: body.cancelTxSig, onchainMarket }
      }, executor);
      return { market: await getMarket(market.id, executor) };
    }
  });
  return json(committed.response);
}

export async function cancelExpiredMarket(request: Request, params: { marketId: string }) {
  requireOperationalConfig();
  const market = await getMarket(params.marketId);
  if (!market) throw notFound("Market not found");
  if (market.status !== "OPEN" && market.status !== "LOCKED") throw badRequest("Market is not cancellable");
  if (!market.marketPda) throw badRequest("Market is missing on-chain PDA");

  const body = cancelExpiredSchema.parse(await request.json());
  requireRateLimit({ scope: "write", request, wallet: body.wallet });
  const auth = requireSignedRequest({ request, route: "/api/markets/[marketId]/cancel-expired", params, wallet: body.wallet, body });
  await requireConfirmedFinalWhistleInstruction({
    signature: body.cancelTxSig,
    instruction: "cancel_expired_market",
    requiredAccounts: [market.marketPda]
  });
  const onchainMarket = await requireOnchainMarketState({
    marketPda: market.marketPda,
    expectedStatus: "CANCELLED"
  });
  const committed = await commitAuthenticatedWrite({
    request,
    route: "/api/markets/[marketId]/cancel-expired",
    auth,
    wallet: body.wallet,
    write: async (executor) => {
      await recordExpiredCancellation({
        marketId: market.id,
        cancelTxSig: body.cancelTxSig,
        txlineSeq: onchainMarket.txlineSeq,
        proofHash: onchainMarket.proofHash
      }, executor);
      return {
        market: await getMarket(market.id, executor),
        cancellation: {
          mode: "EXPIRED_ON_CHAIN",
          txlineSeq: onchainMarket.txlineSeq,
          proofHash: onchainMarket.proofHash,
          cancelTxSig: body.cancelTxSig
        }
      };
    }
  });
  return json(committed.response);
}

export async function claimPayout(request: Request, params: { marketId: string }) {
  requireOperationalConfig();
  const market = await getMarket(params.marketId);
  if (!market) throw notFound("Market not found");
  if (market.status !== "SETTLED" && market.status !== "CANCELLED") throw badRequest("Market is not claimable");
  if (!market.marketPda) throw badRequest("Market is missing on-chain PDA");

  const body = claimSchema.parse(await request.json());
  requireRateLimit({ scope: "write", request, wallet: body.wallet });
  const auth = requireSignedRequest({ request, route: "/api/markets/[marketId]/claim", params, wallet: body.wallet, body });

  const position = await getPositionForWallet({ marketId: market.id, userWallet: body.wallet });
  if (!position?.onchainPosition) throw badRequest("Position not found for connected wallet");
  if (position.onchainPosition !== new PublicKey(body.positionPda).toBase58()) {
    throw badRequest("Claim position does not match indexed position");
  }

  await requireConfirmedFinalWhistleInstruction({
    signature: body.claimTxSig,
    instruction: "claim_payout",
    requiredAccounts: [body.wallet, market.marketPda, position.onchainPosition]
  });
  await requireOnchainPositionState({
    positionPda: position.onchainPosition,
    expectedMarket: market.marketPda,
    expectedUser: body.wallet,
    expectedSide: position.side,
    expectedAmount: position.amount,
    expectedClaimed: true
  });
  const committed = await commitAuthenticatedWrite({
    request,
    route: "/api/markets/[marketId]/claim",
    auth,
    wallet: body.wallet,
    write: async (executor) => {
      await recordPositionClaimed({ marketId: market.id, userWallet: body.wallet }, executor);
      return {
        market: await getMarket(market.id, executor),
        position: await getPositionForWallet({ marketId: market.id, userWallet: body.wallet }, executor)
      };
    }
  });
  return json(committed.response);
}

export async function marketProof(_request: Request, params: { marketId: string }) {
  requireOperationalConfig();
  const market = await getMarket(params.marketId);
  if (!market) throw notFound("Market not found");
  return json({
    receipt: {
      fixtureId: market.fixtureId,
      template: market.template,
      predicate: market.predicate,
      status: market.status,
      winningSide: market.winningSide,
      txlineSeq: market.txlineSeq,
      proofHash: market.proofHash,
      settlementMode: "Proof validated on-chain by TxLINE"
    },
    rawProofAvailable: Boolean(market.rawProof)
  });
}

export async function scoreStream(request: Request) {
  requireOperationalConfig();
  const url = new URL(request.url);
  const fixtureId = url.searchParams.get("fixtureId");
  if (!fixtureId || fixtureId.length > 64) throw badRequest("A valid fixtureId is required for score streaming");
  requireRateLimit({ scope: "stream", request });
  const replayFixture = config.betaReplayFixtureIds.includes(fixtureId);
  const fixture = replayFixture ? undefined : await getFixtureView(fixtureId);
  if (!replayFixture && (!fixture || fixture.stale)) {
    throw badRequest("Fixture is not available for live score streaming");
  }
  const leave = enterScoreStream(fixtureId, clientIp(request));
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      heartbeat = setInterval(() => send("heartbeat", { ts: new Date().toISOString() }), 15_000);
      void (async () => {
        try {
          for await (const event of txline.normalizedScoreStream(fixtureId)) {
            if (request.signal.aborted) break;
            send("score", event);
          }
        } catch {
          send("error", { message: "score stream failed" });
        } finally {
          if (heartbeat) clearInterval(heartbeat);
          leave();
          controller.close();
        }
      })();
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      leave();
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    }
  });
}

export function handleApiError(error: unknown) {
  if (error instanceof ZodError) {
    return json({
      statusCode: 400,
      error: "Bad Request",
      message: "Invalid request body",
      issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message }))
    }, { status: 400 });
  }
  const status = typeof (error as { statusCode?: unknown })?.statusCode === "number"
    ? (error as { statusCode: number }).statusCode
    : error instanceof Error && error.message === "Not found"
      ? 404
      : 500;
  const message = status >= 500
    ? "The service could not complete this request. Please try again shortly."
    : error instanceof Error
      ? error.message
      : "Invalid request";
  if (status >= 500) {
    return json({ statusCode: status, error: "Internal Server Error", message }, { status });
  }
  return json({ statusCode: status, error: status === 404 ? "Not Found" : "Bad Request", message }, { status });
}

function requireSignedRequest(input: {
  request: Request;
  route: string;
  params?: Record<string, unknown>;
  wallet: string;
  body: Record<string, unknown> & { auth: { signedMessage: string; walletSignature: string } };
}) {
  const idempotencyKey = input.request.headers.get("idempotency-key") ?? "";
  if (!idempotencyKey) throw badRequest("Idempotency-Key header is required");
  try {
    return verifySignedRequest({
      wallet: input.wallet,
      route: input.route,
      method: "POST",
      params: input.params,
      body: input.body,
      idempotencyKey,
      signedMessage: input.body.auth.signedMessage,
      walletSignature: input.body.auth.walletSignature
    });
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : "Invalid signed request");
  }
}

async function commitAuthenticatedWrite<T>(input: {
  request: Request;
  route: string;
  wallet: string;
  auth: ReturnType<typeof verifySignedRequest>;
  write: (executor: DatabaseExecutor) => Promise<T>;
}) {
  const key = input.request.headers.get("idempotency-key");
  if (!key) throw badRequest("Idempotency-Key header is required");

  return withTransaction(async (executor) => {
    if (config.requireIdempotencyKeys) {
      const prior = await getIdempotencyResponse({
        key,
        route: input.route,
        wallet: input.wallet,
        requestHash: input.auth.requestHash
      }, executor);
      if (prior.found) return { replayed: true as const, response: prior.response as T };
    }

    try {
      await consumeWalletNonce({
        wallet: input.auth.wallet,
        action: input.auth.route,
        nonce: input.auth.nonce,
        issuedAt: input.auth.issuedAt
      }, executor);
    } catch (error) {
      throw badRequest(error instanceof Error ? error.message : "Signed message nonce has already been used");
    }

    const response = await input.write(executor);
    if (config.requireIdempotencyKeys) {
      await consumeIdempotencyKey({
        key,
        route: input.route,
        wallet: input.wallet,
        requestHash: input.auth.requestHash,
        response
      }, executor);
    }
    return { replayed: false as const, response };
  });
}

async function refreshFixtures(): Promise<
  | { ok: true; source: "txline" | "cache"; stale: boolean }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  try {
    const fixtures = await txline.listFixtures();
    await withTransaction(async (executor) => {
      for (const fixture of fixtures) {
        const normalized = normalizeFixture(fixture);
        if (!normalized.id) continue;
        await upsertFixture({ ...normalized, id: normalized.id }, executor);
      }
    });
    return { ok: true, source: "txline", stale: false };
  } catch {
    const newest = await newestFixtureUpdatedAt();
    const tooOld = !newest || Date.now() - newest > config.fixtureCacheMaxAgeMs;
    if (tooOld) {
      return {
        ok: false,
        status: 503,
        body: {
          statusCode: 503,
          error: "Service Unavailable",
          message: "TxLINE refresh failed and cached fixtures are stale"
        }
      };
    }
    return { ok: true, source: "cache", stale: true };
  }
}

function normalizeFixture(input: unknown) {
  const fixture = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  return {
    id: firstString(fixture, ["fixtureId", "fixture_id", "id", "matchId"]),
    name: firstString(fixture, ["name", "fixtureName", "matchName"]),
    startsAt: firstString(fixture, ["startsAt", "startTime", "kickoff", "scheduledAt"]),
    participant1: firstString(fixture, ["participant1", "homeTeam", "teamA", "competitor1"]),
    participant2: firstString(fixture, ["participant2", "awayTeam", "teamB", "competitor2"]),
    raw: fixture
  };
}

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function json(body: unknown, init?: ResponseInit) {
  return Response.json(body, {
    ...init,
    headers: {
      "cache-control": "no-store",
      ...init?.headers
    }
  });
}

function badRequest(message: string) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function notFound(message: string) {
  return Object.assign(new Error(message), { statusCode: 404 });
}

function serviceUnavailable(message: string) {
  return Object.assign(new Error(message), { statusCode: 503 });
}

function hasOperationalConfig() {
  try {
    validateConfig();
    return true;
  } catch {
    return false;
  }
}

function requireOperationalConfig() {
  if (!hasOperationalConfig()) throw serviceUnavailable("The beta deployment is not fully configured");
}
