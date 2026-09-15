import { describe, expect, test } from "bun:test";
import { dict } from "../lib/i18n";
import { updateErrorMessage } from "./updateErrors";

describe("update error messages", () => {
  const t = dict("zh-CN");
  test("distinguishes a missing Mac artifact from network or signature failures", () => {
    expect(updateErrorMessage(t, "platform_not_available")).toBe(t.updatePlatformMissing);
    expect(updateErrorMessage(t, new Error("network"))).toBe(t.updateNetworkError);
    expect(updateErrorMessage(t, "Error: invalid_signature")).toBe(t.updateSignatureInvalid);
    expect(updateErrorMessage(t, "rate_limited")).toBe(t.updateRateLimited);
    expect(updateErrorMessage(t, "manifest_not_found")).toBe(t.updateReleaseMissing);
    expect(updateErrorMessage(t, "invalid_manifest")).toBe(t.updateManifestInvalid);
  });
  test("preserves invalid repository handling and hides unknown internal errors", () => {
    expect(updateErrorMessage(t, "invalid_repo")).toBe(t.updateNeedRepo);
    expect(updateErrorMessage(t, "placeholder")).toBe(t.updateNeedRepo);
    expect(updateErrorMessage(t, { internal: "detail" })).toBe(t.updateError);
  });
});
