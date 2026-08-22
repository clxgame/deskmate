import { describe, expect, test } from "bun:test";
import {
  personaDisplayName,
  personalizePersonaCopy,
  resolvePersonaId,
  shouldResetSessionForPersona,
} from "./chatPersona";

describe("chat persona selection", () => {
  test("uses the selected persona instead of the default assistant identity", () => {
    expect(resolvePersonaId("xiaozhu")).toBe("xiaozhu");
    expect(resolvePersonaId("pixel-glasses-chibi")).toBe("xiaozhu");
    expect(personaDisplayName("xiaozhu", "zh-CN")).toBe("小著");
    expect(personalizePersonaCopy("跟小碟说点什么吧", "小著")).toBe(
      "跟小著说点什么吧",
    );
  });

  test("starts a fresh chat session when the selected persona changes", () => {
    expect(shouldResetSessionForPersona("feibi", "xiaozhu")).toBe(true);
    expect(shouldResetSessionForPersona("xiaozhu", "pixel-glasses-chibi")).toBe(
      false,
    );
  });
});
