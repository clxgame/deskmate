import { describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  () => Promise.resolve("http://127.0.0.1:48888"),
);

mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));

const {
  getSessionMessages,
  getToolActivityLabel,
  isCompletedToolPart,
  isErrorToolPart,
  isPendingToolPart,
  isRunningToolPart,
  subscribeEvents,
} = await import("./opencode");

describe("opencode transport helpers", () => {
  test("keeps ordinary tool activity labels compatible", () => {
    expect(
      getToolActivityLabel({
        id: "part-1",
        messageID: "msg-1",
        sessionID: "ses-1",
        type: "tool",
        callID: "call-1",
        tool: "bash",
        state: { status: "running", title: "npm test" },
      }),
    ).toBe("npm test");
    expect(
      getToolActivityLabel({
        id: "part-2",
        messageID: "msg-1",
        sessionID: "ses-1",
        type: "tool",
        callID: "call-2",
        tool: "bash",
        state: { status: "pending" },
      }),
    ).toBe("bash");
  });

  test("represents every supported tool state as a typed union", () => {
    const pending = {
      id: "part-pending",
      messageID: "msg-1",
      sessionID: "ses-1",
      type: "tool" as const,
      callID: "call-pending",
      tool: "ccswitch_prepare_opencode_provider",
      state: { status: "pending" as const, input: { providerName: "YUME" } },
    };
    const running = {
      ...pending,
      id: "part-running",
      callID: "call-running",
      state: { status: "running" as const, input: { providerName: "YUME" } },
    };
    const completed = {
      ...pending,
      id: "part-completed",
      callID: "call-completed",
      state: {
        status: "completed" as const,
        input: { providerName: "YUME" },
        output: { version: 1, kind: "opencode_provider_draft" },
        metadata: { elapsedMs: 12 },
      },
    };
    const failed = {
      ...pending,
      id: "part-error",
      callID: "call-error",
      state: {
        status: "error" as const,
        input: { providerName: "YUME" },
        error: { name: "ToolError", message: "failed" },
      },
    };

    expect(isPendingToolPart(pending)).toBe(true);
    expect(isRunningToolPart(running)).toBe(true);
    expect(isCompletedToolPart(completed)).toBe(true);
    expect(isErrorToolPart(failed)).toBe(true);
  });

  test("retrieves session messages for idle reconciliation", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            {
              info: {
                id: "msg-1",
                sessionID: "ses-1",
                role: "assistant",
                parentID: "msg-user",
              },
              parts: [],
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const originalFetch = globalThis.fetch;
    const replacementFetch: typeof fetch = Object.assign(fetchMock, {
      preconnect: originalFetch.preconnect,
    });
    globalThis.fetch = replacementFetch;

    try {
      const messages = await getSessionMessages("ses-1");

      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:48888/session/ses-1/message?order=asc",
        expect.objectContaining({ method: "GET" }),
      );
      expect(messages).toEqual([
        {
          info: {
            id: "msg-1",
            sessionID: "ses-1",
            role: "assistant",
            parentID: "msg-user",
          },
          parts: [],
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("preserves native message and tool identifiers from the wire envelope", async () => {
    const payload = [{
      info: { id: "msg-assistant", sessionID: "ses-1", role: "assistant", parentID: "msg-caller" },
      parts: [{
        id: "part-tool", messageID: "msg-assistant", sessionID: "ses-1", type: "tool",
        callID: "call-tool", tool: "bash", state: { status: "error", output: "SUCCESS text", error: { message: "failed" } },
      }],
    }];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(mock(() => Promise.resolve(Response.json(payload))), { preconnect: originalFetch.preconnect });
    try {
      const [message] = await getSessionMessages("ses-1");
      expect(message?.info).toEqual(payload[0]?.info);
      expect(message?.parts[0]).toEqual(payload[0]?.parts[0]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects malformed message envelopes at the transport boundary", async () => {
    const originalFetch = globalThis.fetch;
    try {
      const malformed = [
        { wrong: "top-level object" },
        [{ info: { id: "msg" }, parts: [] }],
        [{ info: { id: "msg", sessionID: "ses-1", role: "assistant" }, parts: {} }],
        [{ info: { id: "msg", sessionID: "ses-1", role: "assistant" }, parts: [{ id: "part", messageID: "msg", sessionID: "ses-1", type: "tool", callID: "call", tool: "bash", state: { status: "success" } }] }],
      ];
      for (const payload of malformed) {
        globalThis.fetch = Object.assign(mock(() => Promise.resolve(Response.json(payload))), { preconnect: originalFetch.preconnect });
        await expect(getSessionMessages("ses-1")).rejects.toMatchObject({ name: "OpenCodeWireError", code: "INVALID_MESSAGE_ENVELOPE" });
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("keeps aborted snapshots non-terminal when completion is absent", async () => {
    const payload = [{ info: { id: "msg-aborted", sessionID: "ses-1", role: "assistant", parentID: "msg-user", error: { name: "MessageAbortedError" } }, parts: [] }];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(mock(() => Promise.resolve(Response.json(payload))), { preconnect: originalFetch.preconnect });
    try {
      const [message] = await getSessionMessages("ses-1");
      expect(message?.info.error).toEqual({ name: "MessageAbortedError" });
      expect(message?.info.time?.completed).toBeUndefined();
      expect(message?.info.finish).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("skips malformed event frames without stopping later events", async () => {
    const listeners: Array<(message: MessageEvent) => void> = [];
    const closed: boolean[] = [];
    const OriginalEventSource = globalThis.EventSource;

    globalThis.EventSource = class {
      onmessage: ((message: MessageEvent) => void) | null = null;

      constructor(readonly url: string) {
        expect(url).toBe("http://127.0.0.1:48888/event");
        listeners.push((message: MessageEvent) => this.onmessage?.(message));
      }

      close(): void {
        closed.push(true);
      }
    } as typeof EventSource;

    try {
      const received: string[] = [];
      const unsubscribe = await subscribeEvents((event) => {
        received.push(event.type);
      });
      const send = listeners[0];
      if (!send) throw new Error("EventSource listener was not registered");

      send(new MessageEvent("message", { data: "not json" }));
      send(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "session.idle", properties: {} }),
        }),
      );
      unsubscribe();

      expect(received).toEqual(["session.idle"]);
      expect(closed).toEqual([true]);
    } finally {
      globalThis.EventSource = OriginalEventSource;
    }
  });
});
