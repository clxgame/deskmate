import type { AgentHistoryDetails, HistorySession } from "../lib/history";
import { catalogPageFixture, historyArgument, nativeHistoryFixture, registeredHistoryFixture } from "../testing/historyCatalogFixtures";
import type { UnifiedHistoryRow } from "../lib/unifiedHistory";
import { afterEach, beforeEach, expect, mock } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import { cleanup } from "@testing-library/react";
import type { LocalResource } from "./localResources";

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
let attachmentPicker: () => Promise<unknown> = async () => [];
export function setAttachmentPicker(pick: () => Promise<unknown>): void { attachmentPicker = pick; }
const resourceMetadata = new Map<string, LocalResource>();
const resourceBytes = new Map<string, { fileName: string; base64: string }>();
const messageResources = new Map<string, readonly LocalResource[]>();
const nativeListeners = new Map<string, Set<(event: { payload: unknown }) => void>>();
let resourcePreparationError: string | null = null;
let resourcePreparationPending: Promise<void> | null = null;
let releaseResourcePreparation: (() => void) | null = null;
export function setResourcePreparationError(error: string | null): void { resourcePreparationError = error; }
export function deferResourcePreparation(): void { resourcePreparationPending = new Promise(resolve => { releaseResourcePreparation = resolve; }); }
export function finishResourcePreparation(): void { releaseResourcePreparation?.(); resourcePreparationPending = null; }
export function registerResource(resource: LocalResource, contents?: string): LocalResource {
  resourceMetadata.set(resource.id, resource);
  if (contents !== undefined) resourceBytes.set(resource.id, { fileName: resource.name, base64: btoa(contents) });
  return resource;
}
export function dropNativeResources(resources: readonly LocalResource[]): void {
  resources.forEach(resource => registerResource(resource));
  for (const callback of nativeListeners.get("chat-resources-dropped") ?? []) callback({ payload: resources });
}
export function setMessageResources(messageId: string, resources: readonly LocalResource[]): void {
  resources.forEach(resource => registerResource(resource));
  messageResources.set(messageId, resources);
}

const defaultModel = { configuredProviderId: "test-entry", sidecarId: "yume-2", modelId: "claude-sonnet-4.5", modelName: "Claude Sonnet 4.5" };
const alternativeModel = { configuredProviderId: "test-entry", sidecarId: "yume-2", modelId: "selected-model-b", modelName: "Selected Model B" };
let verifiedModels = [defaultModel, alternativeModel];
const modelSelections = new Map<string, unknown>();
export function removeAlternativeModel(): void { verifiedModels = [defaultModel]; }
export function addSyntheticModels(count: number): void {
  verifiedModels = [...verifiedModels, ...Array.from({ length: count }, (_, index) => ({
    configuredProviderId: "test-entry", sidecarId: "yume-2",
    modelId: `synthetic-${index}`, modelName: `Synthetic ${index}`,
  }))];
}
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
let historyRecords: Record<string, HistorySession> = {};
let historyLoadOverride: ((id: string) => Promise<HistorySession | null>) | null = null;
const archivedHistory = new Set<string>();
const deletedHistory = new Set<string>();
let registeredEntry: UnifiedHistoryRow | null = null;
let sessionCreateRequests = 0;
let agentStartError: string | null = null;
let activeEventSource: { onmessage: ((message: MessageEvent) => void) | null } | null = null;

function installNativeMocks(): void {
  mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
  mock.module("@tauri-apps/api/event", () => ({
    emit: () => Promise.resolve(),
    listen: (name: string, callback: (event: { payload: unknown }) => void) => {
      const callbacks = nativeListeners.get(name) ?? new Set();
      callbacks.add(callback);
      nativeListeners.set(name, callbacks);
      return Promise.resolve(() => callbacks.delete(callback));
    },
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
    const url = new URL(String(input)).pathname;
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
      expect(new URL(url).pathname).toBe("/event");
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
  attachmentPicker = async () => [];
  resourceMetadata.clear();
  resourceBytes.clear();
  messageResources.clear();
  nativeListeners.clear();
  resourcePreparationError = null;
  resourcePreparationPending = null;
  releaseResourcePreparation = null;
  verifiedModels = [defaultModel, alternativeModel];
  modelSelections.clear();
  agentProjection = { active: null, recent: [], artifacts: [] };
  selectedWorkspace = null;
  holdAgentStart = false;
  releaseAgentStart = null;
  historyRecords = {};
  historyLoadOverride = null;
  archivedHistory.clear();
  deletedHistory.clear();
  registeredEntry = null;
  sessionCreateRequests = 0;
  agentStartError = null;
  activeEventSource = null;
  invoke.mockImplementation((command: string, args?: unknown) => {
    switch (command) {
      case "chat_model_resolve":
        {
          const selection = (args as { selection?: { mode?: string; configuredProviderId?: string; sidecarId?: string; modelId?: string } } | undefined)?.selection;
          if (selection?.mode === "inherit") return Promise.resolve(defaultModel);
          const chosen = verifiedModels.find(model => model.configuredProviderId === selection?.configuredProviderId
            && model.sidecarId === selection?.sidecarId && model.modelId === selection?.modelId);
          return chosen ? Promise.resolve(chosen) : Promise.reject(new Error("chat_model_selection_invalid"));
        }
      case "chat_model_catalog":
        return Promise.resolve({ models: verifiedModels, defaultModel });
      case "history_model_selection_get":
        return Promise.resolve(modelSelections.get(historyArgument(args, "key")) ?? { mode: "inherit" });
      case "history_model_selection_set":
        modelSelections.set(historyArgument(args, "key"), (args as { selection?: unknown }).selection);
        return Promise.resolve(undefined);
      case "history_recent_workspaces":
        return Promise.resolve([]);
      case "history_validate_workspace":
        return Promise.resolve(historyArgument(args, "directory"));
      case "history_remember_workspace":
        return Promise.resolve(undefined);
      case "history_catalog_native_key":
        return Promise.resolve(agentHistoryEntry({
          id: "ses_workspace", title: "Workspace task", created: 1, updated: 1,
          messages: [], originRunId: agentRun.runId,
        }).key);
      case "sidecar_base_url":
        return Promise.resolve("http://127.0.0.1:48888");
      case "get_settings":
        return Promise.resolve(SETTINGS);
      case "load_persona":
        return Promise.resolve({ persona: "你是小著。", placeholders: null });
      case "pick_chat_attachment_files":
        return attachmentPicker();
      case "pick_chat_resources":
        return attachmentPicker();
      case "read_chat_resource_attachment":
        return Promise.resolve(resourceBytes.get((args as { resourceId: string }).resourceId));
      case "stage_chat_resource_upload": {
        const request = args as { fileName: string; mime: string; bytes: number[] };
        const id = `uploaded_${resourceMetadata.size + 1}`;
        const kind = request.mime.startsWith("video/") || /\.(mp4|mov|webm|mkv|avi)$/i.test(request.fileName) ? "video" : "audio";
        return Promise.resolve(registerResource({ id, name: request.fileName, mime: request.mime || (kind === "audio" ? "audio/mpeg" : "video/mp4"), kind, size: request.bytes.length, previewUrl: `chat-resource://localhost/${id}` }));
      }
      case "prepare_chat_resources": {
        if (resourcePreparationError) return Promise.reject(new Error(resourcePreparationError));
        const request = args as { messageId: string; resourceIds: readonly string[] };
        const resources = request.resourceIds.map(id => resourceMetadata.get(id)).filter((resource): resource is LocalResource => resource !== undefined);
        messageResources.set(request.messageId, resources);
        return (resourcePreparationPending ?? Promise.resolve()).then(() => ({
          parts: resources.filter(resource => resource.kind === "directory").map(resource => ({ type: "file", mime: "application/x-directory", filename: resource.name, url: `file:///fixture/${resource.name}` })),
          text: resources.length ? `\n\n<yume-local-resources>\n${resources.map(resource => `/fixture/${resource.name}`).join("\n")}\n</yume-local-resources>` : "",
        }));
      }
      case "get_chat_message_resources":
        return Promise.resolve(messageResources.get((args as { messageId: string }).messageId) ?? []);
      case "list_chat_resource_directory":
        return Promise.resolve({ relativePath: "", entries: [{ name: "voice.wav", kind: "audio", size: 12 }], truncated: false });
      case "discard_chat_resources":
        return Promise.resolve();
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
      case "history_register_native_session":
        registeredEntry = nativeHistoryFixture(historyArgument(args, "sessionId"), historyArgument(args, "directory"));
        return Promise.resolve(registeredHistoryFixture(args));
      case "history_catalog_list":
        return Promise.resolve(catalogPageFixture(Object.values(historyRecords).filter(record => !archivedHistory.has(record.id) && !deletedHistory.has(record.id)).map(agentHistoryEntry)));
      case "history_catalog_mutate": {
        const key = historyArgument(args, "key");
        const record = Object.values(historyRecords).find(record => agentHistoryEntry(record).key === key);
        if (!record || typeof args !== "object" || args === null || !("mutation" in args)) throw new Error("catalog mutation missing");
        const mutation = args.mutation;
        if (typeof mutation !== "object" || mutation === null || !("action" in mutation)) throw new Error("catalog action missing");
        if (mutation.action === "archive" && "archived" in mutation && mutation.archived === true) {
          archivedHistory.add(record.id);
          return Promise.resolve(agentHistoryEntry(record));
        }
        if (mutation.action === "delete" && "confirmed" in mutation && mutation.confirmed === true) {
          deletedHistory.add(record.id);
          return Promise.reject(new Error("remote delete unavailable"));
        }
        throw new Error("unexpected catalog mutation");
      }
      case "history_catalog_load": {
        const key = historyArgument(args, "key");
        if (registeredEntry?.key === key) return Promise.resolve({ entry: registeredEntry, messages: [] });
        const record = Object.values(historyRecords).find(record => agentHistoryEntry(record).key === key);
        if (!record || deletedHistory.has(record.id)) throw new Error("history_deleted");
        const loaded = historyLoadOverride ? historyLoadOverride(record.id) : Promise.resolve(record);
        return loaded.then(session => {
          if (!session) throw new Error("catalog entry missing");
          return { entry: agentHistoryEntry(session), messages: session.messages, agentDetails: agentHistoryDetails(session), originRunId: session.originRunId };
        });
      }
      case "history_list":
        return Promise.resolve(Object.values(historyRecords).map((item) => {
          const session = item as { id: string; title: string; created: number; updated: number; messages: readonly object[] };
          return { id: session.id, title: session.title, created: session.created, updated: session.updated, count: session.messages.length };
        }));
      case "history_load": {
        const id = (args as { id?: string } | undefined)?.id ?? "";
        const record = historyRecords[id];
        return historyLoadOverride ? historyLoadOverride(id) : Promise.resolve(record ? { ...record, agentDetails: agentHistoryDetails(record) } : null);
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
export function setHistory(records: Record<string, HistorySession>): void { historyRecords = records; }
export function historyRecord(id: string): HistorySession | undefined { return historyRecords[id]; }
export function setHistoryLoader(loader: ((id: string) => Promise<HistorySession | null>) | null): void { historyLoadOverride = loader; }
export function sessionCreates(): number { return sessionCreateRequests; }
export function sendOrdinaryEvent(data: object): void { activeEventSource?.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) })); }
export function histories(): Record<string, HistorySession> { return historyRecords; }

function agentHistoryEntry(record: HistorySession): UnifiedHistoryRow {
  const native = nativeHistoryFixture(record.id, agentRun.workspacePath, record.title);
  const active = agentHistoryDetails(record).status === "active";
  return { ...native, source: "workbench", ownership: "agent", archived: archivedHistory.has(record.id),
    runtime: active ? "running" : "idle",
    capabilities: { ...native.capabilities, send: false, delete: !active, readOnlyReason: active ? "active_task" : "agent_owned" } };
}
function agentHistoryDetails(record: HistorySession): AgentHistoryDetails {
  if (record.agentDetails) return record.agentDetails;
  return { workspacePath: agentRun.workspacePath, status: agentProjection.active?.sessionId === record.id ? "active" : "completed",
    source: "interactive", availability: agentStartError === "agent_history_workspace_missing" ? "workspace_missing" : "ready" };
}
