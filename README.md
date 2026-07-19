# FinalWhistle

FinalWhistle is a football challenge app for people who want to make a simple, head-to-head prediction about a match.

You choose a supported match and prediction, such as “Team A wins” or “more than 2.5 goals.” Another person takes the opposite side. Each person puts up the same amount of normal devnet SOL. The app wraps SOL only inside the escrow transaction and unwraps a payout back to SOL automatically. When the match is finished, the result is checked through TxLINE and the winning side can claim the payout.

This is an early public beta. It runs on Solana devnet, where SOL has no real-world value. Do not use real money, real tokens, or production wallets with this project.

## Current deployment status

The devnet program, database schema, TxLINE integration, and immutable on-chain settlement configuration are deployed. The app fails closed whenever its configuration, TxLINE service, stake mint, database, or on-chain program configuration is unavailable.

## What is included

- A web app for browsing matches, creating challenges, joining the other side, and viewing payouts.
- Supported predictions for match winners and total goals over/under a line.
- A small Solana program that holds the challenge funds and controls the market lifecycle.
- Wallet-based signing for actions that change funds or market state.
- TxLINE-backed fixture discovery and bounded, freshness-labelled caching.
- Refunds for cancelled, expired, unmatched, or unresolved markets.
- Replay protection so a request cannot accidentally be submitted twice.

## How a challenge works

1. Open a supported football match.
2. Choose a prediction and create a challenge.
3. Another wallet joins the opposite side with the matching stake.
4. The market is locked.
5. TxLINE provides the match result or cancellation status.
6. The Solana program accepts the proof and marks the market settled or cancelled.
7. The winner claims the payout, or participants claim refunds when the market is cancelled.

## Run it locally

You need Node.js 24.x, pnpm, Rust, and the Anchor CLI.

```bash
pnpm install
pnpm dev
```

Useful checks and commands:

```bash
pnpm build
pnpm test
pnpm txline:smoke
anchor build
```

Copy `.env.example` to `.env` before adding a TxLINE token or changing the Solana cluster. Local tests use an isolated in-memory database. A deployed app requires PostgreSQL.

## Technical details

For a brief project and TxLINE overview, see [Technical Documentation](TECHNICAL-DOCUMENTATION.md).

### How TxLINE powers the backend

- Fetches real football fixtures for the match board.
- Finds the final or cancelled match sequence from TxLINE history.
- Requests a Merkle proof for the score stats used by a challenge.
- Sends the proof to the Solana contract for TxLINE on-chain validation.
- Settles a winner or enables refunds only after the proof is verified.
- Cannot choose a winner or release escrow funds by itself.

### TxLINE API feedback

- **Liked:** Proof-backed match data makes settlement verifiable on-chain.
- **Liked:** The backend does not need to be trusted to report the final score.
- **Friction:** Devnet endpoints and response formats changed during integration.
- **Friction:** Setup needs both a guest JWT and an activated API token.
- **Friction:** TxLINE proofs need conversion into the Solana program's required format.

### Application structure

- `apps/web` contains the Next.js App Router application, frontend pages, API routes, and the supported server runtime.
- `programs/final_whistle` contains the Anchor program deployed to Solana.
- PostgreSQL stores the application’s cached fixtures, markets, positions, nonces, and idempotency records.

The browser talks to same-origin Next.js API routes. This keeps wallet writes, authentication checks, rate limits, database updates, and Solana confirmation in one controlled request path.

### On-chain market lifecycle

The Anchor program supports:

- `create_market` — creates a challenge and its token escrow account.
- `join_market` — funds the opposite side.
- `lock_market` — closes participation before settlement.
- `settle_market` — verifies a valid TxLINE proof and records the winning side.
- `cancel_market` — cancels a market using a valid cancellation proof or timeout rule.
- `claim_payout` — lets a winner or refunded participant withdraw funds.

The escrow is a wrapped-SOL SPL token account controlled by the market PDA. The browser converts ordinary devnet SOL to wrapped SOL in the same transaction that funds escrow, then closes the wrapped-SOL account after a payout so the wallet receives ordinary SOL again. The program stores the market rule, stakes, status, winning side, proof hash, and other settlement data on-chain so the payout rules cannot be changed by the API after a market is created.

### Match proofs and settlement

The API prepares proof arguments and the Anchor program performs the configured TxLINE validation CPI before accepting a settlement or cancellation. The API cannot move escrow or simply assert a match result.

An immutable on-chain `ProgramConfig` records the approved TxLINE program. Only the program upgrade authority can initialize that configuration. No API setting can substitute a different validator program.

TxLINE's current Devnet SDK identifies a final soccer record by `action=game_finalised`, `statusId=100`, and `period=100`. FinalWhistle validates the score proof through TxLINE on-chain and requires each proven final score stat to have Merkle-proven `period=100`; it does not rely on a guessed extra finality stat key. Cancellation proofs likewise require a TxLINE-proven documented cancellation period.

Open markets can expire after their lock time, and locked markets have a settlement grace period for unresolved proofs. After the relevant deadline, only the explicit expiry-refund path can close a market.

### Wallet security and replay protection

Mutating API requests require all of the following:

- a fresh wallet-signed message tied to that exact request;
- a previously unused wallet nonce;
- an `Idempotency-Key` header;
- a confirmed Solana transaction containing the expected FinalWhistle instruction; and
- matching on-chain market or position state before PostgreSQL is updated.

The database writes are performed atomically where a request can be retried. Database-backed rate limits protect API buckets across serverless instances. Receipts expose proof hashes and useful metadata, not raw TxLINE proof payloads.

### Data freshness

Fixture and market data is cached in PostgreSQL. Public reads reuse the cache for a bounded interval instead of opening an upstream stream per browser. Stale fixtures are labelled and cannot be used to create a market. The public build contains no replay or invented fixture data.

### Deployment requirements

The public beta is devnet-only and requires:

- `PUBLIC_ORIGIN` set to the deployed frontend origin;
- a pooled PostgreSQL `DATABASE_URL`;
- `TXLINE_API_TOKEN` from secret storage and TxLINE;
- `ALLOWED_STAKE_MINTS=So11111111111111111111111111111111111111112` for wrapped native SOL;
- explicit HTTPS `SOLANA_RPC_URL` and matching `NEXT_PUBLIC_SOLANA_RPC_URL` values;
- a deployed Anchor program with its immutable `ProgramConfig` initialized; and
- `REQUIRE_IDEMPOTENCY_KEYS=true`.

### Custom production domain cutover

The browser uses only same-origin API routes and wallet signing does not bind to a website hostname, so moving the public hostname does not change market, database, or Solana state. `PUBLIC_ORIGIN` is the one authoritative web origin: it validates the production runtime configuration and produces the canonical URL in page metadata.

When `finalwhistle.raghav.codes` is ready to become the production address:

1. In the Vercel project, add `finalwhistle.raghav.codes` under **Settings → Domains**. Let Vercel show the exact DNS target for the domain.
2. At the DNS provider for `raghav.codes`, create the CNAME record Vercel requests for the `finalwhistle` subdomain. Do not replace the apex-domain records. Wait until Vercel marks the domain as valid and its TLS certificate as issued.
3. In **Settings → Environment Variables**, set `PUBLIC_ORIGIN=https://finalwhistle.raghav.codes` for **Production** only. It must be just the HTTPS origin—no trailing route, query string, or fragment. Keep preview deployments on their own existing origin/configuration.
4. Redeploy the production branch. Vercel applies environment-variable changes only to new deployments.
5. Verify `https://finalwhistle.raghav.codes/api/health` returns `200` with every dependency marked `ok`; then verify a wallet connection, fixture refresh, a signed devnet action, and the favicon in a fresh browser profile.
6. After the custom domain passes those checks, configure the former `*.vercel.app` production domain to redirect to the custom domain in Vercel. Keep the old deployment available until the redirect and health check are confirmed.

Use Vercel's domain inspection rather than guessing the DNS target; Vercel's required CNAME can vary by project and account setup. Vercel's current documentation covers [custom-domain setup](https://vercel.com/docs/domains/set-up-custom-domain) and [production environment variables](https://vercel.com/docs/environment-variables/managing-environment-variables).

Run the database migration before deploying a schema change:

```bash
pnpm --filter @final-whistle/web db:migrate
```

The health endpoint reports `503` until TxLINE, verified stake mints, PostgreSQL, and the on-chain `ProgramConfig` are ready. Production requests do not run schema creation automatically. This is intentional: do not invite users to create markets while health is not `200`.

Never commit `.env` files, database files, keypairs, `node_modules`, `.next`, `target`, or other build output. Keep `FINAL_WHISTLE_UPGRADE_AUTHORITY_KEYPAIR` only in the operator’s local environment when initializing the program configuration.

## Important limitations

This repository is not a finished production betting product. It still requires independent smart-contract review, operational monitoring, valid TxLINE credentials, production infrastructure, and legal review before any real-money use. The current beta is for devnet testing and demonstrations only.
