import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
  readonly model?: {
    readonly providerID?: string;
    readonly modelID?: string;
  };
};

const promptRequests: PromptRequest[] = [];
const agentRun = {
  runId: "run_workspace",
  sessionId: "ses_workspace",
  workspacePath: "C:\\workspace",
  createdAt: "2026-09-19T00:00:00Z",
  endedAt: null,
  outcome: null,
  errorSummary: null,
  messageIds: [],
  partIds: [],
  callIds: [],
};
let agentProjection: {
  active: typeof agentRun | null;
  recent: readonly (typeof agentRun)[];
  artifacts: readonly object[];
} = { active: null, recent: [], artifacts: [] };
let selectedWorkspace: string | null = null;
let holdAgentStart = false;
let releaseAgentStart: (() => void) | null = null;

mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
mock.module("@tauri-apps/api/event", () => ({
  emit: () => Promise.resolve(),
  listen: () => Promise.resolve(() => {}),
}));
mock.module("@tauri-apps/plugin-dialog", () => ({
  open: () => Promise.resolve(selectedWorkspace),
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
  providerId: "yume-2",
  modelId: "claude-sonnet-4.5",
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
  agentProjection = { active: null, recent: [], artifacts: [] };
  selectedWorkspace = null;
  holdAgentStart = false;
  releaseAgentStart = null;
  invoke.mockImplementation((command: string, args?: unknown) => {
    switch (command) {
      case "sidecar_base_url":
        return Promise.resolve("http://127.0.0.1:48888");
      case "get_settings":
        return Promise.resolve(SETTINGS);
      case "load_persona":
        return Promise.resolve({ persona: "你是小著。", placeholders: null });
      case "stage_chat_attachment":
        return Promise.resolve(stageResponse(args));
      case "read_chat_attachment":
        return Promise.resolve({
          id: "stage-notes",
          sessionId: "ses_attachment",
          fileName: "notes.md",
          mime: "text/plain",
          size: 8,
          kind: "text",
          status: "ready",
          dataUrl: "data:text/plain;base64,IyDorrHliZI=",
        });
      case "convert_staged_ncm":
        return Promise.resolve({
          id: "artifact-song",
          sessionId: "ses_attachment",
          fileName: "song.mp3",
          mime: "audio/mpeg",
          size: 3,
          kind: "audio",
          status: "ready",
          dataUrl: "data:audio/mpeg;base64,bmNt",
        });
      case "export_chat_artifact":
        return Promise.resolve({
          artifactId: "artifact-song",
          sessionId: "ses_attachment",
          fileName: "song.mp3",
          mime: "audio/mpeg",
          size: 3,
          exportedAt: "2026-08-28T00:00:00Z",
        });
      case "discard_chat_attachment":
        return Promise.resolve({ discarded: true });
      case "cleanup_chat_session":
        return Promise.resolve({ removed: 0 });
      case "agent_run_read":
        return Promise.resolve(agentProjection);
      case "agent_run_start": {
        const finish = () => {
          agentProjection = { active: agentRun, recent: [], artifacts: [] };
        };
        if (!holdAgentStart) {
          finish();
          return Promise.resolve(agentRun);
        }
        return new Promise((resolve) => {
          releaseAgentStart = () => {
            finish();
            resolve(agentRun);
          };
        });
      }
      case "agent_permission_pending":
        return Promise.resolve([]);
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
    selectedWorkspace = "C:\\workspace";
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
    selectedWorkspace = "C:\\workspace";
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
    selectedWorkspace = "C:\\workspace";
    holdAgentStart = true;
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
    await act(async () => releaseAgentStart?.());
  });

  test("does not submit again while a workspace run is active", async () => {
    agentProjection = { active: agentRun, recent: [], artifacts: [] };
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

function stageResponse(args: unknown): unknown {
  const request = payloadRequest(args);
  const fileName = typeof request.fileName === "string" ? request.fileName : "file.bin";
  const isNcm = fileName.endsWith(".ncm");
  return {
    id: isNcm ? "stage-ncm" : "stage-notes",
    sessionId: request.sessionId,
    fileName,
    mime: isNcm ? "application/x-ncm" : "text/plain",
    size: request.size,
    kind: isNcm ? "audio" : "text",
    status: "staged",
  };
}

function payloadRequest(args: unknown): Readonly<Record<string, unknown>> {
  if (typeof args !== "object" || args === null || !("request" in args)) {
    throw new Error("request payload missing");
  }
  const request = args.request;
  if (typeof request !== "object" || request === null) throw new Error("request missing");
  return Object.fromEntries(Object.entries(request));
}
