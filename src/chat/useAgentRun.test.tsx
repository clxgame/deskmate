import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import type { AgentProjection, AgentRun } from "../lib/agent";

const run: AgentRun = { runId: "msg_run", sessionId: "ses_run", workspacePath: "C:\\workspace", createdAt: "now", endedAt: null, outcome: null, errorSummary: null, messageIds: [], partIds: [], callIds: [] };
let projection: AgentProjection = { active: run, recent: [], artifacts: [] };
let pending: readonly object[] = [];
let readOverride: (() => Promise<AgentProjection>) | null = null;
let replyFailure: Error | null = null;
let startOverride: (() => Promise<AgentRun>) | null = null;
let cancelOverride: (() => Promise<void>) | null = null;
mock.module("@tauri-apps/api/core", () => ({ invoke: async (command: string) => {
  if (command === "agent_run_read") return readOverride ? readOverride() : projection;
  if (command === "agent_permission_pending") return pending;
  if (command === "agent_permission_reply" && replyFailure) throw replyFailure;
  if (command === "agent_run_cancel") {
    if (cancelOverride) return cancelOverride();
    projection = { active: null, recent: [{ ...run, outcome: "cancelled" }], artifacts: [] };
  }
  if (command === "agent_run_start") {
    if (startOverride) return startOverride();
    projection = { active: run, recent: [], artifacts: [] }; return run;
  }
  return undefined;
} }));
mock.module("@tauri-apps/plugin-dialog", () => ({ open: async () => "C:\\workspace" }));
const { useAgentRun } = await import("./useAgentRun");
const { ToolApprovalCards } = await import("./ToolApprovalCards");
const { WorkspaceTask } = await import("./WorkspaceTask");
const { dict } = await import("../lib/i18n");

afterEach(() => {
  cleanup();
  mock.restore();
  projection = { active: run, recent: [], artifacts: [] };
  pending = [];
  readOverride = null;
  replyFailure = null;
  startOverride = null;
  cancelOverride = null;
});

test("publishes a slow polling response when another polling tick occurs before it completes", async () => {
  // Given: a running task and controllable periodic polling.
  const timer = spyOn(globalThis, "setInterval");
  const { result } = renderHook(() => useAgentRun("en-US"));
  await act(async () => {});
  const tick = timer.mock.calls.find(([, delay]) => delay === 1000)?.[0];
  if (typeof tick !== "function") throw new Error("Agent polling timer missing");
  const responses: Array<(value: AgentProjection) => void> = [];
  readOverride = () => new Promise((resolve) => responses.push(resolve));
  // When: a second timer fires before the first host read returns.
  await act(async () => { tick?.(); tick?.(); });
  await act(async () => { responses[0]?.({ active: null, recent: [{ ...run, outcome: "failed" }], artifacts: [] }); });
  // Then: the completed response releases the UI and a new task can start.
  expect(result.current.busy).toBe(false);
  expect(responses).toHaveLength(1);
  readOverride = null;
  await act(async () => { await result.current.choose(); });
  await act(async () => { await result.current.start("new task"); });
  expect(result.current.projection.active?.runId).toBe(run.runId);
});

test("keeps an approval failure visible on the card after a successful status refresh", async () => {
  // Given: an actionable approval whose host reply fails.
  pending = [{ requestId: "per_run", permission: "bash", patterns: ["Get-Location"], always: [], metadata: {}, command: "Get-Location", cwd: "C:\\workspace" }];
  replyFailure = new Error("permission_reply_failed");
  const errorLog = spyOn(console, "error").mockImplementation(() => {});
  let refresh: (() => Promise<void>) | undefined;
  function Harness() {
    const agent = useAgentRun("en-US");
    refresh = agent.refresh;
    return <ToolApprovalCards requests={agent.requests} error={false} onReply={agent.reply} t={dict("en-US")} />;
  }
  render(<Harness />);
  await act(async () => {});
  // When: the user approves and the next healthy poll arrives.
  await act(async () => { screen.getByRole("button", { name: "Allow once" }).click(); });
  await act(async () => { await refresh?.(); });
  // Then: the card retains feedback and re-enables actions for recovery.
  expect(screen.getByRole("alert").textContent).toBe(dict("en-US").permissionFailed);
  expect(screen.getByRole("button", { name: "Allow once" }).hasAttribute("disabled")).toBe(false);
  expect(errorLog).toHaveBeenCalled();
});

test("cancel refresh supersedes an older poll and allows the next task", async () => {
  // Given: a running task with a delayed host read.
  const { result } = renderHook(() => useAgentRun("en-US"));
  await act(async () => {});
  let complete: ((value: AgentProjection) => void) | undefined;
  readOverride = () => new Promise((resolve) => { complete = resolve; });
  let oldRefresh: Promise<void> | undefined;
  await act(async () => { oldRefresh = result.current.refresh(); });
  // When: cancellation completes before the old read.
  readOverride = null;
  await act(async () => { await result.current.stop(); });
  await act(async () => { complete?.({ active: run, recent: [], artifacts: [] }); await oldRefresh; });
  // Then: stale data cannot resurrect the cancelled task.
  expect(result.current.busy).toBe(false);
  await act(async () => { await result.current.choose(); });
  await act(async () => { await result.current.start("next task"); });
  expect(result.current.projection.active?.runId).toBe(run.runId);
});

test("keeps cancellation visibly pending until the host confirms settlement", async () => {
  // Given: a running task whose host cancellation has not settled yet.
  let confirm: (() => void) | undefined;
  cancelOverride = () => new Promise<void>((resolve) => {
    confirm = () => {
      projection = { active: null, recent: [{ ...run, outcome: "cancelled" }], artifacts: [] };
      resolve();
    };
  });
  const { result } = renderHook(() => useAgentRun("en-US"));
  await act(async () => {});

  // When: the user requests cancellation before the host confirms it.
  let stopping: Promise<void> | undefined;
  await act(async () => {
    stopping = result.current.stop();
    await Promise.resolve();
  });

  // Then: the active task remains busy and exposes the in-progress stop state.
  expect(result.current.busy).toBe(true);
  expect(result.current.isStopping).toBe(true);
  confirm?.();
  await act(async () => { await stopping; });
  expect(result.current.busy).toBe(false);
  expect(result.current.isStopping).toBe(false);
});

test.each([
  ["agent_execution_lost", "en-US", "execution"],
  ["agent_tool_timeout", "en-US", "timed out"],
  ["permission_unavailable", "en-US", "approval"],
  ["agent_execution_lost", "zh-CN", "执行"],
  ["agent_tool_timeout", "zh-CN", "超时"],
  ["permission_unavailable", "zh-CN", "审批"],
])("keeps terminal %s visible in %s until a healthy new task starts", async (code, language, message) => {
  // Given: the latest task ended with a host failure reason.
  projection = { active: null, recent: [{ ...run, outcome: "failed", errorSummary: code }], artifacts: [] };
  const { result } = renderHook(() => useAgentRun(language));
  await act(async () => {});
  const task = render(<WorkspaceTask language={language} agent={result.current} />);
  expect(screen.getByRole("alert").textContent).toContain(message);
  expect(screen.getByRole("alert").textContent).toContain(code);
  // When: repeated refresh and workspace selection precede a new healthy task.
  await act(async () => { await result.current.refresh(); await result.current.choose(); });
  task.rerender(<WorkspaceTask language={language} agent={result.current} />);
  expect(screen.getByRole("alert").textContent).toContain(code);
  await act(async () => { await result.current.start("try again"); });
  task.rerender(<WorkspaceTask language={language} agent={result.current} />);
  // Then: the healthy task clears the old error without hiding its own active state.
  expect(screen.queryByRole("alert")).toBeNull();
  expect(result.current.busy).toBe(true);
});

test.each(["agent_execution_lost", "agent_tool_timeout", "permission_unavailable"])("shows active host error %s", async (code) => {
  projection = { active: { ...run, errorSummary: code }, recent: [], artifacts: [] };
  const { result } = renderHook(() => useAgentRun("en-US"));
  await act(async () => {});
  render(<WorkspaceTask language="en-US" agent={result.current} />);
  expect(screen.getByRole("alert").textContent).toContain(code);
});

test("restores the active host run and polling when start fails before settlement", async () => {
  projection = { active: null, recent: [], artifacts: [] };
  const timer = spyOn(globalThis, "setInterval");
  const { result } = renderHook(() => useAgentRun("en-US"));
  await act(async () => { await result.current.choose(); });
  startOverride = async () => {
    projection = { active: { ...run, errorSummary: "agent_transport_failure" }, recent: [], artifacts: [] };
    throw new Error("agent_transport_failure");
  };
  await act(async () => { await result.current.start("first task"); });
  expect(result.current.busy).toBe(true);
  expect(result.current.projection.active?.runId).toBe(run.runId);
  expect(result.current.error).toBe(dict("en-US").agentStartFailed);
  const tick = timer.mock.calls.find(([, delay]) => delay === 1000)?.[0];
  if (typeof tick !== "function") throw new Error("Agent polling timer missing");
  projection = { active: null, recent: [{ ...run, outcome: "failed", errorSummary: "agent_transport_failure" }], artifacts: [] };
  await act(async () => { await tick(); });
  expect(result.current.busy).toBe(false);
  startOverride = null;
  await act(async () => { await result.current.start("next task"); });
  expect(result.current.projection.active?.runId).toBe(run.runId);
});

test("refreshes a settled start failure and permits retry while preserving precise error copy", async () => {
  projection = { active: null, recent: [], artifacts: [] };
  const { result } = renderHook(() => useAgentRun("en-US"));
  await act(async () => { await result.current.choose(); });
  startOverride = async () => {
    projection = { active: null, recent: [{ ...run, outcome: "failed", errorSummary: "agent_history_workspace_missing" }], artifacts: [] };
    throw new Error("agent_history_workspace_missing");
  };
  await act(async () => { await result.current.start("first task"); });
  expect(result.current.projection.recent[0]?.runId).toBe(run.runId);
  expect(result.current.error).toBe(dict("en-US").agentHistoryWorkspaceMissing);
  expect(result.current.busy).toBe(false);
  startOverride = null;
  await act(async () => { await result.current.start("next task"); });
  expect(result.current.projection.active?.runId).toBe(run.runId);
});

test("recovers an idle Agent status after a transient startup read failure", async () => {
  projection = { active: null, recent: [], artifacts: [] };
  readOverride = async () => { throw new Error("sidecar startup timeout"); };
  const timer = spyOn(globalThis, "setInterval");
  const clearTimer = spyOn(globalThis, "clearInterval");
  const { result } = renderHook(() => useAgentRun("en-US"));
  await act(async () => {});
  expect(result.current.error).toBe(dict("en-US").agentReadFailed);
  const retry = timer.mock.calls.find(([, delay]) => delay === 5000)?.[0];
  expect(typeof retry).toBe("function");
  if (typeof retry !== "function") return;
  const replies: Array<(value: AgentProjection) => void> = [];
  readOverride = () => new Promise(resolve => replies.push(resolve));
  await act(async () => { void retry(); void retry(); });
  expect(replies).toHaveLength(1);
  await act(async () => { replies[0]?.(projection); });
  expect(result.current.error).toBeNull();
  expect(result.current.busy).toBe(false);
  expect(clearTimer).toHaveBeenCalled();
});

test("stops idle Agent status retries when the view unmounts", async () => {
  readOverride = async () => { throw new Error("sidecar unavailable"); };
  const timer = spyOn(globalThis, "setInterval");
  const clearTimer = spyOn(globalThis, "clearInterval");
  const { unmount } = renderHook(() => useAgentRun("en-US"));
  await act(async () => {});
  const retryIndex = timer.mock.calls.findIndex(([, delay]) => delay === 5000);
  expect(retryIndex).toBeGreaterThanOrEqual(0);
  const retryTimer = timer.mock.results[retryIndex]?.value;
  unmount();
  expect(clearTimer).toHaveBeenCalledWith(retryTimer);
});
