# TxLINE in FinalWhistle

## Core idea

FinalWhistle lets two people make opposite football predictions, such as who will win a match or whether total goals will be over a line. Both put equal devnet SOL into a Solana escrow. TxLINE supplies the verified match evidence needed to settle the challenge.

TxLINE is not used as a simple score feed that the server blindly trusts. It is the verification layer behind settlement: FinalWhistle asks TxLINE for a proof, then the Solana program checks that proof before it records a winner or allows refunds.

## How TxLINE powers the app

1. **Show real fixtures.** The backend fetches supported football fixtures from TxLINE and keeps a short-lived cache for the match board.
2. **Find the final match update.** When a market is locked, the backend reads the fixture's TxLINE history and finds the latest final or cancelled record and its sequence number.
3. **Get proof for the relevant score stats.** For example, a match-winner market asks for home-goals and away-goals proof; an over/under market asks for proof of both goal totals.
4. **Validate on-chain.** The user's wallet sends the prepared proof to FinalWhistle's Anchor program. That program makes a CPI call to TxLINE's on-chain validator.
5. **Settle safely.** Only if TxLINE validates the proof, and the fixture, stats, final period, and sequence all match, does the contract mark the winning side. A cancelled-match proof instead enables refunds.

In simple words: **TxLINE proves what happened; the smart contract decides whether that proof can settle the challenge.** The backend prepares the request, but it cannot choose a winner or move escrow funds by itself.

## Technical and business highlights

- Built for football head-to-head challenges on Solana devnet; devnet SOL has no real-world value.
- Supports match-winner and total-goals-over/under predictions.
- Escrow, settlement state, and payout rules are stored on-chain.
- TxLINE final-score proofs must come from the documented final record (`game_finalised`, `statusId=100`, `period=100`).
- Every settlement uses a newer TxLINE sequence, so an old result cannot be replayed.
- The approved TxLINE validator program is fixed in FinalWhistle's on-chain configuration; the API cannot swap it for another validator.
- Fixture data is cached briefly to keep the interface responsive. If the cache becomes too old or TxLINE is unavailable, the app fails closed instead of creating a market from unreliable data.
- Settlement is user-triggered after TxLINE publishes a proof. This is not a live, second-by-second score stream.

## TxLINE endpoints

| Endpoint | Why FinalWhistle uses it |
| --- | --- |
| `POST /auth/guest/start` | Gets a short-lived guest JWT for TxLINE requests. |
| `GET /api/fixtures/snapshot` | Loads the supported fixture board. |
| `GET /api/scores/historical/{fixtureId}` | Finds the final or cancelled TxLINE update and its sequence number. |
| `GET /api/scores/stat-validation?fixtureId={id}&seq={seq}&statKey={key}&statKey2={key}` | Gets the Merkle proof for the score stats required to settle a market. `statKey2` is optional. |
| `POST /api/token/activate` | Used during setup to activate the TxLINE API token after the TxLINE subscription transaction. |
