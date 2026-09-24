import { invoke } from "@tauri-apps/api/core";
import type { OpenCodeFilePart } from "../chat/attachments";
import { parseSessionMessages } from "./opencodeMessages";
export { OpenCodeWireError } from "./opencodeMessages";

/** Minimal OpenCode server client (v1.17.x HTTP API). */

export interface SessionInfo {
  id: string;
  title: string;
  directory: string;
}

export interface TextPart {
  readonly id: string;
  readonly messageID: string;
  readonly sessionID: string;
  readonly type: "text";
  readonly text: string;
}

export type ToolErrorDetails = {
  readonly name?: string;
  readonly message?: string;
};

export type OpenCodeChronology = {
  readonly created?: number | string;
  readonly updated?: number | string;
  readonly completed?: number | string;
  readonly end?: number | string;
};

type ToolStateMetadata = Readonly<Record<string, unknown>>;

type ToolStateBase = {
  readonly title?: string;
  readonly input?: unknown;
  readonly metadata?: ToolStateMetadata;
};

export type PendingToolState = ToolStateBase & {
  readonly status: "pending";
};

export type RunningToolState = ToolStateBase & {
  readonly status: "running";
};

export type CompletedToolState = ToolStateBase & {
  readonly status: "completed";
  readonly output: unknown;
};

export type ErrorToolState = ToolStateBase & {
  readonly status: "error";
  readonly error?: ToolErrorDetails;
  readonly output?: unknown;
};

export type ToolState =
  | PendingToolState
  | RunningToolState
  | CompletedToolState
  | ErrorToolState;

type ToolPartBase = {
  readonly id: string;
  readonly messageID: string;
  readonly sessionID: string;
  readonly type: "tool";
  readonly callID: string;
  readonly tool: string;
  readonly time?: OpenCodeChronology;
  readonly createdAt?: string;
  readonly updatedAt?: string;
};

export type PendingToolPart = ToolPartBase & {
  readonly state: PendingToolState;
};

export type RunningToolPart = ToolPartBase & {
  readonly state: RunningToolState;
};

export type CompletedToolPart = ToolPartBase & {
  readonly state: CompletedToolState;
};

export type ErrorToolPart = ToolPartBase & {
  readonly state: ErrorToolState;
};

export type ToolPart =
  | PendingToolPart
  | RunningToolPart
  | CompletedToolPart
  | ErrorToolPart;

export type Part = TextPart | ToolPart | { type: string; [k: string]: unknown };

export interface OpenCodeEvent {
  type: string;
  properties?: Record<string, unknown>;
}

export interface OpenCodeMessageInfo {
  readonly id: string;
  readonly sessionID: string;
  readonly role: string;
  readonly parentID?: string;
  readonly finish?: string;
  readonly error?: unknown;
  readonly time?: OpenCodeChronology;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface OpenCodeMessage {
  readonly info: OpenCodeMessageInfo;
  readonly parts: readonly Part[];
}

let baseUrlPromise: Promise<string> | null = null;

export function getBaseUrl(): Promise<string> {
  baseUrlPromise ??= invoke<string>("sidecar_base_url");
  return baseUrlPromise;
}

type SidecarAuth = { username: string; password: string };

let authPromise: Promise<SidecarAuth | null> | null = null;

/** Credentials for the managed sidecar, held in memory only. */
function getAuth(): Promise<SidecarAuth | null> {
  authPromise ??= invoke<SidecarAuth>("sidecar_auth").catch(() => null);
  return authPromise;
}

/** Basic-auth headers for the managed sidecar (empty when unconfigured). */
export async function sidecarAuthHeaders(): Promise<Record<string, string>> {
  return authHeaders();
}

async function authHeaders(): Promise<Record<string, string>> {
  const auth = await getAuth();
  if (!auth?.password) return {};
  return { Authorization: `Basic ${btoa(`${auth.username}:${auth.password}`)}` };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`opencode ${path} -> ${res.status} ${await res.text()}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Wait until the sidecar answers (it may still be booting). */
export async function waitForServer(timeoutMs = 30_000): Promise<void> {
  const base = await getBaseUrl();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/session`, {
        method: "GET",
        headers: await authHeaders(),
      });
      if (res.ok) return;
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("opencode sidecar did not come up in time");
}

export function getToolActivityLabel(part: ToolPart): string {
  return part.state.title || part.tool || "tool";
}

export function isPendingToolPart(part: ToolPart): part is PendingToolPart {
  return part.state.status === "pending";
}

export function isRunningToolPart(part: ToolPart): part is RunningToolPart {
  return part.state.status === "running";
}

export function isCompletedToolPart(part: ToolPart): part is CompletedToolPart {
  return part.state.status === "completed";
}

export function isErrorToolPart(part: ToolPart): part is ErrorToolPart {
  return part.state.status === "error";
}

export function createSession(title: string): Promise<SessionInfo> {
  return api<SessionInfo>("/session", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export async function getSessionMessages(
  sessionID: string,
  directory?: string,
): Promise<readonly OpenCodeMessage[]> {
  const query = new URLSearchParams({ order: "asc" });
  if (directory) query.set("directory", directory);
  const wire = await api<unknown>(
    `/session/${sessionID}/message?${query}`,
    {
      method: "GET",
    },
  );
  return parseSessionMessages(wire);
}

/** Fire-and-forget prompt; results arrive over the SSE event stream. */
export async function promptAsync(
  sessionID: string,
  text: string,
  options?: {
    system?: string;
    model?: { providerID: string; modelID: string };
    attachments?: OpenCodeFilePart[];
    messageID?: string;
    directory?: string;
  },
): Promise<void> {
  const parts = [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...(options?.attachments ?? []),
  ];
  const scope = options?.directory ? `?${new URLSearchParams({ directory: options.directory })}` : "";
  await api<void>(`/session/${sessionID}/prompt_async${scope}`, {
    method: "POST",
    body: JSON.stringify({
      ...(options?.messageID ? { messageID: options.messageID } : {}),
      ...(options?.system ? { system: options.system } : {}),
      ...(options?.model ? { model: options.model } : {}),
      parts,
    }),
  });
}

export type PromptSubmissionState = "confirmed" | "not_found" | "unknown";

export async function confirmPromptSubmission(
  sessionID: string,
  messageID: string,
  directory?: string,
): Promise<PromptSubmissionState> {
  try {
    const messages = await getSessionMessages(sessionID, directory);
    return messages.some((message) => message.info.id === messageID)
      ? "confirmed"
      : "not_found";
  } catch {
    return "unknown";
  }
}

export type SessionAbortErrorCode = "REJECTED" | "STILL_RUNNING" | "UNKNOWN";

export class SessionAbortError extends Error {
  readonly code: SessionAbortErrorCode;

  constructor(code: SessionAbortErrorCode) {
    super(`session abort ${code.toLowerCase()}`);
    this.name = "SessionAbortError";
    this.code = code;
  }
}

export async function abortSession(sessionID: string, directory?: string): Promise<void> {
  try {
    await invoke("chat_abort_session", { sessionId: sessionID, ...(directory ? { directory } : {}) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("agent_abort_unconfirmed")) {
      throw new SessionAbortError("REJECTED");
    }
    if (message.includes("agent_abort_still_running")) {
      throw new SessionAbortError("STILL_RUNNING");
    }
    throw new SessionAbortError("UNKNOWN");
  }
}

/**
 * Subscribe to the global SSE event stream. The wire-level SSE event name is
 * always "message"; the OpenCode event type lives in the JSON payload.
 *
 * Implemented with fetch streaming rather than native EventSource because the
 * managed sidecar requires a Basic Authorization header, which EventSource
 * cannot send. Reconnects with a short backoff until unsubscribed, matching
 * EventSource's auto-reconnect behavior.
 */
export async function subscribeEvents(
  onEvent: (e: OpenCodeEvent) => void,
  directory?: string,
): Promise<() => void> {
  const base = await getBaseUrl();
  const headers = { Accept: "text/event-stream", ...(await authHeaders()) };
  const controller = new AbortController();
  let closed = false;

  const parseChunk = (raw: string) => {
    const data = raw
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    try {
      onEvent(JSON.parse(data) as OpenCodeEvent);
    } catch (error: unknown) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  };

  const run = async () => {
    while (!closed) {
      try {
        const scope = directory ? `?${new URLSearchParams({ directory })}` : "";
        const res = await fetch(`${base}/event${scope}`, {
          headers,
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`event stream ${res.status}`);
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (closed) return;
          buffer += value.replace(/\r\n/g, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            parseChunk(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch (error: unknown) {
        if (closed || controller.signal.aborted) return;
      }
      if (closed || controller.signal.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };
  void run();

  return () => {
    closed = true;
    controller.abort();
  };
}
