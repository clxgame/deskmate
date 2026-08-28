import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  () => Promise.resolve(undefined),
);
const originalFetch = globalThis.fetch;
const OriginalEventSource = globalThis.EventSource;

type PromptPart = {
  readonly type?: string;
  readonly text?: string;
  readonly filename?: string;
  readonly mime?: string;
  readonly url?: string;
};

type PromptRequest = {
  readonly parts?: readonly PromptPart[];
};

const promptRequests: PromptRequest[] = [];

mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
mock.module("@tauri-apps/api/event", () => ({
  emit: () => Promise.resolve(),
  listen: () => Promise.resolve(() => {}),
}));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function installOpenCodeTransport(): void {
  const fetchMock = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/session") && init?.method === "GET") {
      return Promise.resolve(new Response(null, { status: 200 }));
    }
    if (url.endsWith("/session") && init?.method === "POST") {
      return Promise.resolve(
        jsonResponse({ id: "ses_attachment", title: "t", directory: "." }),
      );
    }
    if (url.endsWith("/session/ses_attachment/prompt_async") && init?.method === "POST") {
      promptRequests.push(JSON.parse(String(init.body ?? "{}")) as PromptRequest);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.endsWith("/session/ses_attachment/abort") && init?.method === "POST") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(new Response("unexpected opencode test request", { status: 500 }));
  });
  globalThis.fetch = Object.assign(fetchMock, {
    preconnect: originalFetch.preconnect,
  });
  globalThis.EventSource = class {
    onmessage: ((message: MessageEvent) => void) | null = null;

    constructor(readonly url: string) {
      expect(url).toBe("http://127.0.0.1:48888/event");
    }

    close(): void {}
  } as typeof EventSource;
}

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
  promptRequests.length = 0;
  invoke.mockImplementation((command: string) => {
    switch (command) {
      case "sidecar_base_url":
        return Promise.resolve("http://127.0.0.1:48888");
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
  installOpenCodeTransport();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  globalThis.EventSource = OriginalEventSource;
});

function dropMarkdownFile(): void {
  const root = document.querySelector(".chat-root");
  if (!root) throw new Error("chat root is missing");
  const file = new File(["# 计划"], "notes.md", { type: "text/markdown" });
  fireEvent.drop(root, {
    dataTransfer: { files: [file], types: ["Files"] },
  });
}

async function expectAttachmentPrompt(expectedText: string): Promise<void> {
  await waitFor(() => expect(promptRequests).toHaveLength(1));
  const [textPart, filePart] = promptRequests[0]?.parts ?? [];
  expect(textPart?.text).toBe(expectedText);
  expect(filePart).toEqual(
    expect.objectContaining({
      filename: "notes.md",
      mime: "text/plain",
      type: "file",
      url: expect.stringContaining("data:text/plain"),
    }),
  );
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
