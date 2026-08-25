import { describe, expect, test } from "bun:test";
import { shouldLoadReactDevTools } from "./devtools";

describe("React development tooling", () => {
  test("loads only in development when the opt-out flag is clear", () => {
    expect(shouldLoadReactDevTools(true, undefined)).toBe(true);
    expect(shouldLoadReactDevTools(true, "0")).toBe(true);
    expect(shouldLoadReactDevTools(true, "1")).toBe(false);
    expect(shouldLoadReactDevTools(false, undefined)).toBe(false);
  });
});
