import { afterEach, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import { restoreTauriModuleFixture } from "../testing/tauriModuleFixture";

const originalFetch = globalThis.fetch;
const directory = "C:/synthetic project/second";
const invoke = mock(async (command: string): Promise<unknown> =>
  command === "sidecar_base_url" ? "http://127.0.0.1:48888" : undefined,
);
mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
const { abortSession, getSessionMessages, promptAsync, subscribeEvents } = await import("./opencode");
afterEach(() => { globalThis.fetch = originalFetch; invoke.mockClear(); restoreTauriModuleFixture(); });

function captureRequests(response: () => Response) {
  const urls: string[] = [];
  globalThis.fetch = Object.assign(mock(async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return response();
  }), { preconnect: originalFetch.preconnect });
  return urls;
}

test("message reads preserve directory when native IDs collide across projects", async () => {
  // Given: one bare ID can belong to more than one directory.
  const urls = captureRequests(() => Response.json([]));
  // When: the requested conversation is loaded.
  await getSessionMessages("ses-shared", directory);
  // Then: the native request carries the exact directory.
  expect(new URL(urls[0] ?? "").searchParams.get("directory")).toBe(directory);
});

test("native sends preserve the reopened conversation directory", async () => {
  // Given: a reopened conversation lives outside the default project.
  const urls = captureRequests(() => new Response(null, { status: 204 }));
  // When: the existing session receives a prompt.
  await promptAsync("ses-shared", "synthetic prompt", { directory });
  // Then: both session ID and directory remain unchanged.
  const url = new URL(urls[0] ?? "");
  expect(url.pathname).toBe("/session/ses-shared/prompt_async");
  expect(url.searchParams.get("directory")).toBe(directory);
});

test("event subscriptions follow the reopened directory", async () => {
  // Given: the sidecar exposes a project-scoped event stream.
  const urls = captureRequests(() => new Response(new ReadableStream<Uint8Array>()));
  // When: the view subscribes to its conversation's directory.
  const stop = await subscribeEvents(() => {}, directory);
  try {
    // Then: the stream uses that directory instead of the default scope.
    expect(new URL(urls[0] ?? "").searchParams.get("directory")).toBe(directory);
  } finally { stop(); }
});

test("cancellation sends the same directory to the host gate", async () => {
  // Given: cancellation is scoped by both native ID and project.
  mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
  // When: the user stops the reopened session.
  await abortSession("ses-shared", directory);
  // Then: the host receives the composite identity.
  expect(invoke).toHaveBeenCalledWith("chat_abort_session", { sessionId: "ses-shared", directory });
});
