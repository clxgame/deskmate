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
              id: "msg-1",
              sessionID: "ses-1",
              role: "assistant",
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
        "http://127.0.0.1:48888/session/ses-1/message?order=asc&limit=200",
        expect.objectContaining({ method: "GET" }),
      );
      expect(messages).toEqual([
        { id: "msg-1", sessionID: "ses-1", role: "assistant", parts: [] },
      ]);
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
