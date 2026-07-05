# FinalWhistle

Proof-settled football challenge markets using a small Anchor escrow program and a same-origin Next.js API.

## Implemented

- Anchor program in `programs/final_whistle`.
- Direct challenge market flow:
  - `create_market`
  - `join_market`
  - `lock_market`
  - `settle_market`
  - `cancel_market`
  - `claim_payout`
- SPL token escrow owned by the market PDA.
- Fixed predicates for:
  - `MATCH_WINNER`
  - `TOTAL_GOALS_OVER_UNDER`
- Next.js App Router MVP in `apps/web` with frontend pages and API route handlers.
- The old Fastify service in `backend/` is retired and intentionally cannot be started.
- TxLINE guest-session/API-token handling.
- Cached fixture and market storage in managed PostgreSQL.
- Score stream proxy at `/stream/scores`.
- Settlement/cancellation proof preparation and receipt endpoints.
- Wallet-signed API writes plus confirmed Solana transaction checks.
- On-chain TxLINE proof validation for settlement/cancellation.
- Immutable on-chain `ProgramConfig`: only the program upgrade authority can set the TxLINE program and finality stat key used for every settlement.
- Program-derived proof receipt hashes, exact on-chain market-rule indexing, atomic nonce/idempotency writes, and a bounded score-stream limiter.
- Expired-market cancellation path for refunding unmatched or unresolved markets.
- Replay protection for API writes through wallet nonces and idempotency keys.

## Commands

```bash
pnpm install
pnpm build
pnpm test
pnpm dev
pnpm txline:smoke
anchor build
```

The app defaults to devnet TxLINE endpoints and runs as one Node runtime Next.js service. Every deployed runtime requires a pooled PostgreSQL `DATABASE_URL`; Vercel's Neon integration is suitable for the public beta. Local tests use an isolated in-memory database only.

Copy `.env.example` to `.env` when adding a TxLINE API token or changing the Solana cluster.

## Beta Settlement

Settlement and cancellation are designed to fail closed. The API fetches TxLINE stat-validation payloads and returns the accounts/arguments needed by the client, but the FinalWhistle Anchor program performs the TxLINE `validate_stat` CPI before it settles or cancels a market. It also checks the immutable `ProgramConfig` account, so a caller cannot select an unrelated finality stat or TxLINE program.

`TXLINE_FINALITY_STAT_KEY` must be set before public settlement is enabled. It must be a TxLINE-provable soccer phase stat whose value is the numeric phase ID. Final phases are accepted for settlement; cancelled, postponed, abandoned, and coverage-suspended phases are accepted for refund cancellation. If the stat key is not configured, proof-preparation endpoints return `503` instead of allowing fallback settlement.

Markets also have an on-chain timeout path. Open markets can be cancelled after `lock_ts`, and locked markets can be cancelled after the program's settlement grace period if no valid TxLINE settlement/cancellation proof arrives. Once cancelled, each funded position can claim its own refund through `claim_payout`.

API mutating routes require:

- a fresh request-bound wallet-signed JSON message with an unused nonce,
- an `Idempotency-Key` header,
- a confirmed transaction containing the expected FinalWhistle Anchor instruction,
- and matching on-chain market/position account state after transaction confirmation before PostgreSQL is updated.

The public beta is devnet-only and uses test tokens only. Health reports `503` until TxLINE and the on-chain `ProgramConfig` are both available. Stale fixture cache data cannot be used to create live markets; replay fixtures stay visibly labeled.

See `docs/devnet-checklist.md` for the manual demo flow.

Public beta deployment requirements:

- Set `PUBLIC_ORIGIN` to the production frontend origin.
- Set `DATABASE_URL`, `TXLINE_API_TOKEN`, `TXLINE_PROGRAM_ID`, and `TXLINE_FINALITY_STAT_KEY` from secret storage. Use a pooled/serverless PostgreSQL URL; never commit it.
- Run `pnpm --filter @final-whistle/web db:migrate` with the production `DATABASE_URL` before deploying a schema change. Production requests never run schema DDL themselves.
- Set `ALLOWED_STAKE_MINTS` explicitly to devnet mints accepted by the program.
- Deploy the hardened program, then initialize its immutable `ProgramConfig` once with the upgrade authority before enabling the UI. Set `FINAL_WHISTLE_UPGRADE_AUTHORITY_KEYPAIR` only in the operator shell and run `pnpm --filter @final-whistle/web program:initialize-config`. The `/api/public-config` endpoint must report `programConfigReady: true`.
- Keep `REQUIRE_IDEMPOTENCY_KEYS=true` for public deployments.
- Set `TRUST_PROXY=true` only behind a proxy that overwrites forwarded-IP headers.
- Do not publish `target/deploy/*keypair*.json`, local `*.db` files, `node_modules`, or build output as source artifacts.
- API mutating routes require wallet-signed Terms acknowledgement, unused nonces, idempotency keys, and confirmed Solana transaction signatures.
- Receipts expose proof hashes and metadata, not raw TxLINE proof payloads.

The repo changes do not substitute for independent smart-contract review, operational monitoring, TxLINE credentials, or counsel approval. See the beta runbook before opening access.
