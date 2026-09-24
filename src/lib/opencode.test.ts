import { describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  () => Promise.resolve("http://127.0.0.1:48888"),
);

mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));

const {
  abortSession,
  confirmPromptSubmission,
  getSessionMessages,
  getToolActivityLabel,
  isCompletedToolPart,
  isErrorToolPart,
  isPendingToolPart,
  isRunningToolPart,
  subscribeEvents,
} = await import("./opencode");

describe("opencode transport helpers", () => {
  test("confirms a lost prompt response from the native message record", async () => {
    // Given: the transport response was lost after the native user message was stored.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      mock(() => Promise.resolve(Response.json([{ info: {
        id: "msg-user", sessionID: "ses-1", role: "user",
      }, parts: [] }]))),
      { preconnect: originalFetch.preconnect },
    );
    try {
      // When: the caller reconciles the uncertain submission by stable message ID.
      const state = await confirmPromptSubmission("ses-1", "msg-user");
      // Then: the native record, rather than the failed response, confirms delivery.
      expect(state).toBe("confirmed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("keeps prompt submission unknown when the native record cannot be read", async () => {
    // Given: both the prompt response and native record lookup are unavailable.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(mock(() => Promise.reject(new Error("offline"))), {
      preconnect: originalFetch.preconnect,
    });
    try {
      // When / Then: reconciliation does not infer that the prompt was absent.
      await expect(confirmPromptSubmission("ses-1", "msg-user")).resolves.toBe("unknown");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("confirms cancellation only after the native session becomes idle", async () => {
    // Given: the host gate confirms abort, idle state, and interaction cleanup.
    invoke.mockClear();
    invoke.mockImplementation(() => Promise.resolve(undefined));

    try {
      // When: cancellation is requested.
      await abortSession("ses-1");

      // Then: the shared native cancellation gate is the only stop boundary.
      expect(invoke).toHaveBeenCalledWith("chat_abort_session", { sessionId: "ses-1" });
    } finally {
      invoke.mockImplementation(() => Promise.resolve("http://127.0.0.1:48888"));
    }
  });

  test("rejects cancellation while the native session is still running", async () => {
    // Given: the host gate reports that the native session remains busy.
    invoke.mockImplementation(() => Promise.reject(new Error("agent_abort_still_running")));

    try {
      // When / Then: the caller receives a typed, retryable failure.
      await expect(abortSession("ses-1")).rejects.toMatchObject({
        name: "SessionAbortError",
        code: "STILL_RUNNING",
      });
    } finally {
      invoke.mockImplementation(() => Promise.resolve("http://127.0.0.1:48888"));
    }
  });

  test("reports cancellation as unknown when status confirmation is unavailable", async () => {
    // Given: the native host cannot complete status or interaction reconciliation.
    invoke.mockImplementation(() => Promise.reject(new Error("agent_transport_failure")));

    try {
      // When / Then: no successful stop is inferred from the abort response alone.
      await expect(abortSession("ses-1")).rejects.toMatchObject({
        name: "SessionAbortError",
        code: "UNKNOWN",
      });
    } finally {
      invoke.mockImplementation(() => Promise.resolve("http://127.0.0.1:48888"));
    }
  });

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
    const originalFetch = globalThis.fetch;
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

    globalThis.fetch = Object.assign(
      mock((input: unknown) => {
        const url = String(input);
        expect(url).toBe("http://127.0.0.1:48888/event");
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                streamController = controller;
              },
            }),
            { status: 200 },
          ),
        );
      }),
      { preconnect: originalFetch.preconnect },
    );

    try {
      const received: string[] = [];
      const unsubscribe = await subscribeEvents((event) => {
        received.push(event.type);
      });
      const controller = streamController as ReadableStreamDefaultController<Uint8Array> | null;
      if (!controller) throw new Error("event stream was not opened");
      const frame = (payload: string) => new TextEncoder().encode(`data: ${payload}\n\n`);

      controller.enqueue(frame("not json"));
      controller.enqueue(frame(JSON.stringify({ type: "session.idle", properties: {} })));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(received).toEqual(["session.idle"]);

      unsubscribe();
      controller.enqueue(frame(JSON.stringify({ type: "session.idle", properties: {} })));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(received).toEqual(["session.idle"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
