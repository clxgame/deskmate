use super::{
    contract::*,
    error::{WorklogError, WorklogResult},
    storage::WorklogStore,
};
use chrono::NaiveDate;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};

pub struct Repository {
    pub store: WorklogStore,
}
impl Repository {
    pub const fn new(store: WorklogStore) -> Self {
        Self { store }
    }
    pub fn operation(&self, request_id: &str) -> WorklogResult<Option<OperationReceipt>> {
        self.store.with_connection(|db| operation(db, request_id))
    }
}
pub(crate) fn operation(db: &Connection, id: &str) -> WorklogResult<Option<OperationReceipt>> {
    Ok(db.query_row("SELECT request_id,entity_kind,entity_id,revision,business_date,status FROM worklog_operations WHERE request_id=?1", [id], |r| Ok(OperationReceipt {
        operation_id:r.get(0)?,entity_kind:r.get(1)?,entity_id:r.get(2)?,revision:r.get(3)?,business_date:r.get(4)?,status:r.get(5)?
    })).optional()?)
}
pub(crate) fn replay<T: Serialize>(
    db: &Connection,
    id: &str,
    request: &T,
) -> WorklogResult<Option<OperationReceipt>> {
    uuid::Uuid::parse_str(id).map_err(|_| WorklogError::validation("requestId must be UUID"))?;
    let hash: Option<String> = db
        .query_row(
            "SELECT request_hash FROM worklog_operations WHERE request_id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(hash) = hash {
        if hash != request_hash(request)? {
            return Err(WorklogError::new(
                "IDEMPOTENCY_CONFLICT",
                "Request identifier was used with different parameters",
            ));
        }
        return operation(db, id);
    }
    Ok(None)
}
pub(crate) fn receipt<T: Serialize>(
    db: &Connection,
    value: OperationReceipt,
    request: &T,
) -> WorklogResult<OperationReceipt> {
    db.execute("INSERT INTO worklog_operations(request_id,request_hash,entity_kind,entity_id,revision,business_date,status) VALUES (?1,?2,?3,?4,?5,?6,?7)",params![value.operation_id,request_hash(request)?,value.entity_kind,value.entity_id,value.revision,value.business_date,value.status])?;
    Ok(value)
}
fn request_hash<T: Serialize>(request: &T) -> WorklogResult<String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(request)?)
    ))
}
pub(crate) fn date(value: &str) -> WorklogResult<NaiveDate> {
    let parsed = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| WorklogError::validation("Date must be ISO YYYY-MM-DD"))?;
    if parsed.to_string() != value {
        return Err(WorklogError::validation("Date must be ISO YYYY-MM-DD"));
    }
    Ok(parsed)
}
pub(crate) fn range(start: &str, end: &str) -> WorklogResult<()> {
    if date(start)? > date(end)? {
        return Err(WorklogError::validation("Period start must not follow end"));
    }
    Ok(())
}
pub(crate) fn text(value: &str) -> WorklogResult<()> {
    if value.trim().is_empty() || value.len() > 128 * 1024 {
        return Err(WorklogError::validation(
            "Text must contain 1 to 131072 bytes",
        ));
    }
    if crate::memory::policy::classify(value) == crate::memory::domain::Sensitivity::Secret {
        return Err(WorklogError::new(
            "SECRET_REJECTED",
            "Credential-like content cannot be stored",
        ));
    }
    Ok(())
}
pub(crate) fn project(value: &Option<String>) -> WorklogResult<Option<String>> {
    match value.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(value) if value.chars().count() > 120 => {
            Err(WorklogError::validation("Project is too long"))
        }
        Some(value) => {
            text(value)?;
            Ok(Some(value.to_owned()))
        }
        None => Ok(None),
    }
}
pub(crate) fn decode<T: serde::de::DeserializeOwned>(
    raw: String,
    column: usize,
) -> rusqlite::Result<T> {
    serde_json::from_str(&raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            column,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}
pub(crate) fn decode_enum<T: serde::de::DeserializeOwned>(
    raw: String,
    column: usize,
) -> rusqlite::Result<T> {
    decode(format!("\"{raw}\""), column)
}
#[cfg(test)]
#[path = "tests/repository_reports.rs"]
mod report_tests;
#[cfg(test)]
#[path = "tests/repository_sources.rs"]
mod source_tests;
#[cfg(test)]
#[path = "tests/repository.rs"]
mod tests;
