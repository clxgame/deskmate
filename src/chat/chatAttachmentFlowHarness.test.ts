import { afterEach, beforeEach, expect, mock } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import { cleanup, fireEvent, screen } from "@testing-library/react";

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  () => Promise.resolve(undefined),
);
const originalFetch = globalThis.fetch;
const OriginalEventSource = globalThis.EventSource;

type PromptPart = {
  readonly type?: string;
  readonly filename?: string;
};
type PromptRequest = {
  readonly parts?: readonly PromptPart[];
};

export const promptRequests: PromptRequest[] = [];

let convertFails = false;
let promptFails = false;
let nextSessionIndex = 0;

mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
mock.module("@tauri-apps/api/event", () => ({
  emit: () => Promise.resolve(),
  listen: () => Promise.resolve(() => {}),
}));

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
  convertFails = false;
  promptFails = false;
  nextSessionIndex = 0;
  invoke.mockImplementation(handleInvoke);
  installOpenCodeTransport();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    value: OriginalEventSource,
    writable: true,
  });
});

export function setConvertFails(value: boolean): void {
  convertFails = value;
}

export function setPromptFails(value: boolean): void {
  promptFails = value;
}

export async function readyComposer(): Promise<HTMLElement> {
  await screen.findByText("在的,说吧");
  return await screen.findByPlaceholderText("输入消息,Enter 发送");
}

export function dropFiles(files: readonly File[]): void {
  const root = document.querySelector(".chat-root");
  if (!(root instanceof HTMLElement)) throw new Error("chat root is missing");
  fireEvent.drop(root, { dataTransfer: { files, types: ["Files"] } });
}

export function commands(command: string): readonly unknown[] {
  return invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args);
}

export function discardedIds(): readonly string[] {
  return commands("discard_chat_attachment").map((args) => stringField(payloadRequest(args), "attachmentId"));
}

function handleInvoke(command: string, args?: unknown): Promise<unknown> {
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
    case "history_list":
      return Promise.resolve([]);
    case "stage_chat_attachment":
      return Promise.resolve(stageResponse(args));
    case "read_chat_attachment":
      return Promise.resolve(readyAttachment("stage-notes", "notes.md", "text/plain", "text", payloadSessionId(args)));
    case "convert_staged_ncm":
      return convertResponse(args);
    case "export_chat_artifact":
      return Promise.resolve({ artifactId: "artifact-song", sessionId: payloadSessionId(args), fileName: "song.mp3", mime: "audio/mpeg", size: 3, exportedAt: "2026-08-28T00:00:00Z" });
    case "discard_chat_attachment":
      return Promise.resolve({ discarded: true });
    case "cleanup_chat_session":
      return Promise.resolve({ removed: 0 });
    default:
      return Promise.resolve(undefined);
  }
}

function convertResponse(args: unknown): Promise<unknown> {
  if (convertFails) {
    convertFails = false;
    return Promise.reject(new Error("ncmdump failed"));
  }
  return Promise.resolve(readyAttachment("artifact-song", "song.mp3", "audio/mpeg", "audio", payloadSessionId(args)));
}

function stageResponse(args: unknown): unknown {
  const request = payloadRequest(args);
  const fileName = stringField(request, "fileName");
  const isNcm = fileName.endsWith(".ncm");
  return { id: isNcm ? "stage-ncm" : "stage-notes", sessionId: stringField(request, "sessionId"), fileName, mime: isNcm ? "application/x-ncm" : "text/plain", size: numberField(request, "size"), kind: isNcm ? "audio" : "text", status: "staged" };
}

function readyAttachment(id: string, fileName: string, mime: string, kind: string, sessionId: string): unknown {
  return { id, sessionId, fileName, mime, size: 3, kind, status: "ready", dataUrl: `data:${mime};base64,AAAA` };
}

function installOpenCodeTransport(): void {
  const fetchMock = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/session") && init?.method === "GET") return Promise.resolve(new Response(null, { status: 200 }));
    if (url.endsWith("/session") && init?.method === "POST") return Promise.resolve(jsonResponse({ id: nextSessionId(), title: "t", directory: "." }));
    if (url.includes("/prompt_async") && init?.method === "POST") return promptResponse(init);
    if (url.includes("/abort") && init?.method === "POST") return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(new Response("unexpected opencode test request", { status: 500 }));
  });
  globalThis.fetch = Object.assign(fetchMock, { preconnect: originalFetch.preconnect });
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    value: class {
      onmessage: ((message: MessageEvent) => void) | null = null;
      constructor(readonly url: string) {
        expect(url).toBe("http://127.0.0.1:48888/event");
      }
      close(): void {}
    },
    writable: true,
  });
}

function promptResponse(init: RequestInit): Promise<Response> {
  promptRequests.push(JSON.parse(String(init.body ?? "{}")) as PromptRequest);
  return Promise.resolve(new Response(promptFails ? "failed" : null, { status: promptFails ? 500 : 204 }));
}

function nextSessionId(): string {
  const sessionId = nextSessionIndex === 0 ? "ses-flow" : `ses-flow-${nextSessionIndex + 1}`;
  nextSessionIndex += 1;
  return sessionId;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function payloadRequest(args: unknown): Readonly<Record<string, unknown>> {
  if (typeof args !== "object" || args === null || !("request" in args)) throw new Error("request payload missing");
  const request = args.request;
  if (typeof request !== "object" || request === null) throw new Error("request missing");
  return Object.fromEntries(Object.entries(request));
}

function payloadSessionId(args: unknown): string {
  return stringField(payloadRequest(args), "sessionId");
}

function stringField(record: Readonly<Record<string, unknown>>, field: string): string {
  const value = record[field];
  if (typeof value !== "string") throw new Error(`${field} missing`);
  return value;
}

function numberField(record: Readonly<Record<string, unknown>>, field: string): number {
  const value = record[field];
  if (typeof value !== "number") throw new Error(`${field} missing`);
  return value;
}
