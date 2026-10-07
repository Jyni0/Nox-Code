use serde::{Serialize, Serializer};

/// Every command error reaches the frontend as a plain message string.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid search pattern: {0}")]
    Pattern(String),
    #[error("{0}")]
    Msg(String),
}

impl AppError {
    pub fn msg(m: impl Into<String>) -> Self {
        AppError::Msg(m.into())
    }
}

impl From<regex::Error> for AppError {
    fn from(e: regex::Error) -> Self {
        AppError::Pattern(e.to_string())
    }
}

impl From<ignore::Error> for AppError {
    fn from(e: ignore::Error) -> Self {
        AppError::Pattern(e.to_string())
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
