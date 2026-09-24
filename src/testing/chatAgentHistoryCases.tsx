import { nativeHistoryFixture } from "./historyCatalogFixtures";
import type { HistorySession } from "../lib/history";
import { describe, expect, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { agentRun, ChatApp, histories, invoke, promptRequests, sendOrdinaryEvent, sessionCreates, setAgentProjection, setAgentStartError, setHistory, setHistoryLoader  } from "../chat/chatAttachmentSendHarness.test";

describe("Agent history view", () => {
  test("opens Agent history locally and continues the exact native session", async () => {
    histories().ses_history = {
      id: "ses_history", title: "历史工作", created: 1, updated: 2,
      originRunId: "msg_origin",
      messages: [
        { role: "user", text: "第一轮", time: 1, messageId: "msg_origin" },
        { role: "assistant", text: "已完成", time: 2, messageId: "msg_reply", partId: "part_reply" },
      ],
    };
    render(<ChatApp />);
    await screen.findByPlaceholderText("输入消息,Enter 发送");
    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    fireEvent.click(await screen.findByRole("button", { name: /^打开 历史工作$/ }));
    await screen.findByText("第一轮");
    await screen.findByText("已完成");
    expect(sessionCreates()).toBe(1);
    expect(promptRequests).toHaveLength(0);

    const input = screen.getByPlaceholderText("输入消息,Enter 发送");
    fireEvent.change(input, { target: { value: "继续处理" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(invoke.mock.calls.filter(([command]) => command === "agent_run_start")).toHaveLength(1));
    expect(invoke.mock.calls.find(([command]) => command === "agent_run_start")?.[1]).toEqual({
      request: { historyId: "ses_history", catalogKey: nativeHistoryFixture("ses_history", agentRun.workspacePath).key, input: "继续处理" },
    });
    expect(promptRequests).toHaveLength(0);
  });

  test("a late history load cannot paint over the newly selected Agent conversation", async () => {
    setHistory({
      ses_a: { id: "ses_a", title: "A 会话", created: 1, updated: 1, originRunId: "msg_a", messages: [{ role: "assistant", text: "A 的结果", time: 1 }] },
      ses_b: { id: "ses_b", title: "B 会话", created: 2, updated: 2, originRunId: "msg_b", messages: [{ role: "assistant", text: "B 的结果", time: 2 }] },
    });
    let releaseA: ((value: HistorySession | null) => void) | null = null;
    setHistoryLoader((id) => id === "ses_a" ? new Promise((resolve) => { releaseA = resolve; }) : Promise.resolve(histories()[id] ?? null));
    render(<ChatApp />);
    await screen.findByPlaceholderText("输入消息,Enter 发送");
    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    fireEvent.click(await screen.findByRole("button", { name: /^打开 A 会话$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^打开 B 会话$/ }));
    await screen.findByText("B 的结果");
    await act(async () => releaseA?.(histories().ses_a));
    expect(screen.queryByText("A 的结果")).toBeNull();
    expect(screen.getByText("B 的结果")).toBeTruthy();
  });

  test("ordinary SSE cannot paint into an Agent history view", async () => {
    histories().ses_history = {
      id: "ses_history", title: "隔离历史", created: 1, updated: 2, originRunId: "msg_origin",
      messages: [{ role: "assistant", text: "Agent 内容", time: 2 }],
    };
    render(<ChatApp />);
    await screen.findByPlaceholderText("输入消息,Enter 发送");
    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    fireEvent.click(await screen.findByRole("button", { name: /^打开 隔离历史$/ }));
    await screen.findByText("Agent 内容");
    sendOrdinaryEvent({ type: "message.updated", properties: { info: { id: "ordinary-reply", sessionID: "ses_attachment", role: "assistant" } } });
    sendOrdinaryEvent({ type: "message.part.updated", properties: { part: { id: "ordinary-part", sessionID: "ses_attachment", messageID: "ordinary-reply", type: "text", text: "错误串入" } } });
    expect(screen.queryByText("错误串入")).toBeNull();
    expect(screen.getByText("Agent 内容")).toBeTruthy();
  });

  test("shows the final archived Agent reply when the active projection clears", async () => {
    histories().ses_history = {
      id: "ses_history", title: "完成中的历史", created: 1, updated: 2, originRunId: "msg_origin",
      messages: [{ role: "assistant", text: "处理中", time: 2 }],
    };
    setAgentProjection({ ...agentRun, sessionId: "ses_history" });
    render(<ChatApp />);
    await screen.findByPlaceholderText("输入消息,Enter 发送");
    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    fireEvent.click(await screen.findByRole("button", { name: /^打开 完成中的历史$/ }));
    await screen.findByText("处理中");
    const createsBeforeFinish = sessionCreates();
    const startsBeforeFinish = invoke.mock.calls.filter(([command]) => command === "agent_run_start").length;
    const savesBeforeFinish = invoke.mock.calls.filter(([command]) => command === "history_save").length;
    histories().ses_history = {
      id: "ses_history", title: "完成中的历史", created: 1, updated: 3, originRunId: "msg_origin",
      messages: [{ role: "assistant", text: "最终回复", time: 3 }],
    };
    setAgentProjection(null);
    await waitFor(() => expect(screen.getAllByText("最终回复")).toHaveLength(1), { timeout: 3_000 });
    expect(screen.queryByText("处理中")).toBeNull();
    expect(sessionCreates()).toBe(createsBeforeFinish);
    expect(invoke.mock.calls.filter(([command]) => command === "agent_run_start")).toHaveLength(startsBeforeFinish);
    expect(invoke.mock.calls.filter(([command]) => command === "history_save")).toHaveLength(savesBeforeFinish);
    expect(promptRequests).toHaveLength(0);
  });

  test("keeps Agent history and input readable when its original workspace is missing", async () => {
    histories().ses_history = {
      id: "ses_history", title: "只读历史", created: 1, updated: 2, originRunId: "msg_origin",
      messages: [{ role: "assistant", text: "仍可阅读", time: 2 }],
    };
    setAgentStartError("agent_history_workspace_missing");
    render(<ChatApp />);
    await screen.findByPlaceholderText("输入消息,Enter 发送");
    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    fireEvent.click(await screen.findByRole("button", { name: /^打开 只读历史$/ }));
    await screen.findByText("仍可阅读");
    const input = screen.getByPlaceholderText("输入消息,Enter 发送");
    fireEvent.change(input, { target: { value: "不要丢失" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect((await screen.findByRole("alert")).textContent).toContain("原工作文件夹不可用");
    expect((input as HTMLTextAreaElement).value).toBe("不要丢失");
    expect(screen.getByText("仍可阅读")).toBeTruthy();
  });

});

for (const action of ["archive", "failed-delete"] as const) {
  test(`selected completed Agent history denies continuation after ${action}`, async () => {
    // Given a completed native Agent conversation already selected in light chat.
    histories().ses_history = {
      id: "ses_history", title: "已完成任务", created: 1, updated: 2, originRunId: "msg_origin",
      messages: [{ role: "assistant", text: "任务结果", time: 2 }],
    };
    render(<ChatApp />);
    await screen.findByPlaceholderText("输入消息,Enter 发送");
    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    fireEvent.click(await screen.findByRole("button", { name: "打开 已完成任务" }));
    await screen.findByText("任务结果");
    expect(screen.getByPlaceholderText("输入消息,Enter 发送")).toBeTruthy();
    // When the organizer archives it or creates a deletion tombstone before remote failure.
    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    fireEvent.click(await screen.findByRole("button", { name: "会话操作 已完成任务" }));
    switch (action) {
      case "archive":
        fireEvent.click(screen.getByRole("button", { name: "归档" }));
        await waitFor(() => expect(screen.queryByRole("button", { name: "打开 已完成任务" }) === null).toBe(true));
        break;
      case "failed-delete":
        fireEvent.click(screen.getByRole("button", { name: "删除" }));
        fireEvent.click(screen.getByRole("button", { name: "永久删除" }));
        await screen.findByText(/remote delete unavailable/);
        break;
    }
    await waitFor(() => expect(invoke.mock.calls.filter(([command]) => command === "history_catalog_load").length).toBeGreaterThan(2));
    fireEvent.click(screen.getByRole("button", { name: "关闭历史" }));
    // Then stale selected state cannot expose a composer or start another run.
    await waitFor(() => expect(screen.queryByPlaceholderText("输入消息,Enter 发送") === null).toBe(true));
    expect(screen.getByText("任务结果")).toBeTruthy();
    expect(invoke.mock.calls.filter(([command]) => command === "agent_run_start")).toHaveLength(0);
    expect(promptRequests).toHaveLength(0);
  });
}
test("selected externally started Agent conversation refreshes completion while local projection stays idle", async () => {
  // Given a native Agent run started outside this mounted chat's idle projection.
  const activeRecord: HistorySession = {
    id: "ses_external", title: "外部启动任务", created: 1, updated: 2, originRunId: "msg_external",
    agentDetails: { workspacePath: agentRun.workspacePath, status: "active", source: "interactive", availability: "ready" },
    messages: [{ role: "assistant", text: "外部任务处理中", time: 2 }],
  };
  histories().ses_external = activeRecord;
  render(<ChatApp />);
  await screen.findByPlaceholderText("输入消息,Enter 发送");
  fireEvent.click(screen.getByRole("button", { name: "历史" }));
  fireEvent.click(await screen.findByRole("button", { name: "打开 外部启动任务" }));
  await screen.findByText("外部任务处理中");
  expect(screen.queryByPlaceholderText("输入消息,Enter 发送") === null).toBe(true);

  // When the host finishes the run without this chat starting or observing it locally.
  histories().ses_external = {
    ...activeRecord, updated: 3,
    agentDetails: { workspacePath: agentRun.workspacePath, status: "completed", source: "interactive", availability: "ready" },
    messages: [{ role: "assistant", text: "外部任务最终结果", time: 3 }],
  };

  // Then the selected scoped view refreshes without another selection or a new run.
  await screen.findByText("外部任务最终结果", {}, { timeout: 3_000 });
  expect(screen.queryByText("外部任务处理中") === null).toBe(true);
  expect(sessionCreates()).toBe(1);
  expect(invoke.mock.calls.filter(([command]) => command === "agent_run_start")).toHaveLength(0);
  expect(promptRequests).toHaveLength(0);
});