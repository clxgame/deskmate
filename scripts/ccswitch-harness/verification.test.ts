import { describe, expect, test } from "bun:test";
import { CCSWITCH_TOOL_ID, assertConfig, assertHealth, assertToolIds } from "./permissions";
import { malformedModeFailure } from "../verify-ccswitch-tool";
import { assertCanaryAbsent, assertMockObservation, assertSameCompletedTool, expectCompletedTool } from "./session";
import { waitForHealth } from "./transport";
import { HarnessError, type CompletedToolEvidence, type ProviderDraft } from "./types";

const expectedDraft: ProviderDraft = {
  version: 1,
  kind: "opencode_provider_draft",
  providerName: "Todo8 Local",
  baseUrl: "https://todo8.invalid/v1",
  modelHint: "model-a",
};

function completedTool(input: {
  readonly sessionID?: string;
  readonly messageID?: string;
  readonly partID?: string;
  readonly callID?: string;
  readonly tool?: string;
  readonly draft?: ProviderDraft;
} = {}): CompletedToolEvidence {
  return {
    sessionID: input.sessionID ?? "ses_expected",
    messageID: input.messageID ?? "msg_expected",
    partID: input.partID ?? "prt_expected",
    callID: input.callID ?? "call_expected",
    tool: input.tool ?? CCSWITCH_TOOL_ID,
    draft: input.draft ?? expectedDraft,
  };
}

function completedEvent(input: Parameters<typeof completedTool>[0] = {}): unknown {
  const tool = completedTool(input);
  return {
    type: "tool",
    tool: tool.tool,
    id: tool.partID,
    messageID: tool.messageID,
    sessionID: tool.sessionID,
    callID: tool.callID,
    state: { status: "completed", output: JSON.stringify(tool.draft) },
  };
}

describe("CC Switch OpenCode verifier fail-closed checks", () => {
  test("fails when the dedicated tool is missing from discovery", () => {
    expect(() => assertToolIds(["bash", "edit"])).toThrow(`${CCSWITCH_TOOL_ID} is missing`);
  });

  test("fails when the pinned OpenCode version is not exact", () => {
    expect(() => assertHealth({ healthy: true, version: "1.18.22" })).toThrow("unexpected health");
  });

  test("fails when the permission policy is permissive", () => {
    expect(() =>
      assertConfig({
        permission: {
          "*": "allow",
          [CCSWITCH_TOOL_ID]: "allow",
          bash: "allow",
        },
      }),
    ).toThrow("permission.* must deny");
  });

  test("fails when a completed draft tool output is malformed", () => {
    expect(() =>
      expectCompletedTool(
        {
          type: "tool",
          tool: CCSWITCH_TOOL_ID,
          id: "prt_malformed",
          messageID: "msg_malformed",
          sessionID: "ses_malformed",
          callID: "call_malformed",
          state: { status: "completed", output: "{not-json" },
        },
        "malformed fixture",
      ),
    ).toThrow();
  });

  test("fails when multiple completed draft tool calls match the same session", () => {
    expect(() =>
      expectCompletedTool([completedEvent(), completedEvent({ callID: "call_duplicate" })], "SSE stream", {
        sessionID: "ses_expected",
        draft: expectedDraft,
      }),
    ).toThrow(`SSE stream contained 2 completed ${CCSWITCH_TOOL_ID} tool parts`);
  });

  test("fails when a completed draft belongs to the wrong session", () => {
    expect(() =>
      expectCompletedTool(completedEvent({ sessionID: "ses_other" }), "SSE event", {
        sessionID: "ses_expected",
        draft: expectedDraft,
      }),
    ).toThrow(`SSE event did not contain a completed ${CCSWITCH_TOOL_ID} tool part`);
  });

  test("fails when the completed draft is missing a provider field", () => {
    const missingFieldDraft: ProviderDraft = {
      version: 1,
      kind: "opencode_provider_draft",
      providerName: "Todo8 Local",
      baseUrl: "https://todo8.invalid/v1",
    };
    expect(() =>
      expectCompletedTool(completedEvent({ draft: missingFieldDraft }), "session snapshot", {
        sessionID: "ses_expected",
        draft: expectedDraft,
      }),
    ).toThrow(`session snapshot did not contain a completed ${CCSWITCH_TOOL_ID} tool part`);
  });

  test("fails when SSE and snapshot identities differ", () => {
    expect(() =>
      assertSameCompletedTool(completedTool(), completedTool({ messageID: "msg_other" })),
    ).toThrow("SSE and snapshot message IDs did not match");
  });

  test("accepts exactly one completed draft with matching full identity", () => {
    expect(
      expectCompletedTool(completedEvent(), "session snapshot", {
        sessionID: "ses_expected",
        draft: expectedDraft,
      }),
    ).toEqual(completedTool());
    expect(() => assertSameCompletedTool(completedTool(), completedTool())).not.toThrow();
  });

  test("fails when startup exits before health is available", async () => {
    await expect(
      waitForHealth("http://127.0.0.1:1", () => ({
        exit: "code=1 signal=null",
        output: "startup failed",
      })),
    ).rejects.toThrow("OpenCode exited before health");
  });

  test("does not classify startup failure as an expected malformed fixture result", () => {
    const failure = malformedModeFailure(new HarnessError("OpenCode exited before health", "scenario_startup_failed"));
    expect(failure.message).toBe("OpenCode exited before health");
    if (failure instanceof HarnessError) {
      expect(failure.code).toBe("scenario_startup_failed");
    }
  });

  test("fails when runtime canary appears in evidence or provider traffic", () => {
    expect(() => assertCanaryAbsent({ transcript: "abc runtime-canary xyz" }, "runtime-canary", "fixture")).toThrow(
      "fixture leaked the runtime canary",
    );
  });

  test("fails when the mock does not observe the dedicated round trip", () => {
    expect(() =>
      assertMockObservation({
        requestCount: 1,
        sawDedicatedTool: true,
        sawToolResultRoundTrip: false,
        dangerousToolExposureCount: 0,
      }),
    ).toThrow("both tool-call and tool-result turns");
  });
});
