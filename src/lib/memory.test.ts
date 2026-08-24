import { describe, expect, test } from "bun:test";
import {
  asMemoryError,
  MEMORY_CHANGED_EVENT,
  MEMORY_ERROR_CODES,
  parseMemoryChange,
  type MemoryChange,
  type MemoryRecord,
} from "./memory";

/**
 * Contract tests for the Rust<->TypeScript memory boundary. The Rust fixtures
 * below are the exact serde output asserted in
 * `src-tauri/src/memory/domain.rs` and `error.rs`.
 */

describe("memory error envelopes", () => {
  test("narrows a Rust error envelope into a typed code", () => {
    const rustError = { code: "SECRET_REJECTED", message: "no detail" };
    expect(asMemoryError(rustError)).toEqual({
      code: "SECRET_REJECTED",
      message: "no detail",
    });
  });

  test("maps an unrecognized rejection to a recoverable storage code", () => {
    expect(asMemoryError(new Error("ipc died")).code).toBe(
      "STORAGE_UNAVAILABLE",
    );
    expect(asMemoryError({ code: "TEAPOT" }).code).toBe("STORAGE_UNAVAILABLE");
    expect(asMemoryError("plain string").code).toBe("STORAGE_UNAVAILABLE");
  });

  test("covers every code the Rust layer can return", () => {
    expect([...MEMORY_ERROR_CODES]).toEqual([
      "MEMORY_DISABLED",
      "VALIDATION_FAILED",
      "SENSITIVE_CONFIRMATION_REQUIRED",
      "SECRET_REJECTED",
      "CONFLICT",
      "NOT_FOUND",
      "MIGRATION_FAILED",
      "STORAGE_UNAVAILABLE",
      "EXPORT_FAILED",
    ]);
  });
});

describe("memory change events", () => {
  test("uses the app's event namespace", () => {
    expect(MEMORY_CHANGED_EVENT).toBe("deskmate://memory-changed");
  });

  test("parses the Rust payload shape", () => {
    const payload = {
      version: 1,
      action: "created",
      memoryId: "m1",
      scope: "persona",
      personaId: "aimisi",
      revision: 1,
    };
    const expected: MemoryChange = {
      version: 1,
      action: "created",
      memoryId: "m1",
      scope: "persona",
      personaId: "aimisi",
      revision: 1,
    };
    expect(parseMemoryChange(payload)).toEqual(expected);
  });

  test("accepts a clear event that names no single memory", () => {
    const change = parseMemoryChange({
      version: 1,
      action: "cleared",
      memoryId: null,
      scope: "persona",
      personaId: "aimisi",
      revision: null,
    });
    expect(change?.action).toBe("cleared");
    expect(change?.memoryId).toBeNull();
  });

  test("rejects malformed, unknown, and future payloads", () => {
    expect(parseMemoryChange(null)).toBeNull();
    expect(parseMemoryChange("created")).toBeNull();
    expect(parseMemoryChange({ version: 1 })).toBeNull();
    expect(
      parseMemoryChange({ version: 1, action: "exfiltrated" }),
    ).toBeNull();
    // A newer window's payload must be ignored, not half-read.
    expect(parseMemoryChange({ version: 2, action: "created" })).toBeNull();
  });

  test("drops unexpected extra fields instead of forwarding them", () => {
    const change = parseMemoryChange({
      version: 1,
      action: "created",
      memoryId: "m1",
      scope: "global",
      personaId: null,
      revision: 1,
      content: "叫我小林",
    });
    expect(change).not.toBeNull();
    expect(Object.keys(change ?? {}).sort()).toEqual([
      "action",
      "memoryId",
      "personaId",
      "revision",
      "scope",
      "version",
    ]);
  });
});

describe("memory record shape", () => {
  test("accepts the flattened Rust record without casting", () => {
    // Byte-for-byte the serde output of `MemoryRecord`.
    const fromRust = {
      id: "m1",
      scope: "global",
      personaId: null,
      type: "identity",
      memoryKey: "identity.preferred_name",
      content: "叫我小林",
      status: "active",
      confidence: 1,
      importance: 3,
      sensitivity: "normal",
      sourceKind: "explicit",
      validFrom: "2026-01-01T00:00:00Z",
      expiresAt: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      revision: 1,
      supersedesId: null,
      sources: [
        {
          conversationId: "ses_1",
          messageId: "msg_1",
          sourceKind: "explicit",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
      linkedTaskIds: [],
    } satisfies MemoryRecord;

    expect(fromRust.status).toBe("active");
    expect(fromRust.sources[0].conversationId).toBe("ses_1");
  });
});
