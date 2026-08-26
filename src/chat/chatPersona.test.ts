import { describe, expect, test } from "bun:test";
import {
  XIAOZHU_IDENTITY_REPLY,
  XIAOZHU_NAME_ORIGIN_LINES,
  isXiaozhuIdentityQuestion,
  isXiaozhuNameOriginQuestion,
  personaDisplayName,
  personalizePersonaCopy,
  resolvePersonaId,
  shouldResetSessionForPersona,
  userNameInstruction,
} from "./chatPersona";

describe("chat persona selection", () => {
  test("uses the selected persona instead of the default assistant identity", () => {
    expect(resolvePersonaId("xiaozhu")).toBe("xiaozhu");
    expect(resolvePersonaId("pixel-glasses-chibi")).toBe("xiaozhu");
    expect(personaDisplayName("xiaozhu", "zh-CN")).toBe("小著");
    expect(personalizePersonaCopy("跟小著说点什么吧", "aki 团子")).toBe(
      "跟aki 团子说点什么吧",
    );
  });

  test("starts a fresh chat session when the selected persona changes", () => {
    expect(shouldResetSessionForPersona("feibi", "xiaozhu")).toBe(true);
    expect(shouldResetSessionForPersona("xiaozhu", "pixel-glasses-chibi")).toBe(
      false,
    );
  });

  test("recognizes rewritten 小著 name-origin questions", () => {
    expect(isXiaozhuNameOriginQuestion("为什么你叫小著？")).toBe(true);
    expect(isXiaozhuNameOriginQuestion("为什么是小著？")).toBe(true);
    expect(isXiaozhuNameOriginQuestion("你为什么会叫作小著？")).toBe(true);
    expect(isXiaozhuNameOriginQuestion("叫小著有什么来头")).toBe(true);
    expect(isXiaozhuNameOriginQuestion("小著为什么叫这个名字？")).toBe(true);
    expect(isXiaozhuNameOriginQuestion("你名字为什么是小著？")).toBe(true);
    expect(isXiaozhuNameOriginQuestion("为啥叫小著")).toBe(true);
    expect(isXiaozhuNameOriginQuestion("小著这个名字有什么含义")).toBe(true);
    expect(isXiaozhuNameOriginQuestion("小著啥意思")).toBe(true);
    expect(isXiaozhuNameOriginQuestion("小著什么意思")).toBe(true);
    expect(isXiaozhuNameOriginQuestion("小著有什么含义")).toBe(true);
    expect(isXiaozhuNameOriginQuestion("你叫小著的原因是什么")).toBe(true);
    expect(isXiaozhuNameOriginQuestion("小著这个名字是怎么来的")).toBe(true);
    expect(isXiaozhuNameOriginQuestion("介绍一下小著")).toBe(false);
  });

  test("recognizes identity questions and keeps the requested intro exact", () => {
    expect(isXiaozhuIdentityQuestion("你是谁？")).toBe(true);
    expect(isXiaozhuIdentityQuestion("你是谁啊")).toBe(true);
    expect(isXiaozhuIdentityQuestion("你是谁呢")).toBe(true);
    expect(isXiaozhuIdentityQuestion("你是什么人")).toBe(true);
    expect(isXiaozhuIdentityQuestion("你叫什么名字")).toBe(true);
    expect(isXiaozhuIdentityQuestion("你叫什么名字呀")).toBe(true);
    expect(isXiaozhuIdentityQuestion("介绍一下你自己")).toBe(true);
    expect(isXiaozhuIdentityQuestion("自我介绍")).toBe(true);
    expect(isXiaozhuIdentityQuestion("可以介绍一下你自己吗")).toBe(true);
    expect(isXiaozhuIdentityQuestion("我想知道你是谁")).toBe(true);
    expect(isXiaozhuIdentityQuestion("为什么是小著？")).toBe(false);
    expect(XIAOZHU_IDENTITY_REPLY).toBe(
      "你好！我是当代游戏电子游戏音乐先锋——小著。",
    );
  });

  test("keeps the fixed name-origin reply in four paragraphs", () => {
    expect(XIAOZHU_NAME_ORIGIN_LINES).toEqual([
      "因为本人：系著名当代游戏电子游戏音乐先锋级选手",
      "霄·太郎是也~",
      "当然..",
      "您叫我小著就行..嘿嘿..",
    ]);
  });

  test("uses a nonblank nickname over the persona default and falls back when cleared", () => {
    const customized = userNameInstruction("  指挥官  ");

    expect(customized).toContain("指挥官");
    expect(customized).toContain("最高优先级");
    expect(customized).toContain("覆盖角色设定中的默认称呼");
    expect(userNameInstruction(" \n ")).toBeUndefined();
  });
});
