use crate::{tool_permissions::runtime::PermissionRequest, worklog::bridge::safe_id};

pub(super) fn validate_request(run_id: &str, request: &PermissionRequest) -> Result<(), String> {
    if !safe_id(run_id) || !safe_id(&request.id) || !safe_id(&request.session_id) {
        Err("agent_invalid_id".into())
    } else {
        Ok(())
    }
}

pub(super) fn matches_current_tool(
    request: &PermissionRequest,
    message_ids: &[String],
    call_ids: &[String],
) -> bool {
    request.tool.as_ref().is_some_and(|tool| {
        safe_id(&tool.message_id)
            && safe_id(&tool.call_id)
            && message_ids.contains(&tool.message_id)
            && call_ids.contains(&tool.call_id)
    })
}
