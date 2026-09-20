import { describe, expect, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../testing/chatAgentHistoryCases";
import { agentRun, ChatApp, deferAgentStart, finishAgentStart, invoke, promptRequests, selectWorkspace, setAgentProjection , registerChatAttachmentHarness } from "./chatAttachmentSendHarness.test";

function dropMarkdownFile(): void {
  const root = document.querySelector(".chat-root");
  if (!root) throw new Error("chat root is missing");
  fireEvent.drop(root, { dataTransfer: { files: [new File(["# 计划"], "notes.md", { type: "text/markdown" })], types: ["Files"] } });
}

async function expectAttachmentPrompt(expectedText: string): Promise<void> {
  await waitFor(() => expect(promptRequests).toHaveLength(1));
  const [textPart, filePart] = promptRequests[0]?.parts ?? [];
  expect(textPart?.text).toBe(expectedText);
  expect(filePart).toEqual(expect.objectContaining({ filename: "notes.md", mime: "text/plain", type: "file", url: expect.stringContaining("data:text/plain") }));
}

registerChatAttachmentHarness();

describe("dropped attachment sending", () => {
  test("routes an ordinary prompt through the selected provider and model", async () => {
    render(<ChatApp />);
    const input = await screen.findByPlaceholderText("输入消息,Enter 发送");
    fireEvent.change(input, { target: { value: "请概括今天的工作重点" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(promptRequests).toHaveLength(1));
    expect(promptRequests[0]?.model).toEqual({
      providerID: "yume-2",
      modelID: "claude-sonnet-4.5",
    });
    expect(invoke.mock.calls.some(([command]) => command === "agent_run_start")).toBe(false);
  });

  test("routes Send through the host agent when a workspace is selected", async () => {
    selectWorkspace("C:\\workspace");
    render(<ChatApp />);
    const input = await screen.findByPlaceholderText("输入消息,Enter 发送");
    fireEvent.click(screen.getByRole("button", { name: "选择工作文件夹" }));
    await screen.findByText("C:\\workspace");

    fireEvent.change(input, { target: { value: "整理项目" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(invoke.mock.calls.filter(([command]) => command === "agent_run_start")).toHaveLength(1);
    });
    expect(invoke.mock.calls.find(([command]) => command === "agent_run_start")?.[1]).toEqual({
      request: { workspacePath: "C:\\workspace", input: "整理项目" },
    });
    expect(promptRequests).toHaveLength(0);
    if (!(input instanceof HTMLTextAreaElement)) throw new Error("chat input is not a textarea");
    expect(input.value).toBe("");
  });

  test("routes Enter through the host agent when a workspace is selected", async () => {
    selectWorkspace("C:\\workspace");
    render(<ChatApp />);
    const input = await screen.findByPlaceholderText("输入消息,Enter 发送");
    fireEvent.click(screen.getByRole("button", { name: "选择工作文件夹" }));
    await screen.findByText("C:\\workspace");

    fireEvent.change(input, { target: { value: "运行检查" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(invoke.mock.calls.filter(([command]) => command === "agent_run_start")).toHaveLength(1);
    });
    expect(promptRequests).toHaveLength(0);
  });

  test("suppresses duplicate workspace submissions while start is pending", async () => {
    selectWorkspace("C:\\workspace");
    deferAgentStart();
    render(<ChatApp />);
    const input = await screen.findByPlaceholderText("输入消息,Enter 发送");
    fireEvent.click(screen.getByRole("button", { name: "选择工作文件夹" }));
    await screen.findByText("C:\\workspace");
    fireEvent.change(input, { target: { value: "只执行一次" } });
    const send = screen.getByRole("button", { name: "发送" });

    fireEvent.click(send);
    fireEvent.click(send);

    await waitFor(() => {
      expect(invoke.mock.calls.filter(([command]) => command === "agent_run_start")).toHaveLength(1);
    });
    await act(async () => finishAgentStart());
  });

  test("does not submit again while a workspace run is active", async () => {
    setAgentProjection(agentRun);
    render(<ChatApp />);
    const input = await screen.findByPlaceholderText("输入消息,Enter 发送");
    await screen.findByRole("button", { name: "停" });
    fireEvent.change(input, { target: { value: "不要重复执行" } });

    const send = screen.getByRole("button", { name: "发送" });
    if (!(send instanceof HTMLButtonElement)) throw new Error("send control is not a button");
    expect(send.disabled).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(invoke.mock.calls.filter(([command]) => command === "agent_run_start")).toHaveLength(0);
    });
    expect(promptRequests).toHaveLength(0);
  });

  test("blocks workspace attachments without dropping the staged item", async () => {
    selectWorkspace("C:\\workspace");
    render(<ChatApp />);
    await screen.findByPlaceholderText("输入消息,Enter 发送");
    fireEvent.click(screen.getByRole("button", { name: "选择工作文件夹" }));
    await screen.findByText("C:\\workspace");
    dropMarkdownFile();
    await screen.findByText("notes.md");
    const input = screen.getByPlaceholderText("输入消息,Enter 发送");
    fireEvent.change(input, { target: { value: "处理附件" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect((await screen.findByRole("alert")).textContent).toContain("工作文件夹任务暂不支持附件");
    expect(invoke.mock.calls.some(([command]) => command === "agent_run_start")).toBe(false);
    expect(screen.getByText("notes.md")).toBeTruthy();
  });

  test("sends a dropped file without typed text", async () => {
    render(<ChatApp />);
    await screen.findByPlaceholderText("输入消息,Enter 发送");
    dropMarkdownFile();

    await screen.findByText("notes.md");
    const send = screen.getByRole("button", { name: "发送" });
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(send);

    await expectAttachmentPrompt("请读取我上传的附件：notes.md");
  });

  test("keeps a dropped file when typed text is sent", async () => {
    render(<ChatApp />);
    const input = await screen.findByPlaceholderText("输入消息,Enter 发送");
    dropMarkdownFile();

    await screen.findByText("notes.md");
    fireEvent.change(input, { target: { value: "请整理这份笔记" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await expectAttachmentPrompt("请整理这份笔记");
  });

  test("keeps converted audio local without prompting the model", async () => {
    render(<ChatApp />);
    await screen.findByPlaceholderText("输入消息,Enter 发送");
    const root = document.querySelector(".chat-root");
    if (!root) throw new Error("chat root is missing");
    const file = new File(["ncm"], "locked.ncm", {
      type: "application/octet-stream",
    });
    fireEvent.drop(root, {
      dataTransfer: { files: [file], types: ["Files"] },
    });

    await screen.findByRole("alertdialog", { name: "转换 NCM 音乐" });
    fireEvent.click(screen.getByRole("button", { name: "转换" }));

    await screen.findByRole("article", { name: "生成的音频 song.mp3" });
    expect(screen.getByText("在的,说吧")).toBeTruthy();
    expect(promptRequests).toHaveLength(0);
  });
});
