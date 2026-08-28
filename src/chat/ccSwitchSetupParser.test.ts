import { describe, expect, test } from "bun:test";
import ccSwitchProviderDraftTool from "../../src-tauri/resources/opencode-tools/ccswitch_prepare_opencode_provider";
import type { OpenCodeMessage, ToolPart } from "../lib/opencode";
import {
  createCcSwitchToolResultTracker,
  recoverCcSwitchDraftsFromMessages,
  recoverCcSwitchToolResultsFromMessages,
} from "./ccSwitchSetup";
import {
  CCSWITCH_PREPARE_OPENCODE_PROVIDER_TOOL,
  parseCcSwitchToolResult,
  toCcSwitchChatSurfaceResult,
} from "./ccSwitchSetupParser";

const VALID_DRAFT_OUTPUT = { version: 1, kind: "opencode_provider_draft" } as const;
const STALE_SECRET_OUTPUT = {
  ...VALID_DRAFT_OUTPUT,
  providerName: "credential-marker",
} as const;

function completedTool(output: unknown, callID = "call-1"): ToolPart {
  return {
    id: `part-${callID}`,
    messageID: "msg-1",
    sessionID: "ses-1",
    type: "tool",
    callID,
    tool: CCSWITCH_PREPARE_OPENCODE_PROVIDER_TOOL,
    state: {
      status: "completed",
      input: { providerName: "YUME" },
      output,
    },
  };
}

function assistantMessage(
  parts: readonly ToolPart[],
  id = "msg-1",
  created?: number,
): OpenCodeMessage {
  return {
    id,
    sessionID: "ses-1",
    role: "assistant",
    parts,
    time: created === undefined ? undefined : { created },
  };
}

describe("CC Switch setup tool parser", () => {
  test("accepts the exact output emitted by the shipped provider-draft tool", async () => {
    const output = await ccSwitchProviderDraftTool.execute({
      providerName: "Local proxy",
      baseUrl: "https://api.example.test/v1",
      modelHint: "gpt-test",
    });

    expect(parseCcSwitchToolResult(completedTool(output))).toEqual({
      kind: "draft",
      draft: {
        callID: "call-1",
        providerName: "Local proxy",
        baseUrl: "https://api.example.test/v1",
        modelHint: "gpt-test",
      },
    });
  });

  test("returns ordinary-tool fallback for unrelated tools", () => {
    const tracker = createCcSwitchToolResultTracker();
    const result = tracker.acceptToolPart({
      id: "part-ordinary",
      messageID: "msg-1",
      sessionID: "ses-1",
      type: "tool",
      callID: "call-ordinary",
      tool: "bash",
      state: { status: "running", title: "npm test" },
    });

    expect(result).toEqual({ kind: "ordinary_tool", label: "npm test" });
  });

  test("parses a completed provider draft without raw envelope metadata", () => {
    const result = parseCcSwitchToolResult(
      completedTool({
        version: 1,
        kind: "opencode_provider_draft",
        providerName: "Local proxy",
        baseUrl: "https://api.example.test/v1",
        modelHint: "gpt-test",
      }),
    );

    expect(result).toEqual({
      kind: "draft",
      draft: {
        callID: "call-1",
        providerName: "Local proxy",
        baseUrl: "https://api.example.test/v1",
        modelHint: "gpt-test",
      },
    });
    expect(JSON.stringify(result)).not.toContain("version");
  });

  test("projects only sanitized signals to render and history consumers", () => {
    const draftCanary = `Provider-${crypto.randomUUID().replaceAll("-", "")}`;
    const parsed = parseCcSwitchToolResult(
      completedTool({
        version: 1,
        kind: "opencode_provider_draft",
        providerName: draftCanary,
        baseUrl: "https://api.example.test/v1",
        modelHint: "gpt-test",
      }),
    );

    const surface = toCcSwitchChatSurfaceResult(parsed);
    const serializedSurface = JSON.stringify(surface);

    expect(surface).toEqual({ kind: "draft_ready" });
    expect(serializedSurface).not.toContain(draftCanary);
    expect(serializedSurface).not.toContain("opencode_provider_draft");
    expect(serializedSurface).not.toContain("https://api.example.test/v1");
    expect(serializedSurface).not.toContain("gpt-test");
  });

  test("ignores stale failed snapshot results after a later successful draft", () => {
    const tracker = createCcSwitchToolResultTracker();
    const first = tracker.acceptToolPart(completedTool(VALID_DRAFT_OUTPUT));
    const second = tracker.acceptToolPart(completedTool(VALID_DRAFT_OUTPUT));
    const forwardSnapshot = recoverCcSwitchToolResultsFromMessages(
      [
        assistantMessage([
          completedTool(STALE_SECRET_OUTPUT, "call-stale"),
          completedTool(VALID_DRAFT_OUTPUT, "call-1"),
        ]),
      ],
      tracker,
    );
    const reverseSnapshot = recoverCcSwitchToolResultsFromMessages(
      [
        assistantMessage([
          completedTool(VALID_DRAFT_OUTPUT, "call-1"),
          completedTool(STALE_SECRET_OUTPUT, "call-stale"),
        ]),
      ],
      tracker,
    );

    expect(first.kind).toBe("draft");
    expect(second).toEqual({ kind: "ignored" });
    expect(forwardSnapshot).toEqual([]);
    expect(reverseSnapshot).toEqual([]);
    expect(JSON.stringify([forwardSnapshot, reverseSnapshot])).not.toContain(
      "credential-marker",
    );
  });

  test("uses message chronology when terminal snapshots arrive newest-first", () => {
    const tracker = createCcSwitchToolResultTracker();
    const results = recoverCcSwitchToolResultsFromMessages(
      [
        assistantMessage(
          [
            completedTool(
              { ...VALID_DRAFT_OUTPUT, providerName: "New Proxy" },
              "call-new",
            ),
          ],
          "msg-new",
          2,
        ),
        assistantMessage(
          [completedTool(STALE_SECRET_OUTPUT, "call-old")],
          "msg-old",
          1,
        ),
      ],
      tracker,
    );

    expect(results).toEqual([
      {
        kind: "draft",
        draft: {
          callID: "call-new",
          providerName: "New Proxy",
          baseUrl: undefined,
          modelHint: undefined,
        },
      },
    ]);
    expect(JSON.stringify(results)).not.toContain("credential-marker");
  });

  test("does not accept user-message echoes as tool results", () => {
    const tracker = createCcSwitchToolResultTracker();
    const result = tracker.acceptToolPart(
      completedTool(VALID_DRAFT_OUTPUT),
      { role: "user" },
    );

    expect(result).toEqual({ kind: "ignored" });
  });

  test("maps exact-tool errors to a non-secret notice", () => {
    const result = parseCcSwitchToolResult({
      ...completedTool(VALID_DRAFT_OUTPUT),
      state: {
        status: "error",
        input: { providerName: "YUME" },
        error: { name: "ToolError", message: "credential-marker failed" },
      },
    });

    expect(result).toEqual({ kind: "notice", reason: "tool_error" });
    expect(JSON.stringify(result)).not.toContain("credential-marker");
  });

  test("recovers one completed draft from assistant session snapshots", () => {
    const tracker = createCcSwitchToolResultTracker();
    const messages: readonly OpenCodeMessage[] = [
      assistantMessage([
        completedTool({
          ...VALID_DRAFT_OUTPUT,
          providerName: "YUME",
        }),
      ]),
      {
        ...assistantMessage([
          completedTool(VALID_DRAFT_OUTPUT),
        ]),
        id: "msg-2",
        role: "user",
      },
    ];

    const results = recoverCcSwitchDraftsFromMessages(messages, tracker);

    expect(results).toEqual([
      {
        kind: "draft",
        draft: {
          callID: "call-1",
          providerName: "YUME",
          baseUrl: undefined,
          modelHint: undefined,
        },
      },
    ]);
  });

  test("recovers malformed snapshot notices without raw value echo", () => {
    const tracker = createCcSwitchToolResultTracker();
    const messages: readonly OpenCodeMessage[] = [
      assistantMessage([completedTool(STALE_SECRET_OUTPUT)]),
    ];

    const results = recoverCcSwitchToolResultsFromMessages(messages, tracker);

    expect(results).toEqual([{ kind: "notice", reason: "secret_field" }]);
    expect(JSON.stringify(results)).not.toContain("credential-marker");
  });
});
