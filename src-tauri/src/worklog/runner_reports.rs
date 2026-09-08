use super::{
    contract::SourceSnapshot,
    error::{WorklogError, WorklogResult},
    model_client::ModelClient,
    reports::{self, ReportOutput},
    repository::Repository,
    repository_runtime::ClaimedRun,
};
use std::collections::BTreeSet;

pub struct GenerationContext<'a> {
    pub client: &'a ModelClient,
    pub repository: &'a Repository,
    pub run: &'a ClaimedRun,
}
pub fn merge(
    context: &GenerationContext<'_>,
    mut output: ReportOutput,
    heartbeat: &mut impl FnMut() -> WorklogResult<()>,
) -> WorklogResult<ReportOutput> {
    let run = context.run;
    loop {
        let serialized = serde_json::to_string(&output)?;
        if serialized.chars().count() + 1024 <= reports::INPUT_LIMIT {
            return request(context, (&serialized, &run.sources), heartbeat);
        }
        let previous_size = serialized.chars().count();
        let mut groups = Vec::new();
        let mut current = Vec::new();
        let mut size = 0;
        for block in output.blocks {
            let length = serde_json::to_string(&block)?.chars().count();
            if length + 1024 > reports::INPUT_LIMIT {
                return Err(WorklogError::new(
                    "INVALID_MODEL_OUTPUT",
                    "A summary block exceeds the input limit",
                ));
            }
            if size + length > 12000 && !current.is_empty() {
                groups.push(ReportOutput {
                    blocks: std::mem::take(&mut current),
                });
                size = 0;
            }
            size += length;
            current.push(block);
        }
        if !current.is_empty() {
            groups.push(ReportOutput { blocks: current });
        }
        let mut merged = Vec::new();
        for group in groups {
            let keys: BTreeSet<_> = group
                .blocks
                .iter()
                .flat_map(|block| block.sources.iter().cloned())
                .collect();
            let sources: Vec<SourceSnapshot> = run
                .sources
                .iter()
                .filter(|source| keys.contains(&reports::source_key(source)))
                .cloned()
                .collect();
            let raw = serde_json::to_string(&group)?;
            merged.extend(request(context, (&raw, &sources), heartbeat)?.blocks);
        }
        output = ReportOutput { blocks: merged };
        if serde_json::to_string(&output)?.chars().count() >= previous_size {
            return Err(WorklogError::new(
                "INVALID_MODEL_OUTPUT",
                "Model summaries did not become shorter",
            ));
        }
    }
}
fn request(
    context: &GenerationContext<'_>,
    material: (&str, &[SourceSnapshot]),
    heartbeat: &mut impl FnMut() -> WorklogResult<()>,
) -> WorklogResult<ReportOutput> {
    let GenerationContext {
        client,
        repository,
        run,
    } = context;
    let (raw, sources) = material;
    let prompt=format!("Merge these validated summaries by project. Preserve every exact source key, remove repeated facts, and compress prose to at most half the input length. Return the required JSON report: {raw}");
    let prompt = reports::prompt(run, &prompt)?;
    let session = client.create_session()?;
    repository.set_run_session(run, &session)?;
    let result = client.generate((&session, &prompt), heartbeat);
    client.abort(&session);
    let output = reports::validate_output(&result?, sources)?;
    reports::validate_format(&output, &run.kind)?;
    Ok(output)
}
