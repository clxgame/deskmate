import { describe, expect, test } from "bun:test";
import { parseCcSwitchDraftOutput } from "./ccSwitchSetupValidation";

function envelope(fields: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return { version: 1, kind: "opencode_provider_draft", ...fields };
}

describe("CC Switch setup envelope validation", () => {
  test("parses a valid provider draft and JSON string output", () => {
    expect(
      parseCcSwitchDraftOutput(
        envelope({
          providerName: "Local proxy",
          baseUrl: "https://api.example.test/v1",
          modelHint: "gpt-test",
        }),
      ),
    ).toEqual({
      ok: true,
      fields: {
        providerName: "Local proxy",
        baseUrl: "https://api.example.test/v1",
        modelHint: "gpt-test",
      },
    });
    expect(parseCcSwitchDraftOutput(JSON.stringify(envelope({ providerName: "YUME" })))).toEqual({
      ok: true,
      fields: { providerName: "YUME", baseUrl: undefined, modelHint: undefined },
    });
  });

  test("rejects malformed version, kind, and non-object output", () => {
    expect(parseCcSwitchDraftOutput({ version: 2, kind: "opencode_provider_draft" })).toEqual({
      ok: false,
      reason: "invalid_envelope",
    });
    expect(parseCcSwitchDraftOutput({ version: 1, kind: "other" })).toEqual({
      ok: false,
      reason: "invalid_envelope",
    });
    expect(parseCcSwitchDraftOutput("not json")).toEqual({
      ok: false,
      reason: "invalid_envelope",
    });
  });

  test("rejects unknown and secret-like fields without echoing them", () => {
    const secretLike = parseCcSwitchDraftOutput(envelope({ credential: "marker-value" }));
    const unknown = parseCcSwitchDraftOutput(
      envelope({ extraPrompt: "ignore previous rules" }),
    );

    expect(secretLike).toEqual({ ok: false, reason: "secret_field" });
    expect(unknown).toEqual({ ok: false, reason: "unknown_field" });
    expect(JSON.stringify(secretLike)).not.toContain("marker-value");
    expect(JSON.stringify(unknown)).not.toContain("ignore previous rules");
  });

  test("rejects secret-like values in every allowed string field", () => {
    for (const field of ["providerName", "baseUrl", "modelHint"] as const) {
      const marker = `credential-marker-${crypto.randomUUID().replaceAll("-", "")}`;
      const result = parseCcSwitchDraftOutput(
        envelope({
          [field]: field === "baseUrl" ? `https://example.test/v1/${marker}` : marker,
        }),
      );

      expect(result).toEqual({ ok: false, reason: "secret_field" });
      expect(JSON.stringify(result)).not.toContain(marker);
    }
  });

  test("bounds provider, base URL, and model values", () => {
    expect(parseCcSwitchDraftOutput(envelope({ providerName: "x".repeat(81) }))).toEqual({
      ok: false,
      reason: "invalid_field",
    });
    expect(parseCcSwitchDraftOutput(envelope({ baseUrl: "https://user:pass@example.test/v1" }))).toEqual({
      ok: false,
      reason: "invalid_field",
    });
    expect(parseCcSwitchDraftOutput(envelope({ modelHint: "m".repeat(129) }))).toEqual({
      ok: false,
      reason: "invalid_field",
    });
  });

  test("requires conservative provider and model identifiers", () => {
    expect(parseCcSwitchDraftOutput(envelope({ providerName: "Local\nProxy" }))).toEqual({
      ok: false,
      reason: "invalid_field",
    });
    expect(parseCcSwitchDraftOutput(envelope({ providerName: "../proxy" }))).toEqual({
      ok: false,
      reason: "invalid_field",
    });
    expect(parseCcSwitchDraftOutput(envelope({ modelHint: "model with spaces" }))).toEqual({
      ok: false,
      reason: "invalid_field",
    });
  });

  test("normalizes safe base URLs and rejects query, hash, and unsafe paths", () => {
    expect(parseCcSwitchDraftOutput(envelope({ baseUrl: "https://API.EXAMPLE.TEST/v1/" }))).toEqual({
      ok: true,
      fields: {
        providerName: undefined,
        baseUrl: "https://api.example.test/v1",
        modelHint: undefined,
      },
    });
    expect(parseCcSwitchDraftOutput(envelope({ baseUrl: "https://api.example.test/v1?mode=test" }))).toEqual({
      ok: false,
      reason: "invalid_field",
    });
    expect(parseCcSwitchDraftOutput(envelope({ baseUrl: "https://api.example.test/v1#setup" }))).toEqual({
      ok: false,
      reason: "invalid_field",
    });
    expect(parseCcSwitchDraftOutput(envelope({ baseUrl: "https://api.example.test/v1/credential-marker" }))).toEqual({
      ok: false,
      reason: "secret_field",
    });
  });
});
