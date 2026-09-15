import { expect, test } from "bun:test";
import { buildCurrentInformationInstruction } from "./currentInformation";

test("current information guidance carries local date and freshness rules", () => {
  const instruction = buildCurrentInformationInstruction(
    new Date("2026-09-15T04:30:00+08:00"),
    "Asia/Shanghai",
  );

  expect(instruction).toContain("当前真实本地日期: 2026-09-15");
  expect(instruction).toContain("时区: Asia/Shanghai");
  expect(instruction).toContain("websearch");
  expect(instruction).toContain("webfetch");
  expect(instruction).toContain("公开 API 型号、产品名称、平台别名");
  expect(instruction).toContain("未找到可靠资料");
  expect(instruction).toContain("查询失败");
});
