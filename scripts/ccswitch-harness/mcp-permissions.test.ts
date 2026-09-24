import { expect, test } from "bun:test";
import {
  mcpToolPermissionId,
  TEST_MCP_APPROVED_TOOL_ID,
  TEST_MCP_UNAPPROVED_TOOL_ID,
} from "./mcp-permissions";

test("derives the approved MCP tool permission ID", () => {
  expect(mcpToolPermissionId("yume_qa_mcp", "yume_qa_echo")).toBe("yume_qa_mcp_yume_qa_echo");
});

test("preserves hyphens like upstream sanitize", () => {
  expect(mcpToolPermissionId("my-server", "my-tool")).toBe("my-server_my-tool");
});

test("derives the fixed approved and unapproved IDs", () => {
  expect(TEST_MCP_APPROVED_TOOL_ID).toBe("yume_qa_mcp_yume_qa_echo");
  expect(TEST_MCP_UNAPPROVED_TOOL_ID).toBe("yume_qa_mcp_yume_qa_echo_unapproved");
});

test("replaces punctuation in both ID segments one character at a time", () => {
  expect(mcpToolPermissionId("server.with spaces/slashes", "tool.with spaces/slashes")).toBe(
    "server_with_spaces_slashes_tool_with_spaces_slashes",
  );
});
