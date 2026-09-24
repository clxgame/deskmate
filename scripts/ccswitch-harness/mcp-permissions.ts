export function sanitizeMcpIdSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function mcpToolPermissionId(server: string, tool: string): string {
  return `${sanitizeMcpIdSegment(server)}_${sanitizeMcpIdSegment(tool)}`;
}

// Underscore form on purpose: sanitize() preserves hyphens, so a hyphenated
// config key would produce a different tool ID. This matches the ID already
// observed at runtime for the QA fixture.
export const TEST_MCP_SERVER_NAME = "yume_qa_mcp";
export const TEST_MCP_APPROVED_TOOL_NAME = "yume_qa_echo";
export const TEST_MCP_UNAPPROVED_TOOL_NAME = "yume_qa_echo_unapproved";
export const TEST_MCP_APPROVED_TOOL_ID = mcpToolPermissionId(TEST_MCP_SERVER_NAME, TEST_MCP_APPROVED_TOOL_NAME);
export const TEST_MCP_UNAPPROVED_TOOL_ID = mcpToolPermissionId(
  TEST_MCP_SERVER_NAME,
  TEST_MCP_UNAPPROVED_TOOL_NAME,
);
