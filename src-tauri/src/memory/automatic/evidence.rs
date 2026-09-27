use super::*;
use serde_json::Value;

/// Only completed, host-owned runs and completed native file tools provide evidence.
/// Do not trust assistant prose, shell output or the contents of modified files.
pub(super) fn verified_results(
    record: &crate::agent::RunRecord,
    r: &Registration,
    messages: &[Value],
) -> String {
    if record.run_id != r.message_id
        || record.session_id.as_deref() != Some(&r.session_id)
        || record.workspace_path != std::path::Path::new(&r.directory)
        || record.outcome != Some(crate::agent::RunOutcome::Completed)
    {
        return String::new();
    }
    let mut paths = std::collections::BTreeSet::new();
    for message in messages
        .iter()
        .filter(|m| m["info"]["parentID"] == r.message_id)
    {
        for part in message["parts"].as_array().into_iter().flatten() {
            if part["type"] != "tool"
                || part["state"]["status"] != "completed"
                || !matches!(part["tool"].as_str(), Some("write" | "edit"))
            {
                continue;
            }
            let Some(path) = part["state"]["input"]["filePath"].as_str() else {
                continue;
            };
            let path = std::path::Path::new(path);
            let absolute = if path.is_absolute() {
                path.to_owned()
            } else {
                record.workspace_path.join(path)
            };
            let Ok(relative) = absolute.strip_prefix(&record.workspace_path) else {
                continue;
            };
            if relative
                .components()
                .any(|c| !matches!(c, std::path::Component::Normal(_)))
            {
                continue;
            }
            let path = relative.to_string_lossy();
            if path.chars().count() <= 200 && !path.contains(['\n', '\r']) && ordinary(&path) {
                paths.insert(path.to_string());
            }
        }
    }
    paths
        .into_iter()
        .take(20)
        .map(|path| format!("已通过文件工具写入项目文件：{path}；未据此确认整项任务完成。"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Never split a sentence into independently meaningful evidence at the budget boundary.
pub(super) fn chunks(text: &str) -> Result<Vec<String>, String> {
    let mut chunks = Vec::new();
    let mut chunk = String::new();
    let mut size = 0;
    for sentence in text.split_inclusive(['\n', '。', '！', '？']) {
        let count = sentence.chars().count();
        if count > 12_000 {
            return Err("SOURCE_SEGMENT_TOO_LARGE".into());
        }
        if size + count > 12_000 {
            chunks.push(std::mem::take(&mut chunk));
            size = 0;
        }
        chunk.push_str(sentence);
        size += count;
    }
    if !chunk.is_empty() {
        chunks.push(chunk);
    }
    Ok(chunks)
}
