import { describe, expect, test } from "bun:test";
import { localWorklogDate, newUserMessageId, verifyWorklogReceipt, worklogRequestId } from "./worklogActions";

describe("work journal chat trust boundary", () => {
  const id = "49c78a08-fc25-43cb-9e22-eef164ef5457";
  test("only a host lookup can substantiate a tool receipt", async () => {
    expect(worklogRequestId(JSON.stringify({ requestId: id, result: { receipt: { status: "committed" } } }))).toBe(id);
    expect(await verifyWorklogReceipt(id, async () => null)).toBeNull();
    expect(await verifyWorklogReceipt(id, async () => ({ operationId: "other", entityKind: "entry", entityId: "fake", revision: 1, businessDate: null, status: "committed" }))).toBeNull();
  });
  test("malformed output and prose do not advertise a save", () => {
    expect(worklogRequestId("已保存")).toBeNull();
    expect(worklogRequestId({ requestId: "../../secret" })).toBeNull();
    expect(worklogRequestId({ receipt: { operationId: id } })).toBeNull();
  });
  test("message identities match the real sidecar caller ID contract", () => {
    expect(newUserMessageId()).toMatch(/^msg_[0-9a-f]{32}$/);
  });
  test("business dates use the received local calendar day", () => {
    expect(localWorklogDate(new Date(2026, 8, 8, 23, 59))).toBe("2026-09-08");
  });
});
