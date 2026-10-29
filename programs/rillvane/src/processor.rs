use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};
use spl_token::state::Account as TokenAccount;

use crate::error::RillvaneError;
use crate::instruction::Instruction;
use crate::math::{
    accrue_index, debt_from_shares, deposit_shares, liquidation, ltv_bps, max_borrow, min_cash,
    nav_quote, redeem_assets, shares_from_debt, swap_out,     INDEX_SCALE, LIQ_BPS, MAX_LTV_BPS, START_PRICE,
};
use crate::state::{
    Config, Market, Oracle, User, CONFIG_SEED, CONFIG_SPACE, MARKET_SEED, MARKET_SPACE, ORACLE_SEED,
    ORACLE_SPACE, USER_SEED, USER_SPACE,
};

const STALE_SECS: i64 = 30;

fn load<T: BorshDeserialize>(acc: &AccountInfo) -> Result<T, ProgramError> {
    let data = acc.data.borrow();
    let mut slice: &[u8] = &data;
    T::deserialize(&mut slice).map_err(|_| ProgramError::InvalidAccountData)
}

fn save<T: BorshSerialize>(acc: &AccountInfo, value: &T) -> Result<(), ProgramError> {
    let mut data = acc.data.borrow_mut();
    let mut buf: &mut [u8] = &mut data;
    value.serialize(&mut buf).map_err(|_| ProgramError::InvalidAccountData)
}

fn assert_signer(acc: &AccountInfo) -> ProgramResult {
    if !acc.is_signer {
        return Err(RillvaneError::Unauthorized.into());
    }
    Ok(())
}

fn assert_pda(acc: &AccountInfo, seeds: &[&[u8]], program_id: &Pubkey) -> Result<u8, ProgramError> {
    let (key, bump) = Pubkey::find_program_address(seeds, program_id);
    if key != *acc.key {
        return Err(ProgramError::InvalidSeeds);
    }
    Ok(bump)
}

fn create_pda<'a>(
    program_id: &Pubkey,
    payer: &AccountInfo<'a>,
    pda: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    seeds: &[&[u8]],
    bump: u8,
    space: usize,
) -> ProgramResult {
    if pda.lamports() > 0 {
        return Ok(());
    }
    let rent = Rent::get()?.minimum_balance(space);
    let bump_seed = [bump];
    let ix = system_instruction::create_account(payer.key, pda.key, rent, space as u64, program_id);
    let accounts = [payer.clone(), pda.clone(), system.clone()];
    match seeds.len() {
        1 => invoke_signed(&ix, &accounts, &[&[seeds[0], &bump_seed]]),
        2 => invoke_signed(&ix, &accounts, &[&[seeds[0], seeds[1], &bump_seed]]),
        _ => Err(ProgramError::InvalidArgument),
    }
}

fn transfer<'a>(
    token_program: &AccountInfo<'a>,
    from: &AccountInfo<'a>,
    to: &AccountInfo<'a>,
    authority: &AccountInfo<'a>,
    amount: u64,
    seeds: Option<&[&[u8]]>,
) -> ProgramResult {
    let ix = spl_token::instruction::transfer(
        token_program.key,
        from.key,
        to.key,
        authority.key,
        &[],
        amount,
    )?;
    let accounts = [from.clone(), to.clone(), authority.clone(), token_program.clone()];
    if let Some(seeds) = seeds {
        invoke_signed(&ix, &accounts, &[seeds])
    } else {
        invoke(&ix, &accounts)
    }
}

fn mint_to<'a>(
    token_program: &AccountInfo<'a>,
    mint: &AccountInfo<'a>,
    dest: &AccountInfo<'a>,
    authority: &AccountInfo<'a>,
    amount: u64,
    seeds: &[&[u8]],
) -> ProgramResult {
    let ix = spl_token::instruction::mint_to(token_program.key, mint.key, dest.key, authority.key, &[], amount)?;
    invoke_signed(
        &ix,
        &[mint.clone(), dest.clone(), authority.clone(), token_program.clone()],
        &[seeds],
    )
}

fn accrue(market: &mut Market, now: i64) {
    market.borrow_index = accrue_index(market.borrow_index, market.last_accrual, now);
    market.last_accrual = now;
    market.quote_debt = debt_from_shares(market.debt_shares, market.borrow_index);
}

fn oracle_fresh(oracle: &Oracle, now: i64, required: bool) -> ProgramResult {
    if oracle.price == 0 || (required && now.saturating_sub(oracle.publish_time) > STALE_SECS) {
        return Err(RillvaneError::StaleOracle.into());
    }
    Ok(())
}

fn assert_floor(market: &Market) -> ProgramResult {
    if market.quote_cash < min_cash(market.quote_cash, market.quote_debt) {
        return Err(RillvaneError::InsufficientLiquidity.into());
    }
    Ok(())
}

fn user_debt(user: &User, market: &Market) -> u128 {
    debt_from_shares(user.debt_shares, market.borrow_index)
}

fn as_u64(v: u128) -> Result<u64, ProgramError> {
    u64::try_from(v).map_err(|_| RillvaneError::InvalidAmount.into())
}

pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let ix = Instruction::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
    match ix {
        Instruction::Initialize => initialize(program_id, accounts),
        Instruction::OracleUpdate { price } => oracle_update(program_id, accounts, price),
        Instruction::FaucetMint { amount, base } => faucet_mint(program_id, accounts, amount, base != 0),
        Instruction::Supply { amount, base } => supply(program_id, accounts, amount, base != 0),
        Instruction::Withdraw { amount, base } => withdraw(program_id, accounts, amount, base != 0),
        Instruction::Swap { amount_in, buy_base, min_out, nonce, deadline } => {
            swap(program_id, accounts, amount_in, buy_base != 0, min_out, nonce, deadline)
        }
        Instruction::AddCollateral { amount } => add_collateral(program_id, accounts, amount),
        Instruction::RemoveCollateral { amount } => remove_collateral(program_id, accounts, amount),
        Instruction::Borrow { amount } => borrow(program_id, accounts, amount),
        Instruction::Repay { amount } => repay(program_id, accounts, amount),
        Instruction::Liquidate => liquidate(program_id, accounts),
        Instruction::Accrue => accrue_ix(program_id, accounts),
        Instruction::Pause { paused } => pause(program_id, accounts, paused),
    }
}

fn initialize(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let acc = &mut accounts.iter();
    let payer = next_account_info(acc)?;
    let config_ai = next_account_info(acc)?;
    let market_ai = next_account_info(acc)?;
    let oracle_ai = next_account_info(acc)?;
    let base_mint = next_account_info(acc)?;
    let quote_mint = next_account_info(acc)?;
    let base_vault = next_account_info(acc)?;
    let quote_vault = next_account_info(acc)?;
    let upgrade = next_account_info(acc)?;
    let oracle_auth = next_account_info(acc)?;
    let faucet_auth = next_account_info(acc)?;
    let keeper = next_account_info(acc)?;
    let system = next_account_info(acc)?;
    assert_signer(payer)?;
    let config_bump = assert_pda(config_ai, &[CONFIG_SEED], program_id)?;
    let market_bump = assert_pda(market_ai, &[MARKET_SEED], program_id)?;
    let oracle_bump = assert_pda(oracle_ai, &[ORACLE_SEED], program_id)?;
    if config_ai.data_len() > 0 && config_ai.lamports() > 0 {
        let existing: Result<Config, _> = load(config_ai);
        if existing.map(|c| c.version > 0).unwrap_or(false) {
            return Err(RillvaneError::AlreadyInitialized.into());
        }
    }
    create_pda(program_id, payer, config_ai, system, &[CONFIG_SEED], config_bump, CONFIG_SPACE)?;
    create_pda(program_id, payer, market_ai, system, &[MARKET_SEED], market_bump, MARKET_SPACE)?;
    create_pda(program_id, payer, oracle_ai, system, &[ORACLE_SEED], oracle_bump, ORACLE_SPACE)?;
    let now = Clock::get()?.unix_timestamp;
    let config = Config {
        version: 1,
        upgrade_authority: *upgrade.key,
        oracle_authority: *oracle_auth.key,
        faucet_authority: *faucet_auth.key,
        keeper: *keeper.key,
        paused: 0,
        epoch: 1,
    };
    let oracle = Oracle {
        market: *market_ai.key,
        updater: *oracle_auth.key,
        price: START_PRICE,
        exponent: -6,
        publish_time: now,
        slot: Clock::get()?.slot,
    };
    let base_token = TokenAccount::unpack(&base_vault.data.borrow())?;
    let quote_token = TokenAccount::unpack(&quote_vault.data.borrow())?;
    if base_token.mint != *base_mint.key || quote_token.mint != *quote_mint.key {
        return Err(ProgramError::InvalidAccountData);
    }
    if base_token.owner != *market_ai.key || quote_token.owner != *market_ai.key {
        return Err(ProgramError::InvalidAccountData);
    }
    let base_cash = base_token.amount as u128;
    let quote_cash = quote_token.amount as u128;
    let market = Market {
        base_mint: *base_mint.key,
        quote_mint: *quote_mint.key,
        base_vault: *base_vault.key,
        quote_vault: *quote_vault.key,
        oracle: *oracle_ai.key,
        base_cash,
        quote_cash,
        quote_debt: 0,
        base_shares: if base_cash == 0 { 0 } else { base_cash },
        quote_shares: if quote_cash == 0 { 0 } else { quote_cash },
        debt_shares: 0,
        borrow_index: INDEX_SCALE,
        last_accrual: now,
        paused: 0,
    };
    save(config_ai, &config)?;
    save(oracle_ai, &oracle)?;
    save(market_ai, &market)?;
    Ok(())
}

fn oracle_update(program_id: &Pubkey, accounts: &[AccountInfo], price: u128) -> ProgramResult {
    let acc = &mut accounts.iter();
    let updater = next_account_info(acc)?;
    let config_ai = next_account_info(acc)?;
    let oracle_ai = next_account_info(acc)?;
    assert_signer(updater)?;
    assert_pda(config_ai, &[CONFIG_SEED], program_id)?;
    assert_pda(oracle_ai, &[ORACLE_SEED], program_id)?;
    let config: Config = load(config_ai)?;
    if *updater.key != config.oracle_authority {
        return Err(RillvaneError::Unauthorized.into());
    }
    if price == 0 {
        return Err(RillvaneError::StaleOracle.into());
    }
    let mut oracle: Oracle = load(oracle_ai)?;
    let clock = Clock::get()?;
    if clock.unix_timestamp < oracle.publish_time {
        return Err(RillvaneError::StaleOracle.into());
    }
    oracle.price = price;
    oracle.publish_time = clock.unix_timestamp;
    oracle.slot = clock.slot;
    save(oracle_ai, &oracle)
}

fn load_market_bundle<'a>(
    program_id: &Pubkey,
    config_ai: &AccountInfo<'a>,
    market_ai: &AccountInfo<'a>,
    oracle_ai: &AccountInfo<'a>,
) -> Result<(Config, Market, Oracle, i64), ProgramError> {
    assert_pda(config_ai, &[CONFIG_SEED], program_id)?;
    assert_pda(market_ai, &[MARKET_SEED], program_id)?;
    assert_pda(oracle_ai, &[ORACLE_SEED], program_id)?;
    let config: Config = load(config_ai)?;
    let mut market: Market = load(market_ai)?;
    let oracle: Oracle = load(oracle_ai)?;
    if config.paused == 1 || market.paused == 1 {
        return Err(RillvaneError::Paused.into());
    }
    let now = Clock::get()?.unix_timestamp;
    accrue(&mut market, now);
    Ok((config, market, oracle, now))
}

fn load_or_init_user<'a>(
    program_id: &Pubkey,
    payer: &AccountInfo<'a>,
    user_ai: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    owner: &Pubkey,
    market: &Pubkey,
) -> Result<(User, u8), ProgramError> {
    let bump = assert_pda(user_ai, &[USER_SEED, owner.as_ref()], program_id)?;
    if user_ai.lamports() == 0 {
        create_pda(
            program_id,
            payer,
            user_ai,
            system,
            &[USER_SEED, owner.as_ref()],
            bump,
            USER_SPACE,
        )?;
        let user = User { owner: *owner, market: *market, ..User::default() };
        save(user_ai, &user)?;
        return Ok((user, bump));
    }
    Ok((load(user_ai)?, bump))
}

fn faucet_mint(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64, base: bool) -> ProgramResult {
    let acc = &mut accounts.iter();
    let faucet = next_account_info(acc)?;
    let config_ai = next_account_info(acc)?;
    let market_ai = next_account_info(acc)?;
    let mint = next_account_info(acc)?;
    let dest = next_account_info(acc)?;
    let token_program = next_account_info(acc)?;
    assert_signer(faucet)?;
    let config_bump = assert_pda(config_ai, &[CONFIG_SEED], program_id)?;
    assert_pda(market_ai, &[MARKET_SEED], program_id)?;
    let config: Config = load(config_ai)?;
    let market: Market = load(market_ai)?;
    if *faucet.key != config.faucet_authority {
        return Err(RillvaneError::Unauthorized.into());
    }
    if amount == 0 {
        return Err(RillvaneError::InvalidAmount.into());
    }
    let expected_mint = if base { market.base_mint } else { market.quote_mint };
    if *mint.key != expected_mint {
        return Err(ProgramError::InvalidAccountData);
    }
    let bump = [config_bump];
    mint_to(
        token_program,
        mint,
        dest,
        config_ai,
        amount,
        &[CONFIG_SEED, &bump],
    )
}

fn supply(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64, base: bool) -> ProgramResult {
    let acc = &mut accounts.iter();
    let owner = next_account_info(acc)?;
    let config_ai = next_account_info(acc)?;
    let market_ai = next_account_info(acc)?;
    let oracle_ai = next_account_info(acc)?;
    let user_ai = next_account_info(acc)?;
    let user_token = next_account_info(acc)?;
    let vault = next_account_info(acc)?;
    let token_program = next_account_info(acc)?;
    let system = next_account_info(acc)?;
    assert_signer(owner)?;
    let (_config, mut market, _oracle, _now) = load_market_bundle(program_id, config_ai, market_ai, oracle_ai)?;
    let (mut user, _) = load_or_init_user(program_id, owner, user_ai, system, owner.key, market_ai.key)?;
    if amount == 0 {
        return Err(RillvaneError::InvalidAmount.into());
    }
    let amount_u = amount as u128;
    if base {
        let nav = market.base_cash;
        let shares = deposit_shares(amount_u, market.base_shares, nav).map_err(RillvaneError::from)?;
        transfer(token_program, user_token, vault, owner, amount, None)?;
        user.base_shares += shares;
        market.base_cash += amount_u;
        market.base_shares += shares;
    } else {
        let nav = nav_quote(market.quote_cash, market.quote_debt);
        let shares = deposit_shares(amount_u, market.quote_shares, nav).map_err(RillvaneError::from)?;
        transfer(token_program, user_token, vault, owner, amount, None)?;
        user.quote_shares += shares;
        market.quote_cash += amount_u;
        market.quote_shares += shares;
    }
    save(user_ai, &user)?;
    save(market_ai, &market)
}

fn withdraw(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64, base: bool) -> ProgramResult {
    let acc = &mut accounts.iter();
    let owner = next_account_info(acc)?;
    let config_ai = next_account_info(acc)?;
    let market_ai = next_account_info(acc)?;
    let oracle_ai = next_account_info(acc)?;
    let user_ai = next_account_info(acc)?;
    let user_token = next_account_info(acc)?;
    let vault = next_account_info(acc)?;
    let token_program = next_account_info(acc)?;
    assert_signer(owner)?;
    let (_config, mut market, _oracle, _now) = load_market_bundle(program_id, config_ai, market_ai, oracle_ai)?;
    let mut user: User = load(user_ai)?;
    let market_bump = assert_pda(market_ai, &[MARKET_SEED], program_id)?;
    if user.owner != *owner.key {
        return Err(RillvaneError::Unauthorized.into());
    }
    let shares = amount as u128;
    let bump = [market_bump];
    let seeds: &[&[u8]] = &[MARKET_SEED, &bump];
    if base {
        let assets = redeem_assets(shares, market.base_shares, market.base_cash).map_err(RillvaneError::from)?;
        if shares > user.base_shares {
            return Err(RillvaneError::InsufficientFunds.into());
        }
        transfer(token_program, vault, user_token, market_ai, as_u64(assets)?, Some(seeds))?;
        user.base_shares -= shares;
        market.base_shares -= shares;
        market.base_cash -= assets;
    } else {
        let nav = nav_quote(market.quote_cash, market.quote_debt);
        let assets = redeem_assets(shares, market.quote_shares, nav).map_err(RillvaneError::from)?;
        if shares > user.quote_shares {
            return Err(RillvaneError::InsufficientFunds.into());
        }
        transfer(token_program, vault, user_token, market_ai, as_u64(assets)?, Some(seeds))?;
        user.quote_shares -= shares;
        market.quote_shares -= shares;
        market.quote_cash -= assets;
        assert_floor(&market)?;
    }
    save(user_ai, &user)?;
    save(market_ai, &market)
}

fn swap(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount_in: u64,
    buy_base: bool,
    min_out: u64,
    nonce: u64,
    deadline: i64,
) -> ProgramResult {
    let acc = &mut accounts.iter();
    let owner = next_account_info(acc)?;
    let config_ai = next_account_info(acc)?;
    let market_ai = next_account_info(acc)?;
    let oracle_ai = next_account_info(acc)?;
    let user_ai = next_account_info(acc)?;
    let user_base = next_account_info(acc)?;
    let user_quote = next_account_info(acc)?;
    let base_vault = next_account_info(acc)?;
    let quote_vault = next_account_info(acc)?;
    let token_program = next_account_info(acc)?;
    let system = next_account_info(acc)?;
    assert_signer(owner)?;
    let (_config, mut market, oracle, now) = load_market_bundle(program_id, config_ai, market_ai, oracle_ai)?;
    oracle_fresh(&oracle, now, true)?;
    if deadline != 0 && now > deadline {
        return Err(RillvaneError::Deadline.into());
    }
    let (mut user, _) = load_or_init_user(program_id, owner, user_ai, system, owner.key, market_ai.key)?;
    if nonce != user.nonce {
        return Err(RillvaneError::Nonce.into());
    }
    let result = swap_out(
        buy_base,
        amount_in as u128,
        oracle.price,
        market.base_cash,
        market.quote_cash,
    )
    .map_err(RillvaneError::from)?;
    if result.out < min_out as u128 {
        return Err(RillvaneError::Slippage.into());
    }
    let market_bump = assert_pda(market_ai, &[MARKET_SEED], program_id)?;
    let bump = [market_bump];
    let vault_seeds: &[&[u8]] = &[MARKET_SEED, &bump];
    if buy_base {
        transfer(token_program, user_quote, quote_vault, owner, amount_in, None)?;
        transfer(token_program, base_vault, user_base, market_ai, as_u64(result.out)?, Some(vault_seeds))?;
    } else {
        transfer(token_program, user_base, base_vault, owner, amount_in, None)?;
        transfer(token_program, quote_vault, user_quote, market_ai, as_u64(result.out)?, Some(vault_seeds))?;
    }
    market.base_cash = result.base_cash;
    market.quote_cash = result.quote_cash;
    assert_floor(&market)?;
    user.nonce += 1;
    save(user_ai, &user)?;
    save(market_ai, &market)
}

fn add_collateral(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult {
    let acc = &mut accounts.iter();
    let owner = next_account_info(acc)?;
    let config_ai = next_account_info(acc)?;
    let market_ai = next_account_info(acc)?;
    let oracle_ai = next_account_info(acc)?;
    let user_ai = next_account_info(acc)?;
    let user_base = next_account_info(acc)?;
    let base_vault = next_account_info(acc)?;
    let token_program = next_account_info(acc)?;
    let system = next_account_info(acc)?;
    assert_signer(owner)?;
    let (_config, market, _oracle, _now) = load_market_bundle(program_id, config_ai, market_ai, oracle_ai)?;
    let (mut user, _) = load_or_init_user(program_id, owner, user_ai, system, owner.key, market_ai.key)?;
    if amount == 0 {
        return Err(RillvaneError::InvalidAmount.into());
    }
    let _ = market;
    transfer(token_program, user_base, base_vault, owner, amount, None)?;
    user.collateral += amount as u128;
    save(user_ai, &user)
}

fn remove_collateral(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult {
    let acc = &mut accounts.iter();
    let owner = next_account_info(acc)?;
    let config_ai = next_account_info(acc)?;
    let market_ai = next_account_info(acc)?;
    let oracle_ai = next_account_info(acc)?;
    let user_ai = next_account_info(acc)?;
    let user_base = next_account_info(acc)?;
    let base_vault = next_account_info(acc)?;
    let token_program = next_account_info(acc)?;
    assert_signer(owner)?;
    let (_config, market, oracle, now) = load_market_bundle(program_id, config_ai, market_ai, oracle_ai)?;
    oracle_fresh(&oracle, now, true)?;
    let mut user: User = load(user_ai)?;
    if user.owner != *owner.key {
        return Err(RillvaneError::Unauthorized.into());
    }
    if amount as u128 > user.collateral {
        return Err(RillvaneError::InsufficientFunds.into());
    }
    user.collateral -= amount as u128;
    let debt = user_debt(&user, &market);
    if ltv_bps(debt, user.collateral, oracle.price) > MAX_LTV_BPS {
        return Err(RillvaneError::Health.into());
    }
    let market_bump = assert_pda(market_ai, &[MARKET_SEED], program_id)?;
    let bump = [market_bump];
    transfer(
        token_program,
        base_vault,
        user_base,
        market_ai,
        amount,
        Some(&[MARKET_SEED, &bump]),
    )?;
    save(user_ai, &user)
}

fn borrow(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult {
    let acc = &mut accounts.iter();
    let owner = next_account_info(acc)?;
    let config_ai = next_account_info(acc)?;
    let market_ai = next_account_info(acc)?;
    let oracle_ai = next_account_info(acc)?;
    let user_ai = next_account_info(acc)?;
    let user_quote = next_account_info(acc)?;
    let quote_vault = next_account_info(acc)?;
    let token_program = next_account_info(acc)?;
    assert_signer(owner)?;
    let (_config, mut market, oracle, now) = load_market_bundle(program_id, config_ai, market_ai, oracle_ai)?;
    oracle_fresh(&oracle, now, true)?;
    let mut user: User = load(user_ai)?;
    if user.owner != *owner.key {
        return Err(RillvaneError::Unauthorized.into());
    }
    if amount == 0 {
        return Err(RillvaneError::InvalidAmount.into());
    }
    let debt = user_debt(&user, &market);
    if amount as u128 > max_borrow(user.collateral, oracle.price, debt) {
        return Err(RillvaneError::Health.into());
    }
    let shares = shares_from_debt(amount as u128, market.borrow_index).map_err(RillvaneError::from)?;
    let market_bump = assert_pda(market_ai, &[MARKET_SEED], program_id)?;
    let bump = [market_bump];
    transfer(
        token_program,
        quote_vault,
        user_quote,
        market_ai,
        amount,
        Some(&[MARKET_SEED, &bump]),
    )?;
    user.debt_shares += shares;
    market.debt_shares += shares;
    market.quote_cash -= amount as u128;
    market.quote_debt = debt_from_shares(market.debt_shares, market.borrow_index);
    assert_floor(&market)?;
    save(user_ai, &user)?;
    save(market_ai, &market)
}

fn repay(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult {
    let acc = &mut accounts.iter();
    let owner = next_account_info(acc)?;
    let config_ai = next_account_info(acc)?;
    let market_ai = next_account_info(acc)?;
    let oracle_ai = next_account_info(acc)?;
    let user_ai = next_account_info(acc)?;
    let user_quote = next_account_info(acc)?;
    let quote_vault = next_account_info(acc)?;
    let token_program = next_account_info(acc)?;
    assert_signer(owner)?;
    let (_config, mut market, _oracle, _now) = load_market_bundle(program_id, config_ai, market_ai, oracle_ai)?;
    let mut user: User = load(user_ai)?;
    if user.owner != *owner.key {
        return Err(RillvaneError::Unauthorized.into());
    }
    let debt = user_debt(&user, &market);
    let repay = (amount as u128).min(debt);
    if repay == 0 {
        return Err(RillvaneError::InvalidAmount.into());
    }
    let shares = shares_from_debt(repay, market.borrow_index).map_err(RillvaneError::from)?;
    let burned = shares.min(user.debt_shares);
    transfer(token_program, user_quote, quote_vault, owner, as_u64(repay)?, None)?;
    user.debt_shares -= burned;
    market.debt_shares -= burned;
    market.quote_cash += repay;
    market.quote_debt = debt_from_shares(market.debt_shares, market.borrow_index);
    save(user_ai, &user)?;
    save(market_ai, &market)
}

fn liquidate(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let acc = &mut accounts.iter();
    let keeper = next_account_info(acc)?;
    let config_ai = next_account_info(acc)?;
    let market_ai = next_account_info(acc)?;
    let oracle_ai = next_account_info(acc)?;
    let user_ai = next_account_info(acc)?;
    assert_signer(keeper)?;
    let (config, mut market, oracle, now) = load_market_bundle(program_id, config_ai, market_ai, oracle_ai)?;
    if *keeper.key != config.keeper {
        return Err(RillvaneError::Unauthorized.into());
    }
    oracle_fresh(&oracle, now, true)?;
    let mut user: User = load(user_ai)?;
    let debt = user_debt(&user, &market);
    if ltv_bps(debt, user.collateral, oracle.price) < LIQ_BPS {
        return Err(RillvaneError::Health.into());
    }
    let (repay, seize) = liquidation(debt, user.collateral, oracle.price).map_err(RillvaneError::from)?;
    let shares = shares_from_debt(repay, market.borrow_index).map_err(RillvaneError::from)?;
    let burned = shares.min(user.debt_shares);
    user.debt_shares -= burned;
    user.collateral -= seize;
    market.debt_shares -= burned;
    market.quote_cash += repay;
    market.base_cash += seize;
    market.quote_debt = debt_from_shares(market.debt_shares, market.borrow_index);
    save(user_ai, &user)?;
    save(market_ai, &market)
}

fn accrue_ix(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let acc = &mut accounts.iter();
    let config_ai = next_account_info(acc)?;
    let market_ai = next_account_info(acc)?;
    let oracle_ai = next_account_info(acc)?;
    let (_config, market, _oracle, _now) = load_market_bundle(program_id, config_ai, market_ai, oracle_ai)?;
    save(market_ai, &market)
}

fn pause(program_id: &Pubkey, accounts: &[AccountInfo], paused: u8) -> ProgramResult {
    let acc = &mut accounts.iter();
    let upgrade = next_account_info(acc)?;
    let config_ai = next_account_info(acc)?;
    let market_ai = next_account_info(acc)?;
    assert_signer(upgrade)?;
    assert_pda(config_ai, &[CONFIG_SEED], program_id)?;
    assert_pda(market_ai, &[MARKET_SEED], program_id)?;
    let mut config: Config = load(config_ai)?;
    if *upgrade.key != config.upgrade_authority {
        return Err(RillvaneError::Unauthorized.into());
    }
    let mut market: Market = load(market_ai)?;
    config.paused = paused as u32;
    market.paused = paused as u32;
    save(config_ai, &config)?;
    save(market_ai, &market)
}
