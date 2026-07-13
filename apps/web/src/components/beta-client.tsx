"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import {
  ExternalLink,
  RefreshCw,
  Wallet
} from "lucide-react";
import type { FixtureView } from "@/server/db";
import type { MarketRecord, MarketTemplate, Side } from "@/server/domain";
import {
  buildCancelExpiredIx,
  buildClaimIx,
  buildCreateMarketIx,
  buildJoinMarketIx,
  buildProofIx,
  type PublicConfig,
  type TxlineProofPayload
} from "@/client/finalwhistle";
import { BETA_TERMS_STORAGE_KEY, BETA_TERMS_VERSION } from "@/lib/legal";

const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const DEVNET_USDT = "ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh";

export function WalletPanel({ latestSignature }: { latestSignature?: string }) {
  const wallet = useWallet();
  const { connection } = useConnection();
  const { config, refresh } = usePublicConfig();
  const [sol, setSol] = useState<string>("...");
  const [termsAcceptedAt, setTermsAcceptedAt] = useState<string>();

  useEffect(() => {
    setTermsAcceptedAt(window.localStorage.getItem(BETA_TERMS_STORAGE_KEY) ?? undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!wallet.publicKey) {
      setSol("0");
      return;
    }
    connection.getBalance(wallet.publicKey).then((balance) => {
      if (!cancelled) setSol((balance / 1_000_000_000).toFixed(3));
    }).catch(() => {
      if (!cancelled) setSol("unavailable");
    });
    return () => {
      cancelled = true;
    };
  }, [connection, wallet.publicKey]);

  return (
    <aside className="nb-card accent-cyan match-pass" aria-label="Your match wallet">
      <span className="tag">Your match pass</span>
      <h2>{wallet.publicKey ? "You're in." : "Ready when you are."}</h2>
      <div className="metric-row">
        <span>Your wallet</span>
        <strong className="mono">{wallet.publicKey ? truncate(wallet.publicKey.toBase58()) : "Disconnected"}</strong>
      </div>
      <div className="metric-row">
        <span>Mode</span>
        <strong>Test play</strong>
      </div>
      <div className="metric-row">
        <span>Fee balance</span>
        <strong>{wallet.publicKey ? sol : "Connect first"}</strong>
      </div>
      <div className="metric-row">
        <span>Last move</span>
        {latestSignature ? (
          <a className="mono" href={explorerTx(latestSignature)} target="_blank" rel="noreferrer">
            {truncate(latestSignature)}
          </a>
        ) : (
          <strong>None</strong>
        )}
      </div>
      <WalletConnect />
      <label className="terms-check">
        <input
          type="checkbox"
          checked={Boolean(termsAcceptedAt)}
          onChange={(event) => {
            if (event.target.checked) {
              const acceptedAt = new Date().toISOString();
              window.localStorage.setItem(BETA_TERMS_STORAGE_KEY, acceptedAt);
              setTermsAcceptedAt(acceptedAt);
            } else {
              window.localStorage.removeItem(BETA_TERMS_STORAGE_KEY);
              setTermsAcceptedAt(undefined);
            }
          }}
        />
        <span>
          I&apos;m eligible to play in test mode and accept the <a href="/terms" target="_blank" rel="noreferrer">Terms</a> and <a href="/privacy" target="_blank" rel="noreferrer">Privacy Notice</a>.
        </span>
      </label>
      <div className="help-box">
        <strong>New to the board?</strong>
        <p>Use test tokens only. A small test balance covers joining a friendly challenge.</p>
        {config?.devnetTokenFaucetUrl ? (
          <a className="nb-button" href={config.devnetTokenFaucetUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={16} aria-hidden="true" />
            Get test tokens
          </a>
        ) : (
          <button className="nb-button" type="button" onClick={refresh}>
            <RefreshCw size={16} aria-hidden="true" />
            Check game status
          </button>
        )}
      </div>
    </aside>
  );
}

export function CreateMarketPanel({ fixtureId, fixtureStale }: { fixtureId: string; fixtureStale?: boolean }) {
  const wallet = useWallet();
  const { connection } = useConnection();
  const { config } = usePublicConfig();
  const [template, setTemplate] = useState<MarketTemplate>("TOTAL_GOALS_OVER_UNDER");
  const [threshold, setThreshold] = useState("2.5");
  const [lockMinutes, setLockMinutes] = useState("240");
  const [tokenMint, setTokenMint] = useState("");
  const [status, setStatus] = useState("Choose the call you want to put to your friends.");

  const selectedMint = tokenMint || preferredMint(config);

  const create = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signMessage || !config) {
      setStatus("Connect your match wallet first.");
      return;
    }
    if (!requireBetaTerms(setStatus)) return;
    if (!config.programConfigReady) {
      setStatus("Match challenges are warming up. Please try again shortly.");
      return;
    }
    try {
      setStatus("Making sure this match is ready…");
      const marketabilityResponse = await fetch(`/api/fixtures/${encodeURIComponent(fixtureId)}/marketability`);
      const marketability = await marketabilityResponse.json();
      if (!marketabilityResponse.ok || !marketability.marketable) {
        setStatus(marketability.reason ?? "This match isn't ready for a challenge just yet.");
        return;
      }
      if (fixtureStale && marketability.source !== "replay") {
        setStatus("This match just changed—refresh before you make your call.");
        return;
      }
      if (!Number.isFinite(Number(lockMinutes)) || Number(lockMinutes) < 5) {
        setStatus("Give your friends at least five minutes to join.");
        return;
      }
      if (template === "TOTAL_GOALS_OVER_UNDER" && !Number.isFinite(Number(threshold))) {
        setStatus("Enter a valid goal line.");
        return;
      }
      setStatus("Setting up your challenge…");
      const programId = new PublicKey(config.programId);
      const mint = new PublicKey(selectedMint);
      const marketNonce = BigInt(Date.now());
      const lockTs = BigInt(Math.floor(Date.now() / 1000) + Math.max(5, Number(lockMinutes)) * 60);
      const thresholdMilli = Math.round(Number(threshold) * 1000);
      const predicate = defaultPredicate(template, thresholdMilli);
      const built = buildCreateMarketIx({
        creator: wallet.publicKey,
        fixtureId,
        marketNonce,
        template,
        predicate,
        lockTs,
        tokenMint: mint,
        programId
      });
      const signature = await sendInstructions(connection, wallet, [built.instruction]);
      setStatus("Saving your call…");
      const body = {
        fixtureId,
        creator: wallet.publicKey.toBase58(),
        marketNonce: marketNonce.toString(),
        template,
        lockTs: new Date(Number(lockTs) * 1000).toISOString(),
        tokenMint: mint.toBase58(),
        escrowTokenAccount: built.escrowTokenAccount.toBase58(),
        thresholdMilli: template === "TOTAL_GOALS_OVER_UNDER" ? thresholdMilli : undefined,
        createTxSig: signature
      };
      const response = await signedPost({
        route: "/api/markets",
        wallet,
        body
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Create indexing failed");
      setStatus("Challenge created. Opening it now…");
      window.location.href = `/markets/${payload.market.id}`;
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [config, connection, fixtureId, fixtureStale, lockMinutes, selectedMint, template, threshold, wallet]);

  return (
    <section className="nb-card accent-orange">
      <span className="tag">Make a challenge</span>
      <h2>What are you calling?</h2>
      <form className="form-grid" onSubmit={(event) => event.preventDefault()}>
        <div className="field">
          <label htmlFor="template">Your call</label>
          <select id="template" value={template} onChange={(event) => setTemplate(event.target.value as MarketTemplate)}>
            <option value="MATCH_WINNER">Home side wins</option>
            <option value="TOTAL_GOALS_OVER_UNDER">More goals than a target</option>
          </select>
        </div>
        {template === "TOTAL_GOALS_OVER_UNDER" && (
          <div className="field">
            <label htmlFor="threshold">Goal target</label>
            <input id="threshold" inputMode="decimal" value={threshold} onChange={(event) => setThreshold(event.target.value)} />
          </div>
        )}
        <div className="field">
          <label htmlFor="lock-minutes">Close picks in</label>
          <input id="lock-minutes" inputMode="numeric" value={lockMinutes} onChange={(event) => setLockMinutes(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="token-mint">Test-token type</label>
          <select id="token-mint" value={selectedMint} onChange={(event) => setTokenMint(event.target.value)}>
            {(config?.allowedStakeMints ?? [DEVNET_USDC, DEVNET_USDT]).map((mint) => (
              <option key={mint} value={mint}>{mintLabel(mint)}</option>
            ))}
          </select>
        </div>
        <button className="nb-button primary" type="button" onClick={create}>
          Make this challenge
        </button>
        <p className="muted">{status}</p>
      </form>
    </section>
  );
}

export function MarketActions({ market }: { market: MarketRecord }) {
  const wallet = useWallet();
  const { connection } = useConnection();
  const { config } = usePublicConfig();
  const [amount, setAmount] = useState("1000000");
  const [seq, setSeq] = useState("");
  const [status, setStatus] = useState("Pick the side you want to back. Test tokens only.");
  const choices = challengeChoices(market);
  const isOpen = market.status === "OPEN";
  const canClaim = market.status === "SETTLED" || market.status === "CANCELLED";

  const join = useCallback(async (joinSide: Side) => {
    if (!wallet.publicKey || !wallet.signMessage || !config || !market.marketPda || !market.escrowTokenAccount || !market.tokenMint) {
      setStatus("Connect your match wallet and try again.");
      return;
    }
    if (!requireBetaTerms(setStatus)) return;
    try {
      setStatus(`Backing ${joinSide === "YES" ? choices.yes : choices.no}…`);
      const built = buildJoinMarketIx({
        user: wallet.publicKey,
        market: new PublicKey(market.marketPda),
        side: joinSide,
        amount: BigInt(amount),
        tokenMint: new PublicKey(market.tokenMint),
        escrowTokenAccount: new PublicKey(market.escrowTokenAccount),
        programId: new PublicKey(config.programId)
      });
      const signature = await sendInstructions(connection, wallet, [built.instruction]);
      const body = {
        userWallet: wallet.publicKey.toBase58(),
        side: joinSide,
        amount,
        onchainPosition: built.position.toBase58(),
        joinTxSig: signature
      };
      const response = await signedPost({
        route: "/api/markets/[marketId]/join",
        params: { marketId: market.id },
        wallet,
        body
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Join indexing failed");
      setStatus("Your pick is in. Let the match do the talking.");
      window.location.reload();
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [amount, config, connection, market, wallet]);

  const proofSettle = useCallback(async (kind: "settlement" | "cancellation") => {
    if (!wallet.publicKey || !wallet.signMessage || !config || !market.marketPda) {
      setStatus("Connect your match wallet and try again.");
      return;
    }
    if (!requireBetaTerms(setStatus)) return;
    if (!seq) {
      setStatus("Add the final match sequence before checking the result.");
      return;
    }
    try {
      const proofRoute = kind === "settlement" ? "settlement-proof" : "cancellation-proof";
      const finalRoute = kind === "settlement" ? "settle" : "cancel";
      setStatus(kind === "settlement" ? "Checking the final result…" : "Checking this match status…");
      const proofResponse = await signedPost({
        route: `/api/markets/[marketId]/${proofRoute}`,
        params: { marketId: market.id },
        wallet,
        body: { wallet: wallet.publicKey.toBase58(), seq }
      });
      const proofPayload = await proofResponse.json();
      if (!proofResponse.ok) throw new Error(proofPayload.message ?? "Proof preparation failed");
      const payload = (proofPayload.settlement ?? proofPayload.cancellation) as TxlineProofPayload;
      const ix = buildProofIx({ market, payload, programId: new PublicKey(config.programId) });
      const signature = await sendInstructions(connection, wallet, [ix]);
      const body = kind === "settlement"
        ? { wallet: wallet.publicKey.toBase58(), seq, settleTxSig: signature }
        : { wallet: wallet.publicKey.toBase58(), seq, cancelTxSig: signature };
      const response = await signedPost({
        route: `/api/markets/[marketId]/${finalRoute}`,
        params: { marketId: market.id },
        wallet,
        body
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Proof indexing failed");
      setStatus(kind === "settlement" ? "Full-time result confirmed." : "Challenge update confirmed.");
      window.location.reload();
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [config, connection, market, seq, wallet]);

  const cancelExpired = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signMessage || !config || !market.marketPda) return;
    if (!requireBetaTerms(setStatus)) return;
    try {
      setStatus("Closing this expired challenge…");
      const ix = buildCancelExpiredIx({ market: new PublicKey(market.marketPda), programId: new PublicKey(config.programId) });
      const signature = await sendInstructions(connection, wallet, [ix]);
      const response = await signedPost({
        route: "/api/markets/[marketId]/cancel-expired",
        params: { marketId: market.id },
        wallet,
        body: { wallet: wallet.publicKey.toBase58(), cancelTxSig: signature }
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Expired cancellation failed");
      setStatus("This challenge is safely closed.");
      window.location.reload();
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [config, connection, market.id, market.marketPda, wallet]);

  const claim = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signMessage || !config || !market.marketPda || !market.escrowTokenAccount || !market.tokenMint) return;
    if (!requireBetaTerms(setStatus)) return;
    try {
      setStatus("Collecting your result…");
      const built = buildClaimIx({
        user: wallet.publicKey,
        market: new PublicKey(market.marketPda),
        tokenMint: new PublicKey(market.tokenMint),
        escrowTokenAccount: new PublicKey(market.escrowTokenAccount),
        programId: new PublicKey(config.programId)
      });
      const signature = await sendInstructions(connection, wallet, [built.instruction]);
      const response = await signedPost({
        route: "/api/markets/[marketId]/claim",
        params: { marketId: market.id },
        wallet,
        body: {
          wallet: wallet.publicKey.toBase58(),
          positionPda: built.position.toBase58(),
          claimTxSig: signature
        }
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Claim indexing failed");
      setStatus("Your result is collected.");
      window.location.reload();
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [config, connection, market, wallet]);

  return (
    <div className="nb-card accent-magenta player-actions">
      <span className="tag">Make your call</span>
      <h2>{isOpen ? "Which side are you on?" : canClaim ? "Full time." : "This one is under way."}</h2>
      {isOpen ? (
        <>
          <div className="field">
            <label htmlFor="amount">Your test-token amount</label>
            <input id="amount" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </div>
          <div className="choice-grid action-grid">
            <button className="choice-button choice-button-yes" type="button" onClick={() => join("YES")}>{choices.yes}</button>
            <button className="choice-button choice-button-no" type="button" onClick={() => join("NO")}>{choices.no}</button>
          </div>
        </>
      ) : (
        <div className="action-state">
          {canClaim ? "The final result is ready. If this was your challenge, collect your result below." : "Picks are closed while the match plays out. Check back after the final whistle."}
        </div>
      )}
      {canClaim && <button className="nb-button primary" type="button" onClick={claim}>Collect your result</button>}
      <details className="match-ops">
        <summary>Match result tools</summary>
        <p>Use these only after full time or when a match needs to be called off.</p>
        <div className="field">
          <label htmlFor="seq">Final match sequence</label>
          <input id="seq" inputMode="numeric" value={seq} onChange={(event) => setSeq(event.target.value)} placeholder="Add the final match sequence" />
        </div>
        <div className="grid action-grid">
          <button className="nb-button cyan" type="button" onClick={() => proofSettle("settlement")} disabled={market.status !== "LOCKED"}>Check final result</button>
          <button className="nb-button" type="button" onClick={() => proofSettle("cancellation")} disabled={market.status !== "OPEN" && market.status !== "LOCKED"}>Mark match called off</button>
          <button className="nb-button magenta" type="button" onClick={cancelExpired} disabled={market.status !== "OPEN" && market.status !== "LOCKED"}>Close expired challenge</button>
        </div>
      </details>
      <p className="muted">{status}</p>
    </div>
  );
}

export function FixtureRefreshPanel({ replayEnabled }: { replayEnabled: boolean }) {
  const [status, setStatus] = useState("We only open a challenge when the match is ready to be checked.");
  const refreshLive = useCallback(async () => {
    setStatus("Checking the match board…");
    try {
      const response = await fetch("/api/fixtures");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Live fixture refresh failed");
      const count = payload.fixtures?.length ?? 0;
      setStatus(count ? `${count} ${count === 1 ? "match is" : "matches are"} ready to browse.` : "Nothing new just yet—check back for the next match.");
      window.dispatchEvent(new Event("finalwhistle:fixtures-refreshed"));
    } catch {
      setStatus("The match board is taking a breather. Try again in a moment.");
    }
  }, []);

  return (
    <div className="fixture-refresh">
      <div>
        <span className="tag">The match board</span>
        <h3>Something good is about to kick off.</h3>
        <p>Browse a fresh match when it lands, or warm up with a clearly marked practice game.</p>
      </div>
      <div className="fixture-refresh-actions">
        <button className="nb-button primary" type="button" onClick={refreshLive}>Check for matches</button>
        {replayEnabled && <a className="fixture-refresh-link" href="#practice-matches">Try a practice match</a>}
      </div>
      <p className="fixture-refresh-status" aria-live="polite">{status}</p>
    </div>
  );
}

export function ReplayFixtureCards() {
  const [fixtures, setFixtures] = useState<FixtureView[]>([]);

  useEffect(() => {
    fetch("/api/fixtures?mode=replay")
      .then((response) => response.ok ? response.json() : undefined)
      .then((payload) => setFixtures(payload?.fixtures ?? []))
      .catch(() => setFixtures([]));
  }, []);

  if (fixtures.length === 0) return null;

  return (
    <section className="practice-section" id="practice-matches" aria-labelledby="practice-title">
      <div className="board-heading">
        <div>
          <p className="eyebrow">Just for practice</p>
          <h3 id="practice-title">Try a past match first</h3>
        </div>
        <span className="board-count">{fixtures.length} to replay</span>
      </div>
      <p className="board-status">These are clearly marked practice matches, so you can learn the flow before game night.</p>
      <div className="match-card-grid">
        {fixtures.map((fixture) => (
          <article className="practice-card" key={fixture.id}>
            <div className="match-card-top">
              <span>Practice match</span>
              <span className="match-state waiting">Already played</span>
            </div>
            <h3>{fixture.name}</h3>
            <p>Make a pretend call, click around, and get comfortable before inviting friends.</p>
            <a className="match-open" href={`/fixtures/${fixture.id}?mode=replay`}>Open practice match</a>
          </article>
        ))}
      </div>
    </section>
  );
}

export function PortfolioClient() {
  const wallet = useWallet();
  const [positions, setPositions] = useState<Array<Record<string, unknown>>>([]);
  const [status, setStatus] = useState("Connect your wallet to see the calls you've made.");

  useEffect(() => {
    if (!wallet.publicKey) {
      setPositions([]);
      setStatus("Connect your wallet to see the calls you've made.");
      return;
    }
    setStatus("Finding your match picks…");
    fetch(`/api/portfolio?wallet=${wallet.publicKey.toBase58()}`)
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.message ?? "Portfolio failed");
        setPositions(payload.positions ?? []);
        setStatus((payload.positions ?? []).length ? "Your picks are ready." : "No picks yet—find a match and make the first call.");
      })
      .catch(() => setStatus("Your picks are unavailable right now. Try again in a moment."));
  }, [wallet.publicKey]);

  return (
    <section className="nb-card accent-yellow">
      <span className="tag">My match day</span>
      <h2>{wallet.publicKey ? "Your picks" : "Your picks live here"}</h2>
      <p>{status}</p>
      <div className="form-grid">
        {positions.map((entry) => {
          const market = entry.market as Record<string, string>;
          const position = entry.position as Record<string, string | boolean>;
          const goalCall = market.template === "TOTAL_GOALS_OVER_UNDER";
          const pick = position.side === "YES"
            ? goalCall ? "You backed the over" : "You backed the home side"
            : goalCall ? "You backed the lower total" : "You backed the other side";
          const statusLabel = ({ OPEN: "Open to pick", LOCKED: "Match live", SETTLED: "Full time", CANCELLED: "Called off" } as Record<string, string>)[market.status] ?? "In play";
          return (
            <a className="position-row" href={`/markets/${market.id}`} key={String(position.id)}>
              <span>{goalCall ? "Goals call" : "Winner call"}</span>
              <strong>{pick}</strong>
              <small>{position.claimed ? "Result collected" : statusLabel}</small>
            </a>
          );
        })}
      </div>
    </section>
  );
}

function WalletConnect() {
  const wallet = useWallet();
  const installed = wallet.wallets.filter((entry) => entry.readyState === WalletReadyState.Installed || entry.readyState === WalletReadyState.Loadable);

  if (wallet.connected) {
    return (
      <button className="nb-button" type="button" onClick={() => void wallet.disconnect()}>
        <Wallet size={18} aria-hidden="true" />
        Leave wallet
      </button>
    );
  }

  return (
    <div className="form-grid">
      {installed.map((entry) => (
        <button
          className="nb-button primary"
          type="button"
          key={entry.adapter.name}
          onClick={async () => {
            wallet.select(entry.adapter.name);
            await entry.adapter.connect();
          }}
        >
          <Wallet size={18} aria-hidden="true" />
          Join with {entry.adapter.name}
        </button>
      ))}
      {installed.length === 0 && <p className="muted">To join a match, install Phantom or Solflare first.</p>}
    </div>
  );
}

function usePublicConfig() {
  const [config, setConfig] = useState<PublicConfig>();
  const [status, setStatus] = useState("Load config");
  const refresh = useCallback(() => {
    setStatus("Loading config...");
    fetch("/api/public-config")
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.message ?? "Config unavailable");
        setConfig(payload);
        setStatus(payload.programConfigReady ? "Config loaded" : "Settlement configuration is not ready");
      })
      .catch(() => setStatus("Config unavailable"));
  }, []);
  useEffect(refresh, [refresh]);
  return { config, status, refresh };
}

async function sendInstructions(
  connection: ReturnType<typeof useConnection>["connection"],
  wallet: ReturnType<typeof useWallet>,
  instructions: Transaction["instructions"]
) {
  if (!wallet.publicKey || !wallet.sendTransaction) throw new Error("Wallet is not connected");
  const transaction = new Transaction();
  transaction.add(...instructions);
  transaction.feePayer = wallet.publicKey;
  transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const signature = await wallet.sendTransaction(transaction, connection);
  await connection.confirmTransaction(signature, "confirmed");
  return signature;
}

async function signedPost(input: {
  route: string;
  params?: Record<string, string>;
  wallet: ReturnType<typeof useWallet>;
  body: Record<string, unknown>;
}) {
  if (!input.wallet.publicKey || !input.wallet.signMessage) throw new Error("Wallet must support message signing");
  const termsAcceptedAt = window.localStorage.getItem(BETA_TERMS_STORAGE_KEY);
  if (!termsAcceptedAt) throw new Error("Accept the beta Terms and Privacy Notice before submitting a transaction.");
  const idempotencyKey = crypto.randomUUID();
  const issuedAt = new Date().toISOString();
  const signedMessage = JSON.stringify({
    domain: "finalwhistle",
    version: 2,
    cluster: "devnet",
    programId: (await (await fetch("/api/public-config")).json()).programId,
    route: input.route,
    method: "POST",
    wallet: input.wallet.publicKey.toBase58(),
    issuedAt,
    nonce: crypto.randomUUID(),
    idempotencyKey,
    termsVersion: BETA_TERMS_VERSION,
    termsAcceptedAt,
    requestHash: await requestHash({ params: input.params ?? {}, body: input.body })
  });
  const signature = await input.wallet.signMessage(new TextEncoder().encode(signedMessage));
  const body = {
    ...input.body,
    auth: {
      signedMessage,
      walletSignature: bs58.encode(signature)
    }
  };
  const path = fillRoute(input.route, input.params);
  return fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey
    },
    body: JSON.stringify(body)
  });
}

async function requestHash(input: { params: Record<string, string>; body: Record<string, unknown> }) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(input)));
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
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

function fillRoute(route: string, params?: Record<string, string>) {
  let output = route;
  for (const [key, value] of Object.entries(params ?? {})) output = output.replace(`[${key}]`, value);
  return output;
}

function challengeChoices(market: MarketRecord) {
  if (market.template === "MATCH_WINNER") {
    return { yes: "Back home side", no: "Back the other side" };
  }

  const line = (market.predicate.thresholdMilli / 1000).toLocaleString("en", { maximumFractionDigits: 2 });
  return { yes: `Over ${line} goals`, no: `${line} or fewer` };
}

function defaultPredicate(template: MarketTemplate, thresholdMilli: number) {
  if (template === "MATCH_WINNER") {
    return {
      statKey1: 1,
      statKey2: 2,
      operator: "SUBTRACT" as const,
      thresholdMilli: 0,
      comparison: "GREATER_THAN" as const
    };
  }
  return {
    statKey1: 1,
    statKey2: 2,
    operator: "ADD" as const,
    thresholdMilli,
    comparison: "GREATER_THAN" as const
  };
}

function preferredMint(config?: PublicConfig) {
  return config?.allowedStakeMints.find((mint) => mint === DEVNET_USDC || mint === DEVNET_USDT) ?? config?.allowedStakeMints[0] ?? DEVNET_USDC;
}

function mintLabel(mint: string) {
  if (mint === DEVNET_USDC) return "Devnet USDC";
  if (mint === DEVNET_USDT) return "Devnet USDT";
  return truncate(mint);
}

function explorerTx(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

function truncate(value: string, chars = 4) {
  return value.length <= chars * 2 + 3 ? value : `${value.slice(0, chars)}...${value.slice(-chars)}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected beta flow error";
}

function requireBetaTerms(setStatus: (value: string) => void) {
  if (window.localStorage.getItem(BETA_TERMS_STORAGE_KEY)) return true;
  setStatus("Accept the beta Terms and Privacy Notice in the wallet panel before continuing.");
  return false;
}
