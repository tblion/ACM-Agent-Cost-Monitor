use serde::Serialize;
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, Copy)]
pub enum ErrorCategory {
    Database,
    Configuration,
    Settings,
    Pricing,
    Watcher,
    Export,
    InvalidInput,
}

impl ErrorCategory {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Database => "database",
            Self::Configuration => "configuration",
            Self::Settings => "settings",
            Self::Pricing => "pricing",
            Self::Watcher => "watcher",
            Self::Export => "export",
            Self::InvalidInput => "invalid_input",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
}

impl AppError {
    pub fn new(category: ErrorCategory, message: impl Into<String>) -> Self {
        Self {
            code: category.code().to_string(),
            message: sanitize_message(message.into()),
        }
    }

    pub fn with_context(self, context: impl AsRef<str>) -> Self {
        Self {
            message: sanitize_message(format!("{}: {}", context.as_ref(), self.message)),
            ..self
        }
    }

    pub fn code(&self) -> &str {
        &self.code
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

fn sanitize_message(message: String) -> String {
    let chars: Vec<char> = message.chars().collect();
    let mut sanitized = String::with_capacity(message.len());
    let mut index = 0;
    while index < chars.len() {
        let unix_path = chars[index] == '/'
            && (index == 0
                || chars[index - 1].is_whitespace()
                || matches!(chars[index - 1], ':' | '=' | '(' | '[' | '"' | '\''));
        let windows_path = index + 2 < chars.len()
            && chars[index].is_ascii_alphabetic()
            && chars[index + 1] == ':'
            && chars[index + 2] == '\\';
        let unc_path = chars[index] == '\\'
            && index + 1 < chars.len()
            && chars[index + 1] == '\\'
            && (index == 0
                || chars[index - 1].is_whitespace()
                || matches!(chars[index - 1], '=' | '(' | '[' | '"' | '\''));
        if unix_path || windows_path || unc_path {
            sanitized.push_str("[path]");
            index += 1;
            while index < chars.len() && !chars[index].is_whitespace() && chars[index] != ';' {
                index += 1;
            }
        } else {
            sanitized.push(chars[index]);
            index += 1;
        }
    }
    sanitized
}

impl Display for AppError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl std::ops::Deref for AppError {
    type Target = str;

    fn deref(&self) -> &Self::Target {
        &self.message
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_is_prepended_without_changing_the_code() {
        let error = AppError::new(ErrorCategory::Settings, "invalid value")
            .with_context("settings validation failed");

        assert_eq!(error.code(), "settings");
        assert_eq!(error.message(), "settings validation failed: invalid value");
    }

    #[test]
    fn sanitizes_unix_and_unc_paths_in_common_message_contexts() {
        let error = AppError::new(
            ErrorCategory::Configuration,
            r#"file=(/tmp/private/settings.json) path="/Users/alice/settings.json" unc='\\server\share\settings.json'"#,
        );

        assert!(!error.message().contains("/tmp/private"));
        assert!(!error.message().contains("/Users/alice"));
        assert!(!error.message().contains("\\\\server\\share"));
        assert!(error.message().contains("[path]"));
    }
}
