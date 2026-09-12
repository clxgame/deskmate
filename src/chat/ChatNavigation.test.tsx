import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { ChatNavigation, conversationTurns } from "./ChatNavigation";

afterEach(cleanup);

describe("conversation navigation", () => {
  test("groups replies under user turns and excludes artifact/tool-only rows", () => {
    expect(conversationTurns([
      { id: "intro", role: "assistant", text: "Welcome" },
      { id: "u1", role: "user", text: "First question" },
      { id: "a1", role: "assistant", text: "**First** answer" },
      { id: "file", role: "artifact" },
      { id: "a2", role: "assistant", text: "More detail" },
      { id: "u2", role: "user", text: "" },
    ])).toEqual([
      { id: "u1", title: "First question", summary: "First answer More detail" },
      { id: "u2", title: "", summary: "" },
    ]);
  });

  test("previews on focus, dismisses with Escape and jumps only on activation", () => {
    const list = document.createElement("div");
    const timeline = document.createElement("div");
    timeline.append(list);
    const target = document.createElement("div");
    target.dataset.messageId = "u1";
    list.append(target);
    const ref = createRef<HTMLDivElement>();
    ref.current = list;
    let jumps = 0;
    list.scrollTo = () => { jumps += 1; };
    const { getByRole, queryByRole } = render(<ChatNavigation listRef={ref} lang="zh-CN" onNavigate={() => {}}
      messages={[{ id: "u1", role: "user", text: "第一问" }, { id: "a1", role: "assistant", text: "第一答" }, { id: "u2", role: "user", text: "第二问" }]} />);
    const button = getByRole("button", { name: "第 1 轮：第一问" });
    fireEvent.focus(button);
    expect(getByRole("tooltip").textContent).toContain("第一答");
    expect(jumps).toBe(0);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(queryByRole("tooltip")).toBeNull();
    fireEvent.click(button);
    expect(jumps).toBe(1);
  });
});
