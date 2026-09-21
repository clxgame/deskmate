import { afterEach, beforeEach, expect, mock } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import { cleanup } from "@testing-library/react";

export const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  () => Promise.resolve(undefined),
);
const originalFetch = globalThis.fetch;
const OriginalEventSource = globalThis.EventSource;

type PromptPart = Readonly<{ type?: string; text?: string; filename?: string; mime?: string; url?: string }>;
type PromptRequest = Readonly<{
  parts?: readonly PromptPart[];
  model?: Readonly<{ providerID?: string; modelID?: string }>;
}>;

export const promptRequests: PromptRequest[] = [];
export const agentRun = {
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
let historyRecords: Record<string, object> = {};
let historyLoadOverride: ((id: string) => Promise<object | null>) | null = null;
let sessionCreateRequests = 0;
let agentStartError: string | null = null;
let activeEventSource: { onmessage: ((message: MessageEvent) => void) | null } | null = null;

function installNativeMocks(): void {
  mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
  mock.module("@tauri-apps/api/event", () => ({
    emit: () => Promise.resolve(),
    listen: () => Promise.resolve(() => {}),
  }));
  mock.module("@tauri-apps/plugin-dialog", () => ({
    open: () => Promise.resolve(selectedWorkspace),
  }));
}

installNativeMocks();

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
      sessionCreateRequests += 1;
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
      activeEventSource = this;
    }

    close(): void {}
  } as typeof EventSource;
}

export const { default: ChatApp } = await import("./ChatApp");

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

export function registerChatAttachmentHarness(): void {
  beforeEach(() => {
  // Bun may discover this helper before running other files that replace the
  // same modules. Resetting invoke alone does not restore their live exports.
  installNativeMocks();
  invoke.mockReset();
  promptRequests.length = 0;
  agentProjection = { active: null, recent: [], artifacts: [] };
  selectedWorkspace = null;
  holdAgentStart = false;
  releaseAgentStart = null;
  historyRecords = {};
  historyLoadOverride = null;
  sessionCreateRequests = 0;
  agentStartError = null;
  activeEventSource = null;
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
        if (agentStartError) return Promise.reject(new Error(agentStartError));
        const request = (args as { request?: { historyId?: string } } | undefined)?.request;
        const finish = () => {
          agentProjection = { active: request?.historyId ? { ...agentRun, sessionId: request.historyId } : agentRun, recent: [], artifacts: [] };
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
      case "history_list":
        return Promise.resolve(Object.values(historyRecords).map((item) => {
          const session = item as { id: string; title: string; created: number; updated: number; messages: readonly object[] };
          return { id: session.id, title: session.title, created: session.created, updated: session.updated, count: session.messages.length };
        }));
      case "history_load": {
        const id = (args as { id?: string } | undefined)?.id ?? "";
        return historyLoadOverride ? historyLoadOverride(id) : Promise.resolve(historyRecords[id] ?? null);
      }
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
}
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
export function selectWorkspace(path: string | null): void { selectedWorkspace = path; }
export function deferAgentStart(): void { holdAgentStart = true; }
export function finishAgentStart(): void { releaseAgentStart?.(); }
export function setAgentProjection(active: typeof agentRun | null): void { agentProjection = { active, recent: [], artifacts: [] }; }
export function setAgentStartError(error: string | null): void { agentStartError = error; }
export function setHistory(records: Record<string, object>): void { historyRecords = records; }
export function historyRecord(id: string): object | undefined { return historyRecords[id]; }
export function setHistoryLoader(loader: ((id: string) => Promise<object | null>) | null): void { historyLoadOverride = loader; }
export function sessionCreates(): number { return sessionCreateRequests; }
export function sendOrdinaryEvent(data: object): void { activeEventSource?.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) })); }
export function histories(): Record<string, object> { return historyRecords; }
