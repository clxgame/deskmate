import { afterEach, beforeEach, mock } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import { cleanup, fireEvent, screen } from "@testing-library/react";

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  () => Promise.resolve(undefined),
);
const originalConsoleError = console.error;
const originalFetch = globalThis.fetch;
const OriginalEventSource = globalThis.EventSource;

type PromptPart = { readonly type?: string; readonly filename?: string };
type PromptRequest = { readonly parts?: readonly PromptPart[] };
type HistoryMessage = { readonly role: "user" | "assistant"; readonly text: string; readonly time: number };
type HistorySummaryFixture = { readonly id: string; readonly title: string; readonly created: number; readonly updated: number; readonly count: number };

export const consoleError = mock<(...data: unknown[]) => void>(() => undefined);
export const promptRequests: PromptRequest[] = [];
export const transportEvents: string[] = [];

const historySessions = new Map<string, readonly HistoryMessage[]>();
let nextSessionIndex = 0;
let promptFails = false;
let cleanupFails = false;

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
  consoleError.mockReset();
  console.error = consoleError;
  promptRequests.length = 0;
  transportEvents.length = 0;
  historySessions.clear();
  nextSessionIndex = 0;
  promptFails = false;
  cleanupFails = false;
  invoke.mockImplementation(handleInvoke);
  installOpenCodeTransport();
});

afterEach(() => {
  cleanup();
  console.error = originalConsoleError;
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    value: OriginalEventSource,
    writable: true,
  });
});

export function setPromptFails(value: boolean): void {
  promptFails = value;
}

export function setCleanupFails(value: boolean): void {
  cleanupFails = value;
}

export function setHistorySession(id: string, messages: readonly HistoryMessage[]): void {
  historySessions.set(id, messages);
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

export function cleanupSessions(): readonly string[] {
  return commands("cleanup_chat_session").map((args) => payloadSessionId(args));
}

export function stageSessionIds(): readonly string[] {
  return commands("stage_chat_attachment").map((args) => payloadSessionId(args));
}

export function discardedIds(): readonly string[] {
  return commands("discard_chat_attachment").map((args) => payloadAttachmentId(args));
}

export function orderedEvents(): readonly string[] {
  return transportEvents
    .map((event) => event.replace("cleanup_chat_session:", "cleanup:"))
    .filter((event) => event.startsWith("history_load:") || event.startsWith("cleanup:") || event.startsWith("stage:") || event.startsWith("abort:"));
}

function handleInvoke(command: string, args?: unknown): Promise<unknown> {
  transportEvents.push(`${command}:${commandSessionId(command, args) ?? ""}`);
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
      return Promise.resolve(Array.from(historySessions.keys()).map(historySummary));
    case "history_load":
      return Promise.resolve(historyRecord(payloadId(args)));
    case "history_delete":
      historySessions.delete(payloadId(args));
      return Promise.resolve(undefined);
    case "memory_forget_conversation":
    case "hide_chat":
      return Promise.resolve(undefined);
    case "stage_chat_attachment":
      return Promise.resolve(stageResponse(args));
    case "read_chat_attachment":
      return Promise.resolve(readResponse(args));
    case "convert_staged_ncm":
      return Promise.resolve(readyAttachment("artifact-song", "song.mp3", "audio/mpeg", "audio", payloadSessionId(args)));
    case "export_chat_artifact":
      return Promise.resolve(exportReceipt(args));
    case "discard_chat_attachment":
      return Promise.resolve({ discarded: true });
    case "cleanup_chat_session":
      return cleanupFails ? Promise.reject(new Error("cleanup denied")) : Promise.resolve({ removed: 1 });
    default:
      return Promise.resolve(undefined);
  }
}

function historySummary(id: string): HistorySummaryFixture {
  return { id, title: "Past", created: 1, updated: 2, count: 1 };
}

function historyRecord(id: string): unknown {
  return { ...historySummary(id), messages: historySessions.get(id) ?? [] };
}

function exportReceipt(args: unknown): unknown {
  return { artifactId: "artifact-song", sessionId: payloadSessionId(args), fileName: "song.mp3", mime: "audio/mpeg", size: 3, exportedAt: "2026-08-28T00:00:00Z" };
}

function stageResponse(args: unknown): unknown {
  const request = payloadRequest(args);
  const fileName = stringField(request, "fileName");
  const isNcm = fileName.endsWith(".ncm");
  transportEvents.push(`stage:${stringField(request, "sessionId")}`);
  return { id: isNcm ? "stage-ncm" : "stage-notes", sessionId: stringField(request, "sessionId"), fileName, mime: isNcm ? "application/x-ncm" : "text/plain", size: numberField(request, "size"), kind: isNcm ? "audio" : "text", status: "staged" };
}

function readResponse(args: unknown): unknown {
  return readyAttachment(payloadAttachmentId(args), "notes.md", "text/plain", "text", payloadSessionId(args));
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
    if (url.includes("/abort") && init?.method === "POST") return abortResponse(url);
    return Promise.resolve(new Response("unexpected opencode test request", { status: 500 }));
  });
  globalThis.fetch = Object.assign(fetchMock, { preconnect: originalFetch.preconnect });
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    value: class {
      onmessage: ((message: MessageEvent) => void) | null = null;
      constructor(readonly url: string) {}
      close(): void {}
    },
    writable: true,
  });
}

function promptResponse(init: RequestInit): Promise<Response> {
  promptRequests.push(JSON.parse(String(init.body ?? "{}")) as PromptRequest);
  return Promise.resolve(new Response(promptFails ? "failed" : null, { status: promptFails ? 500 : 204 }));
}

function abortResponse(url: string): Promise<Response> {
  transportEvents.push(`abort:${url.split("/session/")[1]?.split("/")[0] ?? ""}`);
  return Promise.resolve(new Response(null, { status: 204 }));
}

function nextSessionId(): string {
  const sessions = ["ses-a", "ses-b"] as const;
  const sessionId = sessions[nextSessionIndex] ?? `ses-extra-${nextSessionIndex}`;
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

function payloadId(args: unknown): string {
  if (typeof args !== "object" || args === null || !("id" in args) || typeof args.id !== "string") throw new Error("id missing");
  return args.id;
}

function payloadSessionId(args: unknown): string {
  return stringField(payloadRequest(args), "sessionId");
}

function payloadAttachmentId(args: unknown): string {
  return stringField(payloadRequest(args), "attachmentId");
}

function commandSessionId(command: string, args: unknown): string | null {
  if (command === "history_load" || command === "history_delete") return payloadId(args);
  if (typeof args === "object" && args !== null && "request" in args) return payloadSessionId(args);
  return null;
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
