use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    hash::hashv,
    instruction::{AccountMeta, Instruction},
    program::{get_return_data, invoke},
};
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use crate::program::FinalWhistle;
use std::str::FromStr;

declare_id!("Hf4KSaGy7EHEaT9jMCo9nKx2uQRz6BEsYS3DrprkDaPw");

const MARKET_SEED: &[u8] = b"market";
const ESCROW_SEED: &[u8] = b"escrow";
const POSITION_SEED: &[u8] = b"position";
const CONFIG_SEED: &[u8] = b"config";
const MAX_FIXTURE_ID_LEN: usize = 64;
const TXLINE_DEVNET_PROGRAM_ID: &str = "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J";
const TXLINE_VALIDATE_STAT_DISCRIMINATOR: [u8; 8] = [107, 197, 232, 90, 191, 136, 105, 185];
const SETTLEMENT_GRACE_PERIOD_SECONDS: i64 = 14 * 24 * 60 * 60;
const MAX_MARKET_OPEN_SECONDS: i64 = 24 * 60 * 60;
const DEVNET_USDC_MINT: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const TXLINE_DEVNET_USDT_MINT: &str = "ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh";

#[program]
pub mod final_whistle {
    use super::*;

    /// Creates the immutable trust root used for every market and TxLINE
    /// settlement. Only the program's current upgrade authority may execute
    /// this instruction, so an arbitrary transaction signer cannot choose a
    /// different finality stat or CPI target.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        txline_program: Pubkey,
        finality_stat_key: u32,
    ) -> Result<()> {
        require_allowed_txline_program(txline_program)?;
        require!(finality_stat_key > 0, FinalWhistleError::InvalidFinalityStatKey);

        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.txline_program = txline_program;
        config.finality_stat_key = finality_stat_key;
        config.bump = ctx.bumps.config;

        emit!(ProgramConfigured {
            authority: config.authority,
            txline_program: config.txline_program,
            finality_stat_key: config.finality_stat_key,
        });
        Ok(())
    }

    pub fn create_market(
        ctx: Context<CreateMarket>,
        fixture_id: String,
        market_nonce: u64,
        template: MarketTemplate,
        predicate: Predicate,
        lock_ts: i64,
    ) -> Result<()> {
        require!(
            fixture_id.as_bytes().len() <= MAX_FIXTURE_ID_LEN,
            FinalWhistleError::FixtureIdTooLong
        );
        let now = Clock::get()?.unix_timestamp;
        require!(lock_ts > now, FinalWhistleError::InvalidLockTime);
        require!(
            lock_ts <= now.checked_add(MAX_MARKET_OPEN_SECONDS).ok_or(FinalWhistleError::MathOverflow)?,
            FinalWhistleError::InvalidLockTime
        );
        require_canonical_fixture_id(&fixture_id)?;
        require!(predicate.is_valid_for_template(template), FinalWhistleError::InvalidPredicate);
        require_allowed_stake_mint(ctx.accounts.token_mint.key())?;

        let market = &mut ctx.accounts.market;
        market.creator = ctx.accounts.creator.key();
        market.fixture_id = fixture_id;
        market.market_nonce = market_nonce;
        market.market_template = template;
        market.stat_key_1 = predicate.stat_key_1;
        market.stat_key_2 = predicate.stat_key_2;
        market.operator = predicate.operator;
        market.threshold_milli = predicate.threshold_milli;
        market.comparison = predicate.comparison;
        market.lock_ts = lock_ts;
        market.settlement_deadline_ts = lock_ts
            .checked_add(SETTLEMENT_GRACE_PERIOD_SECONDS)
            .ok_or(FinalWhistleError::MathOverflow)?;
        market.status = MarketStatus::Open;
        market.yes_stake = 0;
        market.no_stake = 0;
        market.yes_positions = 0;
        market.no_positions = 0;
        market.escrow_token_account = ctx.accounts.escrow_token_account.key();
        market.token_mint = ctx.accounts.token_mint.key();
        market.winning_side = None;
        market.settlement_txline_seq = 0;
        market.settlement_proof_hash = [0; 32];
        market.bump = ctx.bumps.market;

        emit!(MarketCreated {
            market: market.key(),
            creator: market.creator,
            fixture_id: market.fixture_id.clone(),
            token_mint: market.token_mint,
            lock_ts: market.lock_ts,
            settlement_deadline_ts: market.settlement_deadline_ts,
        });
        Ok(())
    }

    pub fn join_market(ctx: Context<JoinMarket>, side: Side, amount: u64) -> Result<()> {
        require!(amount > 0, FinalWhistleError::InvalidStakeAmount);

        let market = &mut ctx.accounts.market;
        require!(market.status == MarketStatus::Open, FinalWhistleError::MarketNotOpen);
        require!(Clock::get()?.unix_timestamp < market.lock_ts, FinalWhistleError::MarketLocked);

        let position = &mut ctx.accounts.position;
        require!(!position.initialized, FinalWhistleError::PositionAlreadyExists);

        match side {
            Side::Yes => {
                require!(market.yes_positions == 0, FinalWhistleError::SideAlreadyFunded);
                require!(
                    market.no_stake == 0 || market.no_stake == amount,
                    FinalWhistleError::StakeMustMatch
                );
                market.yes_stake = market.yes_stake.checked_add(amount).ok_or(FinalWhistleError::MathOverflow)?;
                market.yes_positions = market.yes_positions.checked_add(1).ok_or(FinalWhistleError::MathOverflow)?;
            }
            Side::No => {
                require!(market.no_positions == 0, FinalWhistleError::SideAlreadyFunded);
                require!(
                    market.yes_stake == 0 || market.yes_stake == amount,
                    FinalWhistleError::StakeMustMatch
                );
                market.no_stake = market.no_stake.checked_add(amount).ok_or(FinalWhistleError::MathOverflow)?;
                market.no_positions = market.no_positions.checked_add(1).ok_or(FinalWhistleError::MathOverflow)?;
            }
        }

        position.initialized = true;
        position.market = market.key();
        position.user = ctx.accounts.user.key();
        position.side = side;
        position.stake_amount = amount;
        position.claimed = false;
        position.bump = ctx.bumps.position;

        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.escrow_token_account.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.token_mint.decimals,
        )?;

        if market.yes_stake > 0 && market.yes_stake == market.no_stake {
            market.status = MarketStatus::Locked;
            emit!(MarketLocked { market: market.key() });
        }

        emit!(PositionJoined {
            market: market.key(),
            user: ctx.accounts.user.key(),
            side,
            amount,
        });
        Ok(())
    }

    pub fn lock_market(ctx: Context<UpdateMarket>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.status == MarketStatus::Open, FinalWhistleError::MarketNotOpen);
        require!(market.yes_stake > 0 && market.yes_stake == market.no_stake, FinalWhistleError::UnbalancedMarket);
        market.status = MarketStatus::Locked;
        emit!(MarketLocked { market: market.key() });
        Ok(())
    }

    pub fn cancel_expired_market(ctx: Context<UpdateMarket>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let now = Clock::get()?.unix_timestamp;
        match market.status {
            MarketStatus::Open => {
                require!(now >= market.lock_ts, FinalWhistleError::MarketNotExpired);
            }
            MarketStatus::Locked => {
                require!(
                    now >= market.settlement_deadline_ts,
                    FinalWhistleError::MarketNotExpired
                );
            }
            _ => return err!(FinalWhistleError::InvalidMarketStatus),
        }

        market.status = MarketStatus::Cancelled;
        market.winning_side = None;
        emit!(MarketCancelled {
            market: market.key(),
            txline_seq: market.settlement_txline_seq,
            proof_hash: market.settlement_proof_hash,
            reason: CancellationReason::Expired,
        });
        Ok(())
    }

    pub fn settle_market(ctx: Context<SettleMarket>, args: TxlineValidationArgs) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let program_config = &ctx.accounts.config;
        require!(market.status == MarketStatus::Locked, FinalWhistleError::MarketNotLocked);
        require_market_action_window(
            market.status,
            Clock::get()?.unix_timestamp,
            market.lock_ts,
            market.settlement_deadline_ts,
        )?;
        require_allowed_txline_program(program_config.txline_program)?;
        require_keys_eq!(
            ctx.accounts.txline_program.key(),
            program_config.txline_program,
            FinalWhistleError::InvalidTxlineProgram
        );
        require!(
            args.finality_stat_key == program_config.finality_stat_key,
            FinalWhistleError::FinalityStatKeyMismatch
        );
        require!(args.fixture_id.to_string() == market.fixture_id, FinalWhistleError::FixtureMismatch);
        require!(args.stat_key_1 == u32::from(market.stat_key_1), FinalWhistleError::StatKeyMismatch);
        require!(args.seq > market.settlement_txline_seq, FinalWhistleError::InvalidSequence);

        if market.operator != StatOperator::None {
            require!(args.stat_key_2 == market.stat_key_2.map(u32::from), FinalWhistleError::StatKeyMismatch);
            require!(args.outcome_proof.stat_b.is_some(), FinalWhistleError::MissingSecondStat);
        }
        require!(
            args.finality_proof.stat_a.stat_to_prove.value == args.final_phase_id,
            FinalWhistleError::MatchNotFinal
        );
        require_txline_proof_fixture(&args.outcome_proof, args.fixture_id)?;
        require_txline_proof_fixture(&args.finality_proof, args.fixture_id)?;
        require_matching_txline_snapshot(&args.outcome_proof, &args.finality_proof)?;
        require_txline_proof_stat(&args.outcome_proof, args.stat_key_1, args.stat_key_2)?;
        require_txline_proof_stat(&args.finality_proof, args.finality_stat_key, None)?;
        require!(is_final_phase_id(args.final_phase_id), FinalWhistleError::MatchNotFinal);

        validate_txline_stat(
            ctx.accounts.txline_program.to_account_info(),
            ctx.accounts.daily_scores_merkle_roots.to_account_info(),
            &args.outcome_proof,
        )?;
        validate_txline_stat(
            ctx.accounts.txline_program.to_account_info(),
            ctx.accounts.daily_scores_merkle_roots.to_account_info(),
            &args.finality_proof,
        )?;

        let observed = match market.operator {
            StatOperator::None => i64::from(args.outcome_proof.stat_a.stat_to_prove.value)
                .checked_mul(1000)
                .ok_or(FinalWhistleError::MathOverflow)?,
            StatOperator::Add => args
                .outcome_proof
                .stat_a
                .stat_to_prove
                .value
                .checked_add(args.outcome_proof.stat_b.as_ref().unwrap().stat_to_prove.value)
                .map(i64::from)
                .and_then(|v| v.checked_mul(1000))
                .ok_or(FinalWhistleError::MathOverflow)?,
            StatOperator::Subtract => args
                .outcome_proof
                .stat_a
                .stat_to_prove
                .value
                .checked_sub(args.outcome_proof.stat_b.as_ref().unwrap().stat_to_prove.value)
                .map(i64::from)
                .and_then(|v| v.checked_mul(1000))
                .ok_or(FinalWhistleError::MathOverflow)?,
        };

        let predicate_true = match market.comparison {
            Comparison::GreaterThan => observed > market.threshold_milli,
            Comparison::LessThan => observed < market.threshold_milli,
            Comparison::Equal => observed == market.threshold_milli,
        };

        let proof_hash = hash_settlement_proofs(&args.outcome_proof, &args.finality_proof)?;

        market.status = MarketStatus::Settled;
        market.winning_side = Some(if predicate_true { Side::Yes } else { Side::No });
        market.settlement_txline_seq = args.seq;
        market.settlement_proof_hash = proof_hash;
        emit!(MarketSettled {
            market: market.key(),
            winning_side: market.winning_side.unwrap(),
            txline_seq: args.seq,
            proof_hash,
        });
        Ok(())
    }

    pub fn cancel_market(ctx: Context<SettleMarket>, args: CancellationArgs) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let program_config = &ctx.accounts.config;
        require_allowed_txline_program(program_config.txline_program)?;
        require_keys_eq!(
            ctx.accounts.txline_program.key(),
            program_config.txline_program,
            FinalWhistleError::InvalidTxlineProgram
        );
        require!(
            args.cancellation_stat_key == program_config.finality_stat_key,
            FinalWhistleError::FinalityStatKeyMismatch
        );
        require_market_action_window(
            market.status,
            Clock::get()?.unix_timestamp,
            market.lock_ts,
            market.settlement_deadline_ts,
        )?;
        require!(args.fixture_id.to_string() == market.fixture_id, FinalWhistleError::FixtureMismatch);
        require!(args.seq > market.settlement_txline_seq, FinalWhistleError::InvalidSequence);
        require!(
            args.cancellation_proof.stat_a.stat_to_prove.value == args.cancellation_phase_id,
            FinalWhistleError::InvalidCancellationPhase
        );
        require_txline_proof_fixture(&args.cancellation_proof, args.fixture_id)?;
        require_txline_proof_stat(&args.cancellation_proof, args.cancellation_stat_key, None)?;
        require!(
            is_cancel_phase_id(args.cancellation_phase_id),
            FinalWhistleError::InvalidCancellationPhase
        );

        validate_txline_stat(
            ctx.accounts.txline_program.to_account_info(),
            ctx.accounts.daily_scores_merkle_roots.to_account_info(),
            &args.cancellation_proof,
        )?;

        let proof_hash = hash_cancellation_proof(&args.cancellation_proof)?;

        market.status = MarketStatus::Cancelled;
        market.winning_side = None;
        market.settlement_txline_seq = args.seq;
        market.settlement_proof_hash = proof_hash;
        emit!(MarketCancelled {
            market: market.key(),
            txline_seq: args.seq,
            proof_hash,
            reason: CancellationReason::TxlinePhase,
        });
        Ok(())
    }

    pub fn claim_payout(ctx: Context<ClaimPayout>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let position = &mut ctx.accounts.position;
        require!(!position.claimed, FinalWhistleError::AlreadyClaimed);
        require!(position.market == market.key(), FinalWhistleError::PositionMarketMismatch);
        require!(position.user == ctx.accounts.user.key(), FinalWhistleError::PositionUserMismatch);

        let amount = match market.status {
            MarketStatus::Settled => {
                require!(market.winning_side == Some(position.side), FinalWhistleError::NotWinningPosition);
                market.yes_stake.checked_add(market.no_stake).ok_or(FinalWhistleError::MathOverflow)?
            }
            MarketStatus::Cancelled => position.stake_amount,
            _ => return err!(FinalWhistleError::MarketNotClaimable),
        };

        position.claimed = true;

        let signer_seeds: &[&[&[u8]]] = &[&[
            MARKET_SEED,
            market.creator.as_ref(),
            market.fixture_id.as_bytes(),
            &market.market_nonce.to_le_bytes(),
            &[market.bump],
        ]];

        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: market.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            ctx.accounts.token_mint.decimals,
        )?;

        emit!(PayoutClaimed {
            market: market.key(),
            user: ctx.accounts.user.key(),
            amount,
            cancelled: market.status == MarketStatus::Cancelled,
        });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(fixture_id: String, market_nonce: u64)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProgramConfig>,
    #[account(
        init,
        payer = creator,
        space = Market::SPACE,
        seeds = [MARKET_SEED, creator.key().as_ref(), fixture_id.as_bytes(), &market_nonce.to_le_bytes()],
        bump
    )]
    pub market: Account<'info, Market>,
    #[account(
        init,
        payer = creator,
        token::mint = token_mint,
        token::authority = market,
        seeds = [ESCROW_SEED, market.key().as_ref()],
        bump
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,
    pub token_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = ProgramConfig::SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, ProgramConfig>,
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ FinalWhistleError::InvalidProgramConfig
    )]
    pub program: Program<'info, FinalWhistle>,
    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key())
            @ FinalWhistleError::UnauthorizedConfigAuthority
    )]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinMarket<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, has_one = token_mint, has_one = escrow_token_account)]
    pub market: Account<'info, Market>,
    #[account(
        init,
        payer = user,
        space = Position::SPACE,
        seeds = [POSITION_SEED, market.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,
    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.mint == token_mint.key()
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut, constraint = escrow_token_account.mint == token_mint.key())]
    pub escrow_token_account: Account<'info, TokenAccount>,
    pub token_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdateMarket<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct SettleMarket<'info> {
    /// CHECK: Validated against the TxLINE devnet allowlist before CPI.
    pub txline_program: AccountInfo<'info>,
    /// CHECK: TxLINE validates this PDA and owner inside validate_stat.
    pub daily_scores_merkle_roots: AccountInfo<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProgramConfig>,
    #[account(mut)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct ClaimPayout<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, has_one = token_mint, has_one = escrow_token_account)]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [POSITION_SEED, market.key().as_ref(), user.key().as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, Position>,
    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.mint == token_mint.key()
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut, constraint = escrow_token_account.mint == token_mint.key())]
    pub escrow_token_account: Account<'info, TokenAccount>,
    pub token_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Market {
    pub creator: Pubkey,
    pub fixture_id: String,
    pub market_nonce: u64,
    pub market_template: MarketTemplate,
    pub stat_key_1: u16,
    pub stat_key_2: Option<u16>,
    pub operator: StatOperator,
    pub threshold_milli: i64,
    pub comparison: Comparison,
    pub lock_ts: i64,
    pub settlement_deadline_ts: i64,
    pub status: MarketStatus,
    pub yes_stake: u64,
    pub no_stake: u64,
    pub yes_positions: u8,
    pub no_positions: u8,
    pub escrow_token_account: Pubkey,
    pub token_mint: Pubkey,
    pub winning_side: Option<Side>,
    pub settlement_txline_seq: u64,
    pub settlement_proof_hash: [u8; 32],
    pub bump: u8,
}

/// Immutable program-wide settlement configuration. It is created only by the
/// upgrade authority and intentionally has no update instruction: a market's
/// meaning cannot change after the beta is configured.
#[account]
pub struct ProgramConfig {
    pub authority: Pubkey,
    pub txline_program: Pubkey,
    pub finality_stat_key: u32,
    pub bump: u8,
}

impl ProgramConfig {
    pub const SPACE: usize = 8 + 32 + 32 + 4 + 1;
}

impl Market {
    pub const SPACE: usize = 8
        + 32
        + (4 + MAX_FIXTURE_ID_LEN)
        + 8
        + 8
        + 1
        + 2
        + (1 + 2)
        + 1
        + 8
        + 1
        + 8
        + 1
        + 8
        + 8
        + 1
        + 1
        + 32
        + 32
        + (1 + 1)
        + 8
        + 32
        + 1;
}

#[account]
pub struct Position {
    pub initialized: bool,
    pub market: Pubkey,
    pub user: Pubkey,
    pub side: Side,
    pub stake_amount: u64,
    pub claimed: bool,
    pub bump: u8,
}

impl Position {
    pub const SPACE: usize = 8 + 1 + 32 + 32 + 1 + 8 + 1 + 1;
}

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub creator: Pubkey,
    pub fixture_id: String,
    pub token_mint: Pubkey,
    pub lock_ts: i64,
    pub settlement_deadline_ts: i64,
}

#[event]
pub struct PositionJoined {
    pub market: Pubkey,
    pub user: Pubkey,
    pub side: Side,
    pub amount: u64,
}

#[event]
pub struct MarketLocked {
    pub market: Pubkey,
}

#[event]
pub struct MarketSettled {
    pub market: Pubkey,
    pub winning_side: Side,
    pub txline_seq: u64,
    pub proof_hash: [u8; 32],
}

#[event]
pub struct MarketCancelled {
    pub market: Pubkey,
    pub txline_seq: u64,
    pub proof_hash: [u8; 32],
    pub reason: CancellationReason,
}

#[event]
pub struct PayoutClaimed {
    pub market: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub cancelled: bool,
}

#[event]
pub struct ProgramConfigured {
    pub authority: Pubkey,
    pub txline_program: Pubkey,
    pub finality_stat_key: u32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum MarketTemplate {
    MatchWinner,
    TotalGoalsOverUnder,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum MarketStatus {
    Open,
    Locked,
    Settled,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Yes,
    No,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum CancellationReason {
    TxlinePhase,
    Expired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum StatOperator {
    None,
    Add,
    Subtract,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Comparison {
    GreaterThan,
    LessThan,
    Equal,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Predicate {
    pub stat_key_1: u16,
    pub stat_key_2: Option<u16>,
    pub operator: StatOperator,
    pub threshold_milli: i64,
    pub comparison: Comparison,
}

impl Predicate {
    pub fn is_valid_for_template(&self, template: MarketTemplate) -> bool {
        match template {
            MarketTemplate::MatchWinner => {
                self.stat_key_1 == 1
                    && self.stat_key_2 == Some(2)
                    && self.operator == StatOperator::Subtract
                    && self.threshold_milli == 0
                    && self.comparison == Comparison::GreaterThan
            }
            MarketTemplate::TotalGoalsOverUnder => {
                self.stat_key_1 == 1
                    && self.stat_key_2 == Some(2)
                    && self.operator == StatOperator::Add
                    && (500..=8500).contains(&self.threshold_milli)
                    && self.threshold_milli % 1000 == 500
                    && self.comparison == Comparison::GreaterThan
            }
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TxlineValidationArgs {
    pub fixture_id: i64,
    pub seq: u64,
    pub stat_key_1: u32,
    pub stat_key_2: Option<u32>,
    pub outcome_proof: TxlineStatValidationProof,
    pub finality_proof: TxlineStatValidationProof,
    pub finality_stat_key: u32,
    pub final_phase_id: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CancellationArgs {
    pub fixture_id: i64,
    pub seq: u64,
    pub cancellation_proof: TxlineStatValidationProof,
    pub cancellation_stat_key: u32,
    pub cancellation_phase_id: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TxlineStatValidationProof {
    pub ts: i64,
    pub fixture_summary: TxlineScoresBatchSummary,
    pub fixture_proof: Vec<TxlineProofNode>,
    pub main_tree_proof: Vec<TxlineProofNode>,
    pub predicate: TxlineTraderPredicate,
    pub stat_a: TxlineStatTerm,
    pub stat_b: Option<TxlineStatTerm>,
    pub op: Option<TxlineBinaryExpression>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TxlineScoresBatchSummary {
    pub fixture_id: i64,
    pub update_stats: TxlineScoresUpdateStats,
    pub events_sub_tree_root: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TxlineScoresUpdateStats {
    pub update_count: i32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TxlineProofNode {
    pub hash: [u8; 32],
    pub is_right_sibling: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TxlineStatTerm {
    pub stat_to_prove: TxlineScoreStat,
    pub event_stat_root: [u8; 32],
    pub stat_proof: Vec<TxlineProofNode>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TxlineScoreStat {
    pub key: u32,
    pub value: i32,
    pub period: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TxlineTraderPredicate {
    pub threshold: i32,
    pub comparison: TxlineComparison,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum TxlineComparison {
    GreaterThan,
    LessThan,
    EqualTo,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum TxlineBinaryExpression {
    Add,
    Subtract,
}

fn is_final_phase_id(phase_id: i32) -> bool {
    matches!(phase_id, 5 | 10 | 13)
}

fn is_cancel_phase_id(phase_id: i32) -> bool {
    matches!(phase_id, 14 | 15 | 16 | 17 | 18 | 19)
}

/// Once an expiry refund is available, proof-based state changes must stop so
/// a delayed settlement cannot race `cancel_expired_market`. Open markets
/// expire at lock time; balanced markets expire at their settlement deadline.
fn require_market_action_window(
    status: MarketStatus,
    now: i64,
    lock_ts: i64,
    settlement_deadline_ts: i64,
) -> Result<()> {
    let expiry = match status {
        MarketStatus::Open => lock_ts,
        MarketStatus::Locked => settlement_deadline_ts,
        _ => return err!(FinalWhistleError::InvalidMarketStatus),
    };
    require!(now < expiry, FinalWhistleError::MarketActionWindowExpired);
    Ok(())
}

/// Markets store fixture IDs as PDA seed bytes but settlement receives the
/// TxLINE ID as an `i64`. Requiring the canonical decimal representation keeps
/// those two forms bijective: IDs such as `001`, `+1`, and `-0` would otherwise
/// create a market that no valid settlement payload could reference.
fn require_canonical_fixture_id(fixture_id: &str) -> Result<()> {
    let parsed = fixture_id
        .parse::<i64>()
        .map_err(|_| error!(FinalWhistleError::InvalidFixtureId))?;
    require!(
        parsed >= 0 && parsed.to_string() == fixture_id,
        FinalWhistleError::InvalidFixtureId
    );
    Ok(())
}

fn require_txline_proof_fixture(proof: &TxlineStatValidationProof, fixture_id: i64) -> Result<()> {
    require!(
        proof.fixture_summary.fixture_id == fixture_id,
        FinalWhistleError::FixtureMismatch
    );
    Ok(())
}

/// A finality proof can be valid while an older score proof is also valid. A
/// settlement must use both values from the same TxLINE fixture snapshot, or a
/// caller could combine a pre-final score with a later finality record.
fn require_matching_txline_snapshot(
    outcome_proof: &TxlineStatValidationProof,
    finality_proof: &TxlineStatValidationProof,
) -> Result<()> {
    let outcome = &outcome_proof.fixture_summary;
    let finality = &finality_proof.fixture_summary;
    require!(
        outcome.fixture_id == finality.fixture_id
            && outcome.update_stats.update_count == finality.update_stats.update_count
            && outcome.update_stats.min_timestamp == finality.update_stats.min_timestamp
            && outcome.update_stats.max_timestamp == finality.update_stats.max_timestamp
            && outcome.events_sub_tree_root == finality.events_sub_tree_root,
        FinalWhistleError::TxlineProofSnapshotMismatch
    );
    Ok(())
}

fn require_txline_proof_stat(
    proof: &TxlineStatValidationProof,
    stat_key_1: u32,
    stat_key_2: Option<u32>,
) -> Result<()> {
    require!(
        proof.stat_a.stat_to_prove.key == stat_key_1,
        FinalWhistleError::StatKeyMismatch
    );
    match stat_key_2 {
        Some(expected) => {
            let stat_b = proof.stat_b.as_ref().ok_or(FinalWhistleError::MissingSecondStat)?;
            require!(
                stat_b.stat_to_prove.key == expected,
                FinalWhistleError::StatKeyMismatch
            );
        }
        None => {
            require!(proof.stat_b.is_none(), FinalWhistleError::StatKeyMismatch);
        }
    }
    Ok(())
}

/// Hash the exact Borsh-encoded proof payloads accepted by this program. The
/// hash is derived on-chain rather than supplied by the caller, making the
/// stored receipt cryptographically tied to the evidence that was CPI-checked.
fn hash_settlement_proofs(
    outcome_proof: &TxlineStatValidationProof,
    finality_proof: &TxlineStatValidationProof,
) -> Result<[u8; 32]> {
    let mut outcome_bytes = Vec::new();
    outcome_proof
        .serialize(&mut outcome_bytes)
        .map_err(|_| error!(FinalWhistleError::InvalidTxlineProof))?;
    let mut finality_bytes = Vec::new();
    finality_proof
        .serialize(&mut finality_bytes)
        .map_err(|_| error!(FinalWhistleError::InvalidTxlineProof))?;
    Ok(hashv(&[
        b"final_whistle:settlement:v1",
        outcome_bytes.as_slice(),
        finality_bytes.as_slice(),
    ])
    .to_bytes())
}

fn hash_cancellation_proof(proof: &TxlineStatValidationProof) -> Result<[u8; 32]> {
    let mut proof_bytes = Vec::new();
    proof
        .serialize(&mut proof_bytes)
        .map_err(|_| error!(FinalWhistleError::InvalidTxlineProof))?;
    Ok(hashv(&[b"final_whistle:cancellation:v1", proof_bytes.as_slice()]).to_bytes())
}

fn require_allowed_txline_program(program_id: Pubkey) -> Result<()> {
    let devnet = Pubkey::from_str(TXLINE_DEVNET_PROGRAM_ID).map_err(|_| FinalWhistleError::InvalidTxlineProgram)?;
    require!(program_id == devnet, FinalWhistleError::InvalidTxlineProgram);
    Ok(())
}

fn require_allowed_stake_mint(mint: Pubkey) -> Result<()> {
    for allowed in [
        DEVNET_USDC_MINT,
        TXLINE_DEVNET_USDT_MINT,
    ] {
        let allowed = Pubkey::from_str(allowed).map_err(|_| FinalWhistleError::InvalidStakeMint)?;
        if mint == allowed {
            return Ok(());
        }
    }
    err!(FinalWhistleError::InvalidStakeMint)
}

fn validate_txline_stat<'info>(
    txline_program: AccountInfo<'info>,
    daily_scores_merkle_roots: AccountInfo<'info>,
    proof: &TxlineStatValidationProof,
) -> Result<()> {
    let epoch_day_i64 = proof
        .fixture_summary
        .update_stats
        .min_timestamp
        .checked_div(86_400_000)
        .ok_or(FinalWhistleError::MathOverflow)?;
    require!(
        epoch_day_i64 >= 0 && epoch_day_i64 <= i64::from(u16::MAX),
        FinalWhistleError::InvalidTxlineProof
    );
    let epoch_day = epoch_day_i64 as u16;
    let (expected_daily_scores, _) = Pubkey::find_program_address(
        &[b"daily_scores_roots", &epoch_day.to_le_bytes()],
        txline_program.key,
    );
    require!(
        daily_scores_merkle_roots.key() == expected_daily_scores,
        FinalWhistleError::InvalidDailyScoresPda
    );

    let mut data = TXLINE_VALIDATE_STAT_DISCRIMINATOR.to_vec();
    proof.serialize(&mut data)
        .map_err(|_| error!(FinalWhistleError::InvalidTxlineProof))?;

    let ix = Instruction {
        program_id: txline_program.key(),
        accounts: vec![AccountMeta::new_readonly(daily_scores_merkle_roots.key(), false)],
        data,
    };
    invoke(&ix, &[daily_scores_merkle_roots, txline_program.clone()])?;

    let (return_program, return_data) = get_return_data().ok_or(FinalWhistleError::MissingTxlineReturnData)?;
    require!(return_program == txline_program.key(), FinalWhistleError::InvalidTxlineReturnData);
    require!(
        return_data.first().copied() == Some(1),
        FinalWhistleError::TxlineValidationFailed
    );

    Ok(())
}

#[error_code]
pub enum FinalWhistleError {
    #[msg("Fixture id is too long")]
    FixtureIdTooLong,
    #[msg("Fixture id must be a canonical non-negative TxLINE numeric id")]
    InvalidFixtureId,
    #[msg("Lock time must be in the future")]
    InvalidLockTime,
    #[msg("Predicate is not valid for the selected market template")]
    InvalidPredicate,
    #[msg("Stake amount must be greater than zero")]
    InvalidStakeAmount,
    #[msg("Invalid stake token mint")]
    InvalidStakeMint,
    #[msg("Market is not open")]
    MarketNotOpen,
    #[msg("Market is locked")]
    MarketLocked,
    #[msg("Market has not expired")]
    MarketNotExpired,
    #[msg("Position already exists")]
    PositionAlreadyExists,
    #[msg("This side is already funded")]
    SideAlreadyFunded,
    #[msg("Direct challenge stakes must match")]
    StakeMustMatch,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Market stakes are not balanced")]
    UnbalancedMarket,
    #[msg("Market is not locked")]
    MarketNotLocked,
    #[msg("Fixture mismatch")]
    FixtureMismatch,
    #[msg("Match is not final")]
    MatchNotFinal,
    #[msg("Stat key mismatch")]
    StatKeyMismatch,
    #[msg("Invalid TxLINE sequence")]
    InvalidSequence,
    #[msg("Missing second stat value")]
    MissingSecondStat,
    #[msg("Invalid phase")]
    InvalidPhase,
    #[msg("Invalid TxLINE program")]
    InvalidTxlineProgram,
    #[msg("Invalid TxLINE daily scores PDA")]
    InvalidDailyScoresPda,
    #[msg("Invalid TxLINE proof")]
    InvalidTxlineProof,
    #[msg("Missing TxLINE return data")]
    MissingTxlineReturnData,
    #[msg("Invalid TxLINE return data")]
    InvalidTxlineReturnData,
    #[msg("TxLINE validation failed")]
    TxlineValidationFailed,
    #[msg("Invalid market status")]
    InvalidMarketStatus,
    #[msg("Invalid cancellation phase")]
    InvalidCancellationPhase,
    #[msg("Position has already claimed")]
    AlreadyClaimed,
    #[msg("Position does not belong to market")]
    PositionMarketMismatch,
    #[msg("Position does not belong to user")]
    PositionUserMismatch,
    #[msg("Position is not on the winning side")]
    NotWinningPosition,
    #[msg("Market is not claimable")]
    MarketNotClaimable,
    #[msg("The supplied program configuration account is invalid")]
    InvalidProgramConfig,
    #[msg("Only the FinalWhistle upgrade authority may initialize configuration")]
    UnauthorizedConfigAuthority,
    #[msg("The configured TxLINE finality stat key is invalid")]
    InvalidFinalityStatKey,
    #[msg("The TxLINE finality stat key does not match program configuration")]
    FinalityStatKeyMismatch,
    #[msg("TxLINE outcome and finality proofs must use the same fixture snapshot")]
    TxlineProofSnapshotMismatch,
    #[msg("Market is past its settlement or proof-cancellation window")]
    MarketActionWindowExpired,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn market_templates_do_not_allow_predicate_direction_flips() {
        let winner = Predicate {
            stat_key_1: 1,
            stat_key_2: Some(2),
            operator: StatOperator::Subtract,
            threshold_milli: 0,
            comparison: Comparison::GreaterThan,
        };
        assert!(winner.is_valid_for_template(MarketTemplate::MatchWinner));

        let inverse_winner = Predicate {
            comparison: Comparison::LessThan,
            ..winner.clone()
        };
        assert!(!inverse_winner.is_valid_for_template(MarketTemplate::MatchWinner));

        let total_goals = Predicate {
            stat_key_1: 1,
            stat_key_2: Some(2),
            operator: StatOperator::Add,
            threshold_milli: 2500,
            comparison: Comparison::GreaterThan,
        };
        assert!(total_goals.is_valid_for_template(MarketTemplate::TotalGoalsOverUnder));
        let inverse_total = Predicate {
            comparison: Comparison::LessThan,
            ..total_goals.clone()
        };
        assert!(!inverse_total.is_valid_for_template(MarketTemplate::TotalGoalsOverUnder));

        for invalid_line in [0, 499, 1000, 9000] {
            assert!(!Predicate {
                threshold_milli: invalid_line,
                ..total_goals.clone()
            }
            .is_valid_for_template(MarketTemplate::TotalGoalsOverUnder));
        }
    }

    #[test]
    fn only_devnet_beta_stake_mints_are_accepted() {
        assert!(require_allowed_stake_mint(Pubkey::from_str(DEVNET_USDC_MINT).unwrap()).is_ok());
        assert!(require_allowed_stake_mint(Pubkey::from_str(TXLINE_DEVNET_USDT_MINT).unwrap()).is_ok());
        assert!(require_allowed_stake_mint(
            Pubkey::from_str("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v").unwrap()
        )
        .is_err());
    }

    #[test]
    fn fixture_ids_must_have_a_canonical_decimal_encoding() {
        for fixture_id in ["0", "1", "17952170", "9223372036854775807"] {
            assert!(require_canonical_fixture_id(fixture_id).is_ok(), "{fixture_id}");
        }

        for fixture_id in ["", "001", "+1", "-0", "-1", "1.0", "9223372036854775808"] {
            assert!(require_canonical_fixture_id(fixture_id).is_err(), "{fixture_id}");
        }
    }

    #[test]
    fn settlement_proofs_must_share_the_fixture_snapshot() {
        let mut outcome = TxlineStatValidationProof {
            ts: 1,
            fixture_summary: TxlineScoresBatchSummary {
                fixture_id: 17_952_170,
                update_stats: TxlineScoresUpdateStats {
                    update_count: 3,
                    min_timestamp: 1_700_000_000_000,
                    max_timestamp: 1_700_000_050_000,
                },
                events_sub_tree_root: [7; 32],
            },
            fixture_proof: vec![],
            main_tree_proof: vec![],
            predicate: TxlineTraderPredicate {
                threshold: 0,
                comparison: TxlineComparison::GreaterThan,
            },
            stat_a: TxlineStatTerm {
                stat_to_prove: TxlineScoreStat {
                    key: 1,
                    value: 2,
                    period: 0,
                },
                event_stat_root: [0; 32],
                stat_proof: vec![],
            },
            stat_b: None,
            op: None,
        };
        let mut finality = outcome.clone();

        assert!(require_matching_txline_snapshot(&outcome, &finality).is_ok());

        finality.fixture_summary.update_stats.update_count += 1;
        assert!(require_matching_txline_snapshot(&outcome, &finality).is_err());

        finality = outcome.clone();
        finality.fixture_summary.events_sub_tree_root = [8; 32];
        assert!(require_matching_txline_snapshot(&outcome, &finality).is_err());

        outcome.fixture_summary.fixture_id += 1;
        assert!(require_matching_txline_snapshot(&outcome, &finality).is_err());
    }

    #[test]
    fn proof_actions_stop_when_the_expiry_refund_window_opens() {
        assert!(require_market_action_window(MarketStatus::Open, 99, 100, 200).is_ok());
        assert!(require_market_action_window(MarketStatus::Open, 100, 100, 200).is_err());

        assert!(require_market_action_window(MarketStatus::Locked, 199, 100, 200).is_ok());
        assert!(require_market_action_window(MarketStatus::Locked, 200, 100, 200).is_err());

        assert!(require_market_action_window(MarketStatus::Settled, 0, 100, 200).is_err());
    }
}
