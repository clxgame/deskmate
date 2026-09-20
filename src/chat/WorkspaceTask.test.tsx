import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const calls: Array<{ readonly command: string; readonly args: object | undefined }> = [];
type MockRun = { readonly runId: string; readonly sessionId: string | null; readonly workspacePath: string; readonly createdAt: string; readonly endedAt: string | null; readonly outcome: string | null; readonly errorSummary: string | null; readonly messageIds: readonly string[]; readonly partIds: readonly string[]; readonly callIds: readonly string[] };
const run: MockRun = { runId: "msg_run", sessionId: "ses_run", workspacePath: "C:\\workspace", createdAt: "now", endedAt: null, outcome: null, errorSummary: null, messageIds: [], partIds: [], callIds: [] };
let projection: { active: typeof run | null; recent: readonly typeof run[]; artifacts: readonly object[] } = { active: null, recent: [], artifacts: [] };
let selected: string | null = "C:\\workspace";
let failCommand: string | null = null;
let readOverride: (() => Promise<unknown>) | null = null;
let dialogTitle: string | null = null;
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: object) => {
    calls.push({ command, args });
    if (command === failCommand) throw new Error(`${command} failed`);
    if (command === "agent_run_read") return readOverride ? readOverride() : projection;
    if (command === "agent_run_start") { projection = { active: run, recent: [], artifacts: [] }; return run; }
    if (command === "agent_permission_pending") {
      if ((args as { runId?: string } | undefined)?.runId === "msg_preparing") return [];
      return [{ requestId: "req_one", permission: "bash", patterns: [], always: ["bun *"], metadata: {}, command: "bun test", cwd: "C:\workspace" }];
    }
    if (command === "agent_run_cancel") projection = { active: null, recent: [{ ...run, outcome: "cancelled" }], artifacts: [] };
    return undefined;
  },
}));
mock.module("@tauri-apps/plugin-dialog", () => ({ open: async (options: { readonly title?: string }) => { dialogTitle = options.title ?? null; return selected; } }));

const { WorkspaceTask } = await import("./WorkspaceTask");
const { useAgentRun } = await import("./useAgentRun");

function WorkspaceHarness({ language = "zh-CN", prompt }: { readonly language?: string; readonly prompt?: string }) {
  const agent = useAgentRun(language);
  return <>
    <WorkspaceTask language={language} agent={agent} />
    {prompt && <button type="button" data-testid="composer-submit" onClick={() => void agent.start(prompt)}>submit</button>}
  </>;
}

afterEach(() => { cleanup(); calls.length = 0; projection = { active: null, recent: [], artifacts: [] }; selected = "C:\\workspace"; failCommand = null; readOverride = null; dialogTitle = null; });

test("chooses a directory, starts once, and restores the host projection", async () => {
  const ui = render(<WorkspaceHarness prompt="整理项目" />);
  fireEvent.click(screen.getByRole("button", { name: "选择工作文件夹" }));
  await screen.findByText("C:\\workspace");
  expect(dialogTitle).toBe("选择工作文件夹");
  expect(screen.queryByRole("button", { name: "开始任务" })).toBeNull();
  fireEvent.click(screen.getByTestId("composer-submit"));
  await waitFor(() => expect(calls.filter((item) => item.command === "agent_run_start")).toHaveLength(1));
  await waitFor(() => expect(screen.getByRole("button", { name: "停" })).toBeDefined());
  await waitFor(() => expect(screen.getByRole("button", { name: "允许这一次" })).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "允许这一次" }));
  await waitFor(() => expect(calls.some((item) => item.command === "agent_permission_reply" && JSON.stringify(item.args) === JSON.stringify({ runId: "msg_run", requestId: "req_one", reply: "once" }))).toBe(true));
  expect(calls.some((item) => item.command === "tool_permission_reply")).toBe(false);
  ui.unmount();
  render(<WorkspaceHarness />);
  await screen.findByRole("button", { name: "停" });
  fireEvent.click(screen.getByRole("button", { name: "停" }));
  await waitFor(() => expect(calls.some((item) => item.command === "agent_run_cancel")).toBe(true));
  cleanup();
  render(<WorkspaceHarness />);
  await waitFor(() => expect(calls.some((item) => item.command === "agent_run_read")).toBe(true));
});

test("keeps recovered preparation visible with empty approvals and Stop cancels it", async () => {
  projection = { active: { ...run, runId: "msg_preparing", sessionId: null }, recent: [], artifacts: [] };
  render(<WorkspaceHarness />);
  const stop = await screen.findByRole("button", { name: "停" });
  expect(screen.queryByRole("button", { name: "允许这一次" })).toBeNull();
  fireEvent.click(stop);
  await waitFor(() => expect(calls.some((item) => item.command === "agent_run_cancel" && JSON.stringify(item.args) === JSON.stringify({ runId: "msg_preparing" }))).toBe(true));
});
test("always approval uses the host-owned workspace permission command", async () => {
  render(<WorkspaceHarness prompt="执行检查" />);
  fireEvent.click(screen.getByRole("button", { name: "选择工作文件夹" }));
  await screen.findByText("C:\\workspace");
  fireEvent.click(screen.getByTestId("composer-submit"));
  const always = await screen.findByRole("button", { name: "在此文件夹始终允许这类命令" });
  fireEvent.click(always);
  await waitFor(() => expect(calls.some((item) => item.command === "agent_permission_reply" && JSON.stringify(item.args) === JSON.stringify({ runId: "msg_run", requestId: "req_one", reply: "always" }))).toBe(true));
  expect(calls.some((item) => item.command === "tool_permission_reply")).toBe(false);
});
test("picker cancellation submits nothing", async () => {
  selected = null;
  render(<WorkspaceHarness prompt="不会发送" />);
  fireEvent.click(screen.getByRole("button", { name: "选择工作文件夹" }));
  await waitFor(() => expect(calls.some((item) => item.command === "agent_run_start")).toBe(false));
  expect(screen.queryByRole("button", { name: "开始任务" })).toBeNull();
});

test("shows host busy and read failures without allowing another start", async () => {
  projection = { active: run, recent: [], artifacts: [] };
  render(<WorkspaceHarness prompt="另一个任务" />);
  await screen.findByRole("button", { name: "停" });
  expect((screen.getByRole("button", { name: "选择工作文件夹" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "开始任务" })).toBeNull();
  cleanup();
  projection = { active: null, recent: [], artifacts: [] };
  failCommand = "agent_run_read";
  render(<WorkspaceHarness prompt="任务" />);
  await screen.findByRole("alert");
});

test("shows retryable archive failure from the cached host projection", async () => {
  projection = { active: { ...run, errorSummary: "history_storage_failed" }, recent: [], artifacts: [] };
  render(<WorkspaceHarness />);
  expect((await screen.findByRole("alert")).textContent).toBe("历史保存失败，可重试。");
});

test("keeps the selected folder and prompt when host start fails", async () => {
  failCommand = "agent_run_start";
  render(<WorkspaceHarness prompt="保留我" />);
  fireEvent.click(screen.getByRole("button", { name: "选择工作文件夹" }));
  await screen.findByText("C:\\workspace");
  fireEvent.click(screen.getByTestId("composer-submit"));
  await screen.findByRole("alert");
  expect(screen.getByText("C:\\workspace")).toBeDefined();
});

test("ignores an older host refresh that finishes after the current run", async () => {
  const oldRun = { ...run, runId: "msg_old", sessionId: "ses_old", workspacePath: "C:\\old" };
  const currentRun = { ...run, runId: "msg_current", sessionId: "ses_current", workspacePath: "C:\\current" };
  const resolvers: Array<(value: { active: typeof run | null; recent: readonly typeof run[]; artifacts: readonly object[] }) => void> = [];
  readOverride = () => new Promise((resolve) => resolvers.push(resolve));
  function Harness() {
    const agent = useAgentRun("zh-CN");
    return <><button type="button" onClick={() => void agent.refresh()}>refresh</button><output>{agent.projection.active?.runId ?? "none"}</output></>;
  }
  render(<Harness />);
  await waitFor(() => expect(resolvers).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "refresh" }));
  await waitFor(() => expect(resolvers).toHaveLength(2));
  resolvers[1]({ active: currentRun, recent: [], artifacts: [] });
  await screen.findByText("msg_current");
  resolvers[0]({ active: oldRun, recent: [], artifacts: [] });
  await waitFor(() => expect(screen.getByText("msg_current")).toBeDefined());
  expect(screen.queryByText("msg_old")).toBeNull();
});

test("uses English copy and a localized picker title", async () => {
  render(<WorkspaceHarness language="en-US" prompt="Review" />);
  fireEvent.click(screen.getByRole("button", { name: "Choose workspace folder" }));
  await screen.findByText("C:\\workspace");
  expect(dialogTitle).toBe("Choose workspace folder");
  expect(screen.queryByRole("button", { name: "Start task" })).toBeNull();
});

test("malformed host data shows safe localized copy without schema keys", async () => {
  readOverride = async () => ({ active: { broken: "workspacePath" }, recent: [], artifacts: [] });
  render(<WorkspaceHarness language="en-US" prompt="Review" />);
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Task status is temporarily unavailable. Try again.");
  expect(alert.textContent).not.toContain("workspacePath");
  expect(alert.textContent).not.toContain("runId");
});

test("shows verified files and commands but locates only by host reference", async () => {
  projection = { active: null, recent: [], artifacts: [
    { reference: "msg:part:call-file", runId: "run_artifact", kind: "file", label: "sum.ts", path: "C:\\workspace\\sum.ts", command: null, result: null, verified: true },
    { reference: "msg:part:call-command", runId: "run_artifact", kind: "command", label: "bun test", path: null, command: "bun test", result: "pass", verified: true },
    { reference: "msg:part:call-failed", runId: "run_artifact", kind: "file", label: "missing.md", path: null, command: null, result: null, verified: false },
  ] };
  render(<WorkspaceHarness language="en-US" />);
  await screen.findByText("C:\\workspace\\sum.ts");
  expect(screen.getAllByRole("button", { name: "Show in folder" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Show in folder" }));
  await waitFor(() => expect(calls.some((item) => item.command === "agent_artifact_locate" && JSON.stringify(item.args) === JSON.stringify({ runId: "run_artifact", reference: "msg:part:call-file" }))).toBe(true));
  expect(JSON.stringify(calls.find((item) => item.command === "agent_artifact_locate")?.args)).not.toContain("sum.ts");
  expect(screen.getByText("Not verified")).toBeDefined();
});



test("shows a localized scheduled busy receipt without resending it", async () => {
  projection = { active: null, recent: [{ ...run, outcome: "failed", errorSummary: "scheduled_agent_busy" }], artifacts: [] };
  const view = render(<WorkspaceHarness />);
  await waitFor(() => expect(view.container.querySelector(".workspace-task-recent")?.textContent).toContain("未执行：已有任务运行"));
  expect(calls.some((item) => item.command === "agent_run_start")).toBe(false);
});

test("keeps a long workspace path intact and applies the wrapping rule", async () => {
  const longPath = "C:\\Users\\example\\Documents\\projects\\deeply-nested-workspace\\packages\\desktop\\src\\features\\chat";
  projection = { active: { ...run, workspacePath: longPath }, recent: [], artifacts: [] };
  const view = render(<WorkspaceHarness />);
  await screen.findByText(longPath);
  expect(view.container.querySelector(".workspace-task-status span")?.textContent).toBe(longPath);
  const css = await Bun.file("src/chat/chat.css").text();
  const wrappingRule = css.match(/\.workspace-task-path span,\s*\.workspace-task-status span\s*\{([^}]*)\}/)?.[1] ?? "";
  expect(wrappingRule).toContain("overflow-wrap: anywhere");
  expect(wrappingRule).toContain("white-space: normal");
  expect(wrappingRule).not.toContain("text-overflow: ellipsis");
  expect(wrappingRule).not.toContain("white-space: nowrap");
});

test("shows recovered history workspace and retryable detail state", async () => {
  const agent = {
    projection: { active: null, recent: [], artifacts: [] },
    workspace: null,
    requests: [],
    error: null,
    busy: false,
    choose: async () => null,
    clear: () => {},
    clearSelection: () => {},
    start: async () => null,
    stop: async () => {},
    reply: async () => {},
    locate: async () => {},
    refresh: async () => {},
  } as unknown as ReturnType<typeof useAgentRun>;
  render(<WorkspaceTask
    language="en-US"
    agent={agent}
    historyDetails={{
      workspacePath: "C:\\recorded\\old-workspace",
      status: "completed",
      source: "interactive",
      availability: "retryable",
    }}
  />);
  expect(screen.getByText("C:\\recorded\\old-workspace")).toBeDefined();
  expect(screen.getByRole("alert").textContent).toContain("Open this history again to retry");
});
