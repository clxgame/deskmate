import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { OpenCodeFilePart } from "./attachments";

type PromptOptions = {
  readonly attachments?: OpenCodeFilePart[];
  readonly model?: { readonly providerID: string; readonly modelID: string };
  readonly system?: string;
};

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  () => Promise.resolve(undefined),
);
const promptAsync = mock<
  (sessionID: string, text: string, options?: PromptOptions) => Promise<void>
>(() => Promise.resolve());

mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
mock.module("@tauri-apps/api/event", () => ({
  emit: () => Promise.resolve(),
  listen: () => Promise.resolve(() => {}),
}));
mock.module("../lib/opencode", () => ({
  abortSession: () => Promise.resolve(),
  createSession: () =>
    Promise.resolve({ id: "ses_attachment", title: "t", directory: "." }),
  promptAsync,
  subscribeEvents: () => Promise.resolve(() => {}),
  waitForServer: () => Promise.resolve(),
}));

const { default: ChatApp } = await import("./ChatApp");

const SETTINGS = {
  autostart: false,
  language: "zh-CN",
  theme: "dark",
  providerId: "",
  modelId: "",
  yolo: false,
  baseUrl: "",
  apiKey: "",
  petScale: 1,
  outlineWidth: 0.0073,
  rimWidth: 0.4,
  rimIntensity: 1,
  specularIntensity: 0.5,
  petVisible: true,
  alwaysOnTop: true,
  scheduledTasks: [],
  shortcutToggleChat: "Ctrl+Alt+D",
  shortcutTogglePet: "",
  personaId: "xiaozhu",
  mouseFollow: false,
  userName: "",
  memoryAutoExtract: false,
  memoryAiUse: true,
  updateRepo: "clxgame/deskmate",
};

beforeEach(() => {
  invoke.mockReset();
  promptAsync.mockReset();
  invoke.mockImplementation((command: string) => {
    switch (command) {
      case "get_settings":
        return Promise.resolve(SETTINGS);
      case "load_persona":
        return Promise.resolve({ persona: "你是小著。", placeholders: null });
      case "memory_context":
      case "history_save":
        return Promise.resolve({ memories: [], promptBlock: "" });
      default:
        return Promise.resolve(undefined);
    }
  });
});

afterEach(cleanup);

function dropMarkdownFile(): void {
  const root = document.querySelector(".chat-root");
  if (!root) throw new Error("chat root is missing");
  const file = new File(["# 计划"], "notes.md", { type: "text/markdown" });
  fireEvent.drop(root, {
    dataTransfer: { files: [file], types: ["Files"] },
  });
}

async function expectAttachmentPrompt(expectedText: string): Promise<void> {
  await waitFor(() => expect(promptAsync).toHaveBeenCalledTimes(1));
  const [, text, options] = promptAsync.mock.calls[0] ?? [];
  expect(text).toBe(expectedText);
  expect(options?.attachments).toEqual([
    expect.objectContaining({
      filename: "notes.md",
      mime: "text/plain",
      type: "file",
      url: expect.stringContaining("data:text/plain"),
    }),
  ]);
}

describe("dropped attachment sending", () => {
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
});
