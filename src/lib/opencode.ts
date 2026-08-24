import { invoke } from "@tauri-apps/api/core";
import type { OpenCodeFilePart } from "../chat/attachments";

/** Minimal OpenCode server client (v1.17.x HTTP API). */

export interface SessionInfo {
  id: string;
  title: string;
  directory: string;
}

export interface TextPart {
  id: string;
  messageID: string;
  sessionID: string;
  type: "text";
  text: string;
}

export interface ToolPart {
  id: string;
  messageID: string;
  sessionID: string;
  type: "tool";
  callID: string;
  tool: string;
  state: { status: string; title?: string };
}

export type Part = TextPart | ToolPart | { type: string; [k: string]: unknown };

export interface OpenCodeEvent {
  type: string;
  properties?: Record<string, unknown>;
}

let baseUrlPromise: Promise<string> | null = null;

export function getBaseUrl(): Promise<string> {
  baseUrlPromise ??= invoke<string>("sidecar_base_url");
  return baseUrlPromise;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
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
      const res = await fetch(`${base}/session`, { method: "GET" });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("opencode sidecar did not come up in time");
}

export function createSession(title: string): Promise<SessionInfo> {
  return api<SessionInfo>("/session", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

/** Fire-and-forget prompt; results arrive over the SSE event stream. */
export async function promptAsync(
  sessionID: string,
  text: string,
  options?: {
    system?: string;
    model?: { providerID: string; modelID: string };
    attachments?: OpenCodeFilePart[];
  },
): Promise<void> {
  const parts = [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...(options?.attachments ?? []),
  ];
  await api<void>(`/session/${sessionID}/prompt_async`, {
    method: "POST",
    body: JSON.stringify({
      ...(options?.system ? { system: options.system } : {}),
      ...(options?.model ? { model: options.model } : {}),
      parts,
    }),
  });
}

export async function abortSession(sessionID: string): Promise<void> {
  await api<boolean>(`/session/${sessionID}/abort`, { method: "POST" });
}

/**
 * Subscribe to the global SSE event stream. The wire-level SSE event name is
 * always "message"; the OpenCode event type lives in the JSON payload.
 */
export async function subscribeEvents(
  onEvent: (e: OpenCodeEvent) => void,
): Promise<() => void> {
  const base = await getBaseUrl();
  const source = new EventSource(`${base}/event`);
  source.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as OpenCodeEvent);
    } catch {
      /* malformed frame; skip */
    }
  };
  return () => source.close();
}
