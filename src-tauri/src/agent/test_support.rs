use std::fmt::{Debug, Display, Formatter};

#[derive(Debug)]
pub(super) struct TestError(String);

impl Display for TestError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for TestError {}

impl From<String> for TestError {
    fn from(error: String) -> Self {
        Self(error)
    }
}

impl From<std::io::Error> for TestError {
    fn from(error: std::io::Error) -> Self {
        Self(error.to_string())
    }
}

pub(super) type TestResult<T = ()> = Result<T, TestError>;

pub(super) trait Checked<T> {
    fn checked(self, context: &str) -> TestResult<T>;
}

impl<T, E: Debug> Checked<T> for Result<T, E> {
    fn checked(self, context: &str) -> TestResult<T> {
        self.map_err(|error| TestError(format!("{context}: {error:?}")))
    }
}

impl<T> Checked<T> for Option<T> {
    fn checked(self, context: &str) -> TestResult<T> {
        self.ok_or_else(|| TestError(context.to_owned()))
    }
}
