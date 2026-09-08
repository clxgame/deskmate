import { describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import type { OperationReceipt, RecordEntry } from "./worklog";
const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(() => Promise.resolve(undefined));
mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
const { asWorklogError, WORKLOG_CHANGED_EVENT, recordEntry, updateEntry } = await import("./worklog");

describe("worklog IPC contract", () => {
  test("preserves typed post-commit receipts including deleted operations", () => {
    const receipt: OperationReceipt = JSON.parse('{"operationId":"request","entityKind":"entry","entityId":"entry","revision":2,"businessDate":"2026-09-07","status":"deleted"}');
    expect(receipt.status).toBe("deleted");
    expect(receipt.revision).toBe(2);
    expect(receipt.businessDate).toBe("2026-09-07");
  });
  test("date and provenance stay explicit across JSON serialization", () => {
    const request: RecordEntry = { requestId: "request", businessDate: "2026-09-07", project: null, originalText: "Completed checks", text: "Completed checks", status: "done", sourceSessionId: "session", sourceMessageId: "message" };
    expect(JSON.parse(JSON.stringify(request))).toEqual(request);
  });
  test("reports conflict and secret rejections without raw content", () => {
    expect(asWorklogError({ code: "CONFLICT", message: "refresh" })).toEqual({ code: "CONFLICT", message: "refresh" });
    expect(asWorklogError({ code: "SECRET_REJECTED", message: "Credential-like content cannot be stored" }).code).toBe("SECRET_REJECTED");
    expect(asWorklogError(new Error("raw secret must not escape"))).toEqual({ code: "STORAGE_UNAVAILABLE", message: "Work journal is unavailable" });
  });
  test("uses a content-free change signal", () => {
    expect(WORKLOG_CHANGED_EVENT).toBe("deskmate://worklog-changed");
  });
});

test("typed wrapper forwards request identity and expected revision without modification", async () => {
  invoke.mockReset();
  const receipt: OperationReceipt = { operationId: "same-request", entityKind: "entry", entityId: "saved-entry", revision: 1, businessDate: "2026-09-07", status: "committed" };
  invoke.mockImplementation(() => Promise.resolve(receipt));
  const request: RecordEntry = { requestId: "same-request", businessDate: "2026-09-07", project: null, originalText: "Checked release", text: "Checked release", status: "done", sourceSessionId: null, sourceMessageId: null };
  expect(await recordEntry(request)).toEqual(receipt);
  expect(invoke).toHaveBeenCalledWith("worklog_record", { request });
  const update = { requestId: "update-request", id: "saved-entry", expectedRevision: 1, businessDate: "2026-09-07", project: null, text: "Updated checks", status: "done" } satisfies import("./worklog").UpdateEntry;
  await updateEntry(update);
  expect(invoke).toHaveBeenCalledWith("worklog_update", { request: update });
  expect(invoke).toHaveBeenCalledTimes(2);
});
