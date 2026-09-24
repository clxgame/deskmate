use serde::{Deserialize, Serialize};
use super::catalog_model::*;

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogQuery {
    pub search: Option<String>, pub source: Option<ConversationSource>,
    pub directory: Option<String>, pub archived: Option<bool>, pub pinned: Option<bool>,
    pub from: Option<u64>, pub to: Option<u64>, pub offset: Option<usize>, pub limit: Option<usize>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogRow {
    pub key: String,
    #[serde(flatten)] pub entry: CatalogEntry,
    pub display_title: String, pub capabilities: HistoryCapabilities,
}
impl From<CatalogEntry> for CatalogRow {
    fn from(entry: CatalogEntry) -> Self {
        Self { key: entry.key(), display_title: entry.display_title().to_owned(), capabilities: entry.capabilities(), entry }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogPage {
    pub items: Vec<CatalogRow>, pub total: usize, pub has_more: bool,
    pub directories: Vec<String>, pub offline: bool, pub errors: Vec<String>,
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub(crate) enum CatalogMutation {
    Rename { title: String }, Pin { pinned: bool }, Archive { archived: bool }, Delete { confirmed: bool },
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogLoaded {
    pub entry: CatalogRow,
    pub messages: Vec<super::HistoryMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_details: Option<super::recovery::AgentHistoryDetails>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_run_id: Option<String>,
}

pub(crate) fn page(mut rows: Vec<CatalogEntry>, query: CatalogQuery, directories: Vec<String>, errors: Vec<String>) -> CatalogPage {
    let offline = rows.iter().any(|row| row.tombstone.is_none() && matches!(row.identity, CatalogIdentity::Native { .. }) && row.availability != Availability::Available);
    let search = query.search.unwrap_or_default().trim().to_lowercase();
    rows.retain(|row| {
        let directory = match &row.identity { CatalogIdentity::Native { directory, .. } => directory.as_str(), CatalogIdentity::Legacy { .. } => "" };
        row.tombstone.is_none() && row.archived == query.archived.unwrap_or(false)
            && query.pinned.is_none_or(|pinned| row.pinned == pinned)
            && query.source.is_none_or(|source| row.source == source)
            && query.directory.as_ref().is_none_or(|project| directory == project)
            && query.from.is_none_or(|from| row.updated >= from) && query.to.is_none_or(|to| row.updated <= to)
            && (search.is_empty() || row.display_title().to_lowercase().contains(&search) || directory.to_lowercase().contains(&search))
    });
    rows.sort_by(|a,b| b.pinned.cmp(&a.pinned).then(b.updated.cmp(&a.updated)).then(a.key().cmp(&b.key())));
    let total = rows.len(); let offset = query.offset.unwrap_or(0); let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let items: Vec<_> = rows.into_iter().skip(offset).take(limit).map(CatalogRow::from).collect();
    CatalogPage { has_more: offset.saturating_add(items.len()) < total, items, total, directories, offline, errors }
}

