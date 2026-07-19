# Technical Documentation

FinalWhistle is a football challenge app where two people take opposite sides of a match prediction and stake the same amount of devnet SOL.
One user creates a challenge, another wallet joins the opposite side, and the verified winner collects the pot; cancelled or unmatched challenges can be refunded.
TxLINE provides the supported fixtures, match history, and Merkle proofs for final scores or cancellations.
The Solana program verifies the TxLINE proof on-chain before settling the challenge or releasing refunds.
