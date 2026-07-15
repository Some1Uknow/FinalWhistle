"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
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
const PENDING_INDEXING_STORAGE_KEY = "finalwhistle.pending-indexing.v1";
const PENDING_INDEXING_EVENT = "finalwhistle:pending-indexing";

type PendingIndexingRequest = {
  idempotencyKey: string;
  label: string;
  transactionSignature: string;
  path: string;
  body: string;
  expiresAt: string;
};

export function WalletPanel({ latestSignature }: { latestSignature?: string }) {
  const wallet = useWallet();
  const { connection } = useConnection();
  const [sol, setSol] = useState<string>("...");

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
    <aside className="nb-card accent-cyan match-pass" aria-label="Your account">
      <span className="tag">Your account</span>
      <h2>{wallet.publicKey ? "Wallet connected" : "Wallet disconnected"}</h2>
      <div className="metric-row">
        <span>Wallet</span>
        <strong className="mono">{wallet.publicKey ? truncate(wallet.publicKey.toBase58()) : "Disconnected"}</strong>
      </div>
      <div className="metric-row">
        <span>Network balance</span>
        <strong>{wallet.publicKey ? sol === "unavailable" ? sol : `${sol} SOL` : "Connect first"}</strong>
      </div>
      <div className="metric-row">
        <span>Latest receipt</span>
        {latestSignature ? (
          <a className="mono" href={explorerTx(latestSignature)} target="_blank" rel="noreferrer">
            {truncate(latestSignature)}
          </a>
        ) : (
          <strong>None</strong>
        )}
      </div>
      <PendingIndexingRecovery />
    </aside>
  );
}

function TermsConsent() {
  const [acceptedAt, setAcceptedAt] = useState<string>();

  useEffect(() => {
    setAcceptedAt(window.localStorage.getItem(BETA_TERMS_STORAGE_KEY) ?? undefined);
  }, []);

  return (
    <label className="terms-check terms-check-action">
      <input
        type="checkbox"
        checked={Boolean(acceptedAt)}
        onChange={(event) => {
          if (event.target.checked) {
            const nextAcceptedAt = new Date().toISOString();
            window.localStorage.setItem(BETA_TERMS_STORAGE_KEY, nextAcceptedAt);
            setAcceptedAt(nextAcceptedAt);
          } else {
            window.localStorage.removeItem(BETA_TERMS_STORAGE_KEY);
            setAcceptedAt(undefined);
          }
        }}
      />
      <span>
        I confirm I&apos;m eligible and agree to the <a href="/terms" target="_blank" rel="noreferrer">Terms</a> and <a href="/privacy" target="_blank" rel="noreferrer">Privacy Notice</a>.
      </span>
    </label>
  );
}

export function CreateMarketPanel({
  fixtureId,
  fixtureStale,
  fixtureStartsAt,
  participant1 = "Home team",
  participant2 = "Away team"
}: {
  fixtureId: string;
  fixtureStale?: boolean;
  fixtureStartsAt?: string;
  participant1?: string;
  participant2?: string;
}) {
  const wallet = useWallet();
  const { connection } = useConnection();
  const { config, status: configStatus } = usePublicConfig();
  const [template, setTemplate] = useState<MarketTemplate>("TOTAL_GOALS_OVER_UNDER");
  const [threshold, setThreshold] = useState("2.5");
  const [lockMinutes, setLockMinutes] = useState("240");
  const [tokenMint, setTokenMint] = useState("");
  const [side, setSide] = useState<Side>("YES");
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Choose one outcome, then set your amount.");

  const selectedMint = tokenMint || preferredMint(config);
  const selectedToken = config?.stakeTokens.find((token) => token.mint === selectedMint);

  const refreshFixture = useCallback(async () => {
    try {
      setBusy(true);
      setStatus("Refreshing this match…");
      const response = await fetch("/api/fixtures");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Fixture refresh failed");
      window.location.reload();
    } catch {
      setStatus("The match could not be refreshed just now. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }, []);

  const create = useCallback(async () => {
    let submittedSignature: string | undefined;
    if (!wallet.publicKey || !wallet.signMessage || !config) {
      setStatus("Connect your wallet first.");
      return;
    }
    if (!requireBetaTerms(setStatus)) return;
    if (!requireNoPendingIndexing(setStatus)) return;
    if (!config.programConfigReady) {
      setStatus("Betting is not enabled yet. Please try again shortly.");
      return;
    }
    if (!selectedToken) {
      setStatus("This token isn't available right now.");
      return;
    }
    try {
      setBusy(true);
      setStatus("Making sure this match is ready…");
      const marketabilityResponse = await fetch(`/api/fixtures/${encodeURIComponent(fixtureId)}/marketability`);
      const marketability = await marketabilityResponse.json();
      if (!marketabilityResponse.ok || !marketability.marketable) {
        setStatus(marketability.reason ?? "This match is not ready for a bet yet.");
        return;
      }
      if (fixtureStale) {
        setStatus("This match just changed—refresh before you make your call.");
        return;
      }
      const lockMinutesNumber = Number(lockMinutes);
      if (!Number.isInteger(lockMinutesNumber) || lockMinutesNumber < 5 || lockMinutesNumber > 1_440) {
        setStatus("Choose a join window between 5 minutes and 24 hours.");
        return;
      }
      const kickoffTs = fixtureTimestamp(fixtureStartsAt);
      if (!Number.isFinite(kickoffTs) || kickoffTs <= Date.now()) {
        setStatus("This fixture is no longer available for a new challenge.");
        return;
      }
      if (Date.now() + lockMinutesNumber * 60_000 >= kickoffTs) {
        setStatus("Close picks before kickoff. Choose a shorter join window.");
        return;
      }
      if (template === "TOTAL_GOALS_OVER_UNDER" && (!Number.isFinite(Number(threshold)) || Number(threshold) < 0.5 || Number(threshold) > 8.5 || Number(threshold) % 1 !== 0.5)) {
        setStatus("Choose a half-goal line from 0.5 to 8.5.");
        return;
      }
      const rawAmount = parseTokenAmount(amount, selectedToken.decimals);
      setStatus("Preparing your bet…");
      const programId = new PublicKey(config.programId);
      const mint = new PublicKey(selectedMint);
      const marketNonce = BigInt(Date.now());
      const lockTs = BigInt(Math.floor(Date.now() / 1000) + lockMinutesNumber * 60);
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
      const initialPosition = buildJoinMarketIx({
        user: wallet.publicKey,
        market: built.market,
        side,
        amount: rawAmount,
        tokenMint: mint,
        escrowTokenAccount: built.escrowTokenAccount,
        programId
      });
      const signature = await sendInstructions(connection, wallet, [built.instruction, initialPosition.instruction]);
      submittedSignature = signature;
      setStatus("Saving your bet…");
      const body = {
        fixtureId,
        creator: wallet.publicKey.toBase58(),
        marketNonce: marketNonce.toString(),
        template,
        lockTs: new Date(Number(lockTs) * 1000).toISOString(),
        tokenMint: mint.toBase58(),
        escrowTokenAccount: built.escrowTokenAccount.toBase58(),
        thresholdMilli: template === "TOTAL_GOALS_OVER_UNDER" ? thresholdMilli : undefined,
        side,
        amount: rawAmount.toString(),
        onchainPosition: initialPosition.position.toBase58(),
        createTxSig: signature
      };
      const { response, pendingIndexing } = await signedPost({
        route: "/api/markets",
        wallet,
        body,
        programId: config.programId,
        recovery: { label: "bet", transactionSignature: signature }
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Create indexing failed");
      completePendingIndexing(pendingIndexing);
      setStatus("Bet created. Opening it now…");
      window.location.href = `/markets/${payload.market.id}`;
    } catch (error) {
      setStatus(errorMessage(error, submittedSignature));
    } finally {
      setBusy(false);
    }
  }, [amount, config, connection, fixtureId, fixtureStale, fixtureStartsAt, lockMinutes, participant1, participant2, selectedMint, selectedToken, side, template, threshold, wallet]);

  return (
    <section className="nb-card accent-orange">
      <span className="tag">Place a bet</span>
      <h2>Choose your prediction</h2>
      <p className="panel-intro">Pick one outcome. Someone else takes the other side.</p>
      <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void create(); }}>
        {fixtureStale && (
          <div className="help-box">
            <p>This match needs an update before you can bet.</p>
            <button className="nb-button" type="button" onClick={() => void refreshFixture()} disabled={busy}>Refresh match</button>
          </div>
        )}
        <div className="field">
          <label htmlFor="template">Bet type</label>
          <select id="template" value={template} onChange={(event) => setTemplate(event.target.value as MarketTemplate)}>
            <option value="MATCH_WINNER">Who wins?</option>
            <option value="TOTAL_GOALS_OVER_UNDER">Total goals</option>
          </select>
        </div>
        {template === "TOTAL_GOALS_OVER_UNDER" && (
          <div className="field">
            <label htmlFor="threshold">Goal line</label>
            <input id="threshold" inputMode="decimal" value={threshold} onChange={(event) => setThreshold(event.target.value)} />
            <small>For example, 2.5 means 3 or more goals versus 2 or fewer.</small>
          </div>
        )}
        <div className="field">
          <label htmlFor="lock-minutes">Bet closes in (minutes)</label>
          <input id="lock-minutes" inputMode="numeric" value={lockMinutes} onChange={(event) => setLockMinutes(event.target.value)} />
          <small>Betting must close before kickoff.</small>
        </div>
        <div className="field">
          <label htmlFor="token-mint">Practice token</label>
          <select id="token-mint" value={selectedMint} onChange={(event) => setTokenMint(event.target.value)}>
            {(config?.allowedStakeMints ?? [DEVNET_USDC, DEVNET_USDT]).map((mint) => (
              <option key={mint} value={mint}>{mintLabel(mint)}</option>
            ))}
          </select>
        </div>
        <fieldset className="field" disabled={busy}>
          <legend>Your prediction</legend>
          <div className="choice-grid action-grid">
            <label>
              <input type="radio" name="creator-side" checked={side === "YES"} onChange={() => setSide("YES")} />
              {template === "MATCH_WINNER" ? `${participant1} wins` : `More than ${threshold} goals`}
            </label>
            <label>
              <input type="radio" name="creator-side" checked={side === "NO"} onChange={() => setSide("NO")} />
              {template === "MATCH_WINNER" ? `${participant2} wins or draw` : `${threshold} goals or fewer`}
            </label>
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="creator-amount">Amount to put in</label>
          <input id="creator-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={busy} />
          <small>{selectedToken ? `${selectedToken.symbol} · Test balance` : "Token details are loading"}</small>
        </div>
        {!config?.programConfigReady && (
          <div className="help-box">
            <p>{config ? "Betting is not enabled yet. You can still follow the match and check back soon." : `${configStatus}. Try again in a moment.`}</p>
          </div>
        )}
        <TermsConsent />
        <button className="nb-button primary" type="submit" disabled={busy || !config?.programConfigReady || !selectedToken}>
          {busy ? "Confirming in your wallet…" : "Create bet"}
        </button>
        <p className="muted" aria-live="polite">{status}</p>
        <PendingIndexingRecovery />
      </form>
    </section>
  );
}

export function MarketActions({ market }: { market: MarketRecord }) {
  const wallet = useWallet();
  const { connection } = useConnection();
  const { config, status: configStatus } = usePublicConfig();
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState<{ side: Side; claimed: boolean }>();
  const [status, setStatus] = useState("Pick the side you want to back.");
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const choices = challengeChoices(market);
  const isOpen = market.status === "OPEN" && isFutureTime(market.lockTs, currentTime);
  const openMarketExpired = market.status === "OPEN" && hasReachedTime(market.lockTs, currentTime);
  const lockedMarketExpired = market.status === "LOCKED" && hasReachedTime(market.settlementDeadlineTs, currentTime);
  const canCancelExpired = openMarketExpired || lockedMarketExpired;
  const marketActionWindowOpen = market.status === "OPEN"
    ? isFutureTime(market.lockTs, currentTime)
    : market.status === "LOCKED"
      ? isFutureTime(market.settlementDeadlineTs, currentTime)
      : false;
  const resultToolsReady = Boolean(config?.programConfigReady);
  const token = config?.stakeTokens.find((entry) => entry.mint === market.tokenMint);
  const fixedRawAmount = market.yesStake !== "0" && market.noStake === "0"
    ? market.yesStake
    : market.noStake !== "0" && market.yesStake === "0"
      ? market.noStake
      : undefined;
  const allowedSides: Side[] = market.yesStake !== "0" && market.noStake === "0"
    ? ["NO"]
    : market.noStake !== "0" && market.yesStake === "0"
      ? ["YES"]
      : ["YES", "NO"];
  const canClaim = Boolean(position && !position.claimed && (
    market.status === "CANCELLED" || (market.status === "SETTLED" && position.side === market.winningSide)
  ));

  useEffect(() => {
    if (token && fixedRawAmount) setAmount(formatTokenAmount(fixedRawAmount, token.decimals));
  }, [fixedRawAmount, token]);

  useEffect(() => {
    const nextBoundary = [fixtureTimestamp(market.lockTs), fixtureTimestamp(market.settlementDeadlineTs)]
      .filter((timestamp) => Number.isFinite(timestamp) && timestamp > currentTime)
      .sort((left, right) => left - right)[0];
    if (!nextBoundary) return;
    const timeout = window.setTimeout(() => setCurrentTime(Date.now()), Math.max(0, nextBoundary - Date.now() + 25));
    return () => window.clearTimeout(timeout);
  }, [currentTime, market.lockTs, market.settlementDeadlineTs]);

  useEffect(() => {
    if (!wallet.publicKey) {
      setPosition(undefined);
      return;
    }
    let cancelled = false;
    fetch(`/api/portfolio?wallet=${wallet.publicKey.toBase58()}`)
      .then((response) => response.ok ? response.json() : undefined)
      .then((payload) => {
        if (cancelled) return;
        const match = (payload?.positions ?? []).find((entry: { market?: { id?: string } }) => entry.market?.id === market.id);
        setPosition(match?.position);
      })
      .catch(() => { if (!cancelled) setPosition(undefined); });
    return () => { cancelled = true; };
  }, [market.id, wallet.publicKey]);

  const join = useCallback(async (joinSide: Side) => {
    let submittedSignature: string | undefined;
    if (!wallet.publicKey || !wallet.signMessage || !config || !market.marketPda || !market.escrowTokenAccount || !market.tokenMint) {
      setStatus("Connect your wallet and try again.");
      return;
    }
    if (!requireBetaTerms(setStatus)) return;
    if (!requireNoPendingIndexing(setStatus)) return;
    if (!token) {
      setStatus("This challenge's token isn't available right now.");
      return;
    }
    if (!allowedSides.includes(joinSide)) {
      setStatus("That side is already taken. Choose the open side to match the challenge.");
      return;
    }
    if (!isFutureTime(market.lockTs)) {
      setStatus("Picks have closed for this challenge. Refresh the page to see its latest state.");
      return;
    }
    try {
      setBusy(true);
      const rawAmount = fixedRawAmount ? BigInt(fixedRawAmount) : parseTokenAmount(amount, token.decimals);
      setStatus(`Backing ${joinSide === "YES" ? choices.yes : choices.no}…`);
      const built = buildJoinMarketIx({
        user: wallet.publicKey,
        market: new PublicKey(market.marketPda),
        side: joinSide,
        amount: rawAmount,
        tokenMint: new PublicKey(market.tokenMint),
        escrowTokenAccount: new PublicKey(market.escrowTokenAccount),
        programId: new PublicKey(config.programId)
      });
      const signature = await sendInstructions(connection, wallet, [built.instruction]);
      submittedSignature = signature;
      const body = {
        userWallet: wallet.publicKey.toBase58(),
        side: joinSide,
        amount: rawAmount.toString(),
        onchainPosition: built.position.toBase58(),
        joinTxSig: signature
      };
      const { response, pendingIndexing } = await signedPost({
        route: "/api/markets/[marketId]/join",
        params: { marketId: market.id },
        wallet,
        body,
        programId: config.programId,
        recovery: { label: "match pick", transactionSignature: signature }
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Join indexing failed");
      completePendingIndexing(pendingIndexing);
      setStatus("Your pick is in. Let the match do the talking.");
      window.location.reload();
    } catch (error) {
      setStatus(errorMessage(error, submittedSignature));
    } finally {
      setBusy(false);
    }
  }, [allowedSides, amount, choices.no, choices.yes, config, connection, fixedRawAmount, market, token, wallet]);

  const proofSettle = useCallback(async (kind: "settlement" | "cancellation") => {
    let submittedSignature: string | undefined;
    if (!wallet.publicKey || !wallet.signMessage || !config || !market.marketPda) {
      setStatus("Connect your wallet and try again.");
      return;
    }
    if (!config.programConfigReady) {
      setStatus("Result checks are unavailable right now.");
      return;
    }
    if (!isActionWindowOpen(market)) {
      setStatus("This challenge has expired. Close it instead of submitting a result update.");
      return;
    }
    if (!requireBetaTerms(setStatus)) return;
    if (!requireNoPendingIndexing(setStatus)) return;
    try {
      setBusy(true);
      const proofRoute = kind === "settlement" ? "settlement-proof" : "cancellation-proof";
      const finalRoute = kind === "settlement" ? "settle" : "cancel";
      setStatus(kind === "settlement" ? "Checking the final result…" : "Checking this match status…");
      const { response: proofResponse } = await signedPost({
        route: `/api/markets/[marketId]/${proofRoute}`,
        params: { marketId: market.id },
        wallet,
        body: { wallet: wallet.publicKey.toBase58() },
        programId: config.programId
      });
      const proofPayload = await proofResponse.json();
      if (!proofResponse.ok) throw new Error(proofPayload.message ?? "Proof preparation failed");
      const payload = (proofPayload.settlement ?? proofPayload.cancellation) as TxlineProofPayload;
      const seq = String(payload.args.seq);
      const ix = buildProofIx({ market, payload, programId: new PublicKey(config.programId) });
      const signature = await sendInstructions(connection, wallet, [ix]);
      submittedSignature = signature;
      const body = kind === "settlement"
        ? { wallet: wallet.publicKey.toBase58(), seq, settleTxSig: signature }
        : { wallet: wallet.publicKey.toBase58(), seq, cancelTxSig: signature };
      const { response, pendingIndexing } = await signedPost({
        route: `/api/markets/[marketId]/${finalRoute}`,
        params: { marketId: market.id },
        wallet,
        body,
        programId: config.programId,
        recovery: {
          label: kind === "settlement" ? "full-time result" : "called-off match",
          transactionSignature: signature
        }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Proof indexing failed");
      completePendingIndexing(pendingIndexing);
      setStatus(kind === "settlement" ? "Full-time result confirmed." : "Challenge update confirmed.");
      window.location.reload();
    } catch (error) {
      setStatus(errorMessage(error, submittedSignature));
    } finally {
      setBusy(false);
    }
  }, [config, connection, market, wallet]);

  const cancelExpired = useCallback(async () => {
    let submittedSignature: string | undefined;
    if (!wallet.publicKey || !wallet.signMessage || !config || !market.marketPda) {
      setStatus("Connect your wallet and try again.");
      return;
    }
    if (!isExpiredMarket(market)) {
      setStatus("This challenge is still within its action window and cannot be closed yet.");
      return;
    }
    if (!requireBetaTerms(setStatus)) return;
    if (!requireNoPendingIndexing(setStatus)) return;
    try {
      setBusy(true);
      setStatus("Checking whether this challenge can be safely closed…");
      const instruction = buildCancelExpiredIx({
        market: new PublicKey(market.marketPda),
        programId: new PublicKey(config.programId)
      });
      const signature = await sendInstructions(connection, wallet, [instruction]);
      submittedSignature = signature;
      const { response, pendingIndexing } = await signedPost({
        route: "/api/markets/[marketId]/cancel-expired",
        params: { marketId: market.id },
        wallet,
        body: { wallet: wallet.publicKey.toBase58(), cancelTxSig: signature },
        programId: config.programId,
        recovery: { label: "expired challenge closure", transactionSignature: signature }
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Expired cancellation indexing failed");
      completePendingIndexing(pendingIndexing);
      setStatus("This expired challenge is safely closed.");
      window.location.reload();
    } catch (error) {
      setStatus(errorMessage(error, submittedSignature));
    } finally {
      setBusy(false);
    }
  }, [config, connection, market, wallet]);

  const claim = useCallback(async () => {
    let submittedSignature: string | undefined;
    if (!wallet.publicKey || !wallet.signMessage || !config || !market.marketPda || !market.escrowTokenAccount || !market.tokenMint) return;
    if (!requireBetaTerms(setStatus)) return;
    if (!requireNoPendingIndexing(setStatus)) return;
    try {
      setBusy(true);
      setStatus("Collecting your result…");
      const built = buildClaimIx({
        user: wallet.publicKey,
        market: new PublicKey(market.marketPda),
        tokenMint: new PublicKey(market.tokenMint),
        escrowTokenAccount: new PublicKey(market.escrowTokenAccount),
        programId: new PublicKey(config.programId)
      });
      const signature = await sendInstructions(connection, wallet, [built.instruction]);
      submittedSignature = signature;
      const { response, pendingIndexing } = await signedPost({
        route: "/api/markets/[marketId]/claim",
        params: { marketId: market.id },
        wallet,
        body: {
          wallet: wallet.publicKey.toBase58(),
          positionPda: built.position.toBase58(),
          claimTxSig: signature
        },
        programId: config.programId,
        recovery: { label: "result collection", transactionSignature: signature }
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Claim indexing failed");
      completePendingIndexing(pendingIndexing);
      setStatus("Your result is collected.");
      window.location.reload();
    } catch (error) {
      setStatus(errorMessage(error, submittedSignature));
    } finally {
      setBusy(false);
    }
  }, [config, connection, market, wallet]);

  return (
    <div className="nb-card accent-magenta player-actions">
      <span className="tag">Make your call</span>
      <h2>{isOpen ? "Which side are you on?" : openMarketExpired ? "Picks are closed." : market.status === "LOCKED" ? "This one is under way." : "The result is in."}</h2>
      {isOpen ? (
        <>
          <div className="field">
            <label htmlFor="amount">Your amount</label>
            <input id="amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={busy || Boolean(fixedRawAmount)} />
            <small>{token ? `${token.symbol} · Practice balance${fixedRawAmount ? " · amount set by the opening pick" : ""}` : "Token details are loading"}</small>
          </div>
          {!config && <div className="action-state">{configStatus}. Try again in a moment.</div>}
        </>
      ) : (
        <div className="action-state">
          {canClaim
            ? "You have an eligible unclaimed result."
            : canCancelExpired
              ? "This challenge has reached its time limit and can be safely closed."
              : openMarketExpired
                ? "Picks closed without a matching call. It can be closed when its time limit is reached."
                : market.status === "LOCKED"
                  ? "Picks are closed. The result can be confirmed once it is available."
                  : position
                    ? "There is nothing left for this wallet to collect."
                    : "This wallet did not join this challenge."}
        </div>
      )}
      <TermsConsent />
      {isOpen && (
        <div className="choice-grid action-grid">
          {allowedSides.includes("YES") && <button className="choice-button choice-button-yes" type="button" onClick={() => join("YES")} disabled={busy || !token}>{busy ? "Waiting for wallet…" : choices.yes}</button>}
          {allowedSides.includes("NO") && <button className="choice-button choice-button-no" type="button" onClick={() => join("NO")} disabled={busy || !token}>{busy ? "Waiting for wallet…" : choices.no}</button>}
        </div>
      )}
      {canClaim && <button className="nb-button primary" type="button" onClick={claim} disabled={busy}>{busy ? "Waiting for wallet…" : "Collect your result"}</button>}
      <details className="match-ops">
        <summary>Match result tools</summary>
        <p>{resultToolsReady
          ? "Final Whistle finds the result sequence automatically. No extra details are needed from you."
          : "Result checks are unavailable right now."}</p>
        <div className="grid action-grid">
          <button className="nb-button cyan" type="button" onClick={() => proofSettle("settlement")} disabled={busy || !resultToolsReady || !marketActionWindowOpen || market.status !== "LOCKED"}>Confirm full-time result</button>
          <button className="nb-button" type="button" onClick={() => proofSettle("cancellation")} disabled={busy || !resultToolsReady || !marketActionWindowOpen || (market.status !== "OPEN" && market.status !== "LOCKED")}>Confirm called-off match</button>
          {canCancelExpired && <button className="nb-button magenta" type="button" onClick={cancelExpired} disabled={busy}>Close expired challenge</button>}
        </div>
      </details>
      <p className="muted" aria-live="polite">{status}</p>
      <PendingIndexingRecovery />
    </div>
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
            : goalCall ? "You backed the lower total" : "You backed the home side not winning";
          const statusLabel = ({ OPEN: "Open to pick", LOCKED: "Picks locked", SETTLED: "Result verified", CANCELLED: "Called off" } as Record<string, string>)[market.status] ?? "Pending";
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

function PendingIndexingRecovery() {
  const [pending, setPending] = useState<PendingIndexingRequest>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const sync = () => setPending(readPendingIndexing());
    sync();
    window.addEventListener(PENDING_INDEXING_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PENDING_INDEXING_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  if (!pending) return null;

  const expiry = Date.parse(pending.expiresAt);
  const canRetry = Number.isFinite(expiry) && expiry > Date.now();
  const retry = async () => {
    if (!canRetry) {
      setStatus("This signed retry has expired. Keep the transaction signature for support.");
      return;
    }
    try {
      setBusy(true);
      setStatus("Saving the confirmed move…");
      const response = await fetch(pending.path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": pending.idempotencyKey
        },
        body: pending.body
      });
      const payload = await response.text();
      if (!response.ok) {
        let message = "The service could not save this confirmed move yet.";
        try {
          const parsed = JSON.parse(payload) as { message?: string };
          message = parsed.message ?? message;
        } catch {
          // Keep the generic retry message when an upstream response is not JSON.
        }
        setStatus(message);
        return;
      }
      completePendingIndexing(pending);
      setPending(undefined);
      setStatus("Your confirmed move is saved. Reloading the board…");
      window.location.reload();
    } catch {
      setStatus("The service is still unavailable. You can retry this exact signed request for a few minutes.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="help-box" role="status">
      <strong>Confirmed {pending.label} needs saving</strong>
      <p>Your transaction is confirmed, but the board has not finished recording it.</p>
      <div className="receipt-actions">
        {canRetry && <button className="nb-button" type="button" onClick={() => void retry()} disabled={busy}>{busy ? "Saving…" : "Retry saving move"}</button>}
        <a className="nb-button" href={explorerTx(pending.transactionSignature)} target="_blank" rel="noreferrer">View transaction</a>
        <button className="nb-button" type="button" onClick={() => { completePendingIndexing(pending); setPending(undefined); }}>Dismiss</button>
      </div>
      <p className="muted" aria-live="polite">{status || (canRetry ? "This retry uses the original signed request and never sends the transaction again." : "The retry window expired; keep the transaction signature for support.")}</p>
    </div>
  );
}

function usePublicConfig() {
  const [config, setConfig] = useState<PublicConfig>();
  const [status, setStatus] = useState("Loading challenge options");
  const refresh = useCallback(() => {
    setStatus("Loading challenge options");
    fetch("/api/public-config")
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.message ?? "Config unavailable");
        setConfig(payload);
        setStatus(payload.programConfigReady ? "Ready" : "Match actions are unavailable right now");
      })
      .catch(() => setStatus("Challenge options are unavailable"));
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
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = latestBlockhash.blockhash;
  const signature = await wallet.sendTransaction(transaction, connection);
  const confirmation = await connection.confirmTransaction({ signature, ...latestBlockhash }, "confirmed");
  if (confirmation.value.err) throw new Error("The transaction did not go through.");
  return signature;
}

async function signedPost(input: {
  route: string;
  params?: Record<string, string>;
  wallet: ReturnType<typeof useWallet>;
  body: Record<string, unknown>;
  programId: string;
  recovery?: { label: string; transactionSignature: string };
}) {
  if (!input.wallet.publicKey || !input.wallet.signMessage) throw new Error("Wallet must support message signing");
  const termsAcceptedAt = window.localStorage.getItem(BETA_TERMS_STORAGE_KEY);
  if (!termsAcceptedAt) throw new Error("Accept the Terms and Privacy Notice before submitting a transaction.");
  const idempotencyKey = crypto.randomUUID();
  const issuedAt = new Date().toISOString();
  const signedMessage = JSON.stringify({
    domain: "finalwhistle",
    version: 2,
    cluster: "devnet",
    programId: input.programId,
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
  const pendingIndexing = input.recovery
    ? {
        idempotencyKey,
        label: input.recovery.label,
        transactionSignature: input.recovery.transactionSignature,
        path,
        body: JSON.stringify(body),
        expiresAt: new Date(Date.parse(issuedAt) + 5 * 60_000).toISOString()
      } satisfies PendingIndexingRequest
    : undefined;
  if (pendingIndexing) savePendingIndexing(pendingIndexing);
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey
    },
    body: JSON.stringify(body)
  });
  return { response, pendingIndexing };
}

function requireNoPendingIndexing(setStatus: (value: string) => void) {
  const pending = readPendingIndexing();
  if (!pending) return true;
  setStatus("Finish saving your previously confirmed move with the retry card below before submitting another transaction.");
  return false;
}

function savePendingIndexing(pending: PendingIndexingRequest) {
  try {
    window.sessionStorage.setItem(PENDING_INDEXING_STORAGE_KEY, JSON.stringify(pending));
    window.dispatchEvent(new Event(PENDING_INDEXING_EVENT));
  } catch {
    // Browser storage can be disabled. The transaction signature is still
    // surfaced in the action status so the user can retain it for support.
  }
}

function readPendingIndexing(): PendingIndexingRequest | undefined {
  try {
    const raw = window.sessionStorage.getItem(PENDING_INDEXING_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (isPendingIndexingRequest(parsed)) return parsed;
    window.sessionStorage.removeItem(PENDING_INDEXING_STORAGE_KEY);
  } catch {
    // Treat malformed or unavailable session storage as no recoverable request.
  }
  return undefined;
}

function completePendingIndexing(pending?: PendingIndexingRequest) {
  if (!pending) return;
  try {
    const current = readPendingIndexing();
    if (current?.idempotencyKey !== pending.idempotencyKey) return;
    window.sessionStorage.removeItem(PENDING_INDEXING_STORAGE_KEY);
    window.dispatchEvent(new Event(PENDING_INDEXING_EVENT));
  } catch {
    // Storage cleanup is best effort and never changes the on-chain action.
  }
}

function isPendingIndexingRequest(value: unknown): value is PendingIndexingRequest {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.idempotencyKey === "string"
    && typeof entry.label === "string"
    && typeof entry.transactionSignature === "string"
    && typeof entry.path === "string"
    && entry.path.startsWith("/api/")
    && typeof entry.body === "string"
    && typeof entry.expiresAt === "string";
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
    return { yes: "Back home side win", no: "Back home not winning" };
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
  if (mint === DEVNET_USDC) return "USDC";
  if (mint === DEVNET_USDT) return "USDT";
  return truncate(mint);
}

function explorerTx(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

function truncate(value: string, chars = 4) {
  return value.length <= chars * 2 + 3 ? value : `${value.slice(0, chars)}...${value.slice(-chars)}`;
}

function errorMessage(error: unknown, submittedSignature?: string) {
  const message = error instanceof Error ? error.message : "Something unexpected happened";
  if (submittedSignature) {
    return `Your transaction ${truncate(submittedSignature)} was confirmed, but this page could not finish recording it. Use the retry card below; if it expires, keep that signature for support.`;
  }
  if (/reject|declin|cancelled by user|user denied/i.test(message)) {
    return "You cancelled the wallet request. Nothing was submitted.";
  }
  return message;
}

function parseTokenAmount(value: string, decimals: number) {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) throw new Error("Enter a positive amount.");
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) throw new Error(`Use no more than ${decimals} decimal places.`);
  const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (raw <= 0n) throw new Error("Enter a positive amount.");
  if (raw > 18_446_744_073_709_551_615n) throw new Error("That amount is too large.");
  return raw;
}

function formatTokenAmount(raw: string, decimals: number) {
  if (decimals === 0) return BigInt(raw).toString();
  const value = raw.padStart(decimals + 1, "0");
  const whole = value.slice(0, -decimals) || "0";
  const fraction = decimals === 0 ? "" : value.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function fixtureTimestamp(value?: string) {
  if (!value) return Number.NaN;
  const numeric = Number(value);
  if (/^\d+$/.test(value.trim()) && Number.isSafeInteger(numeric)) {
    return numeric >= 1_000_000_000_000 ? numeric : numeric * 1_000;
  }
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  return Date.parse(normalized);
}

function hasReachedTime(value?: string, currentTime = Date.now()) {
  const timestamp = fixtureTimestamp(value);
  return Number.isFinite(timestamp) && timestamp <= currentTime;
}

function isFutureTime(value?: string, currentTime = Date.now()) {
  const timestamp = fixtureTimestamp(value);
  return Number.isFinite(timestamp) && timestamp > currentTime;
}

function isActionWindowOpen(market: MarketRecord) {
  return market.status === "OPEN"
    ? isFutureTime(market.lockTs)
    : market.status === "LOCKED"
      ? isFutureTime(market.settlementDeadlineTs)
      : false;
}

function isExpiredMarket(market: MarketRecord) {
  return market.status === "OPEN"
    ? hasReachedTime(market.lockTs)
    : market.status === "LOCKED"
      ? hasReachedTime(market.settlementDeadlineTs)
      : false;
}

function requireBetaTerms(setStatus: (value: string) => void) {
  if (window.localStorage.getItem(BETA_TERMS_STORAGE_KEY)) return true;
  setStatus("Review and accept the Terms and Privacy Notice before continuing.");
  return false;
}
