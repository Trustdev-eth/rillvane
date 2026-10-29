use solana_program::program_error::ProgramError;

#[derive(Clone, Copy, Debug)]
pub enum RillvaneError {
    InvalidAmount = 1,
    InsufficientFunds = 2,
    InsufficientLiquidity = 3,
    Slippage = 4,
    StaleOracle = 5,
    Health = 6,
    Unauthorized = 7,
    Paused = 8,
    Nonce = 9,
    Deadline = 10,
    AlreadyInitialized = 11,
}

impl From<RillvaneError> for ProgramError {
    fn from(e: RillvaneError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

impl From<crate::math::MathError> for RillvaneError {
    fn from(e: crate::math::MathError) -> Self {
        match e {
            crate::math::MathError::InvalidAmount => Self::InvalidAmount,
            crate::math::MathError::InsufficientFunds => Self::InsufficientFunds,
            crate::math::MathError::InsufficientLiquidity => Self::InsufficientLiquidity,
            crate::math::MathError::Slippage => Self::Slippage,
            crate::math::MathError::StaleOracle => Self::StaleOracle,
            crate::math::MathError::Health => Self::Health,
        }
    }
}
