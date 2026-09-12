import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ChatText } from "./ChatText";

afterEach(cleanup);

describe("ChatText", () => {
  test("copies the complete code with whitespace and allows retry after failure", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const copied: string[] = [];
    let fail = true;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text: string) => {
        if (fail) throw new Error("Clipboard denied");
        copied.push(text);
      },
    } });
    try {
      const code = "  const literal = '**星号**';\n\treturn literal;\n";
      const { getByRole, container } = render(<ChatText text={'```ts\n' + code + '```'} />);
      fireEvent.click(getByRole("button", { name: "复制代码" }));
      await waitFor(() => expect(getByRole("status").textContent).toBe("复制失败，请重试"));
      fail = false;
      fireEvent.click(getByRole("button", { name: "复制代码" }));
      await waitFor(() => expect(getByRole("status").textContent).toBe("已复制"));
      expect(copied).toEqual([code]);
      expect(container.querySelector("pre")?.textContent).toBe(code);
    } finally {
      if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  test("opens desktop links through the native command and exposes failures", async () => {
    const tauriDescriptor = Object.getOwnPropertyDescriptor(globalThis, "isTauri");
    const internalsDescriptor = Object.getOwnPropertyDescriptor(window, "__TAURI_INTERNALS__");
    const calls: unknown[] = [];
    Object.defineProperty(globalThis, "isTauri", { configurable: true, value: true });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: { invoke: (command: string, args: unknown) => {
        calls.push({ command, args });
        return Promise.reject(new Error("No browser available"));
      } },
    });
    try {
      const { getByRole } = render(<ChatText text="[网站](https://example.com)" />);
      expect(fireEvent.click(getByRole("link"))).toBe(false);
      expect(calls).toEqual([{ command: "open_chat_link", args: { url: "https://example.com" } }]);
      await waitFor(() => expect(getByRole("alert").textContent).toContain("无法打开，请复制链接"));
    } finally {
      if (tauriDescriptor) Object.defineProperty(globalThis, "isTauri", tauriDescriptor);
      else Reflect.deleteProperty(globalThis, "isTauri");
      if (internalsDescriptor) Object.defineProperty(window, "__TAURI_INTERNALS__", internalsDescriptor);
      else Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    }
  });

  test("does not emphasize signature terms unless the author requests it", () => {
    const message =
      "因为本人：系著名当代游戏电子游戏音乐先锋级选手\n\n您叫我小著就行..嘿嘿..";

    const { container } = render(<ChatText text={message} />);
    const emphasized = Array.from(
      container.querySelectorAll("strong.chat-emphasis"),
    );

    expect(emphasized).toHaveLength(0);
    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toContain("您叫我小著就行");
  });

  test("leaves ordinary copy untouched", () => {
    const message = "霄·太郎是也~";
    const { container } = render(<ChatText text={message} />);

    expect(container.textContent).toBe(message);
    expect(container.querySelector("strong.chat-emphasis")).toBeNull();
  });

  test("renders Markdown strong markers without showing the asterisks", () => {
    const message = "- **AI 边的 SDK 基本都是 TS 优先**。\n\n普通文本";

    const { container } = render(<ChatText text={message} />);

    expect(container.querySelector("li")?.textContent).toBe("AI 边的 SDK 基本都是 TS 优先。");
    expect(container.querySelector("strong")?.textContent).toBe(
      "AI 边的 SDK 基本都是 TS 优先",
    );
    expect(container.textContent).not.toContain("**");
  });

  test("preserves unmatched strong markers literally", () => {
    const message = "保留 **未闭合标记";

    const { container } = render(<ChatText text={message} />);

    expect(container.textContent).toBe(message);
    expect(container.querySelector("strong.chat-markdown-strong")).toBeNull();
  });

  test("renders nested lists, headings, quotations and inline formatting", () => {
    const { container } = render(<ChatText text={"## 建议\n\n1. **重点**和*说明*\n   - ~~旧方案~~\n\n> 引用\n\n`**literal**`"} />);
    expect(container.querySelector("h2")?.textContent).toBe("建议");
    expect(container.querySelector("ol li ul li del")?.textContent).toBe("旧方案");
    expect(container.querySelector("em")?.textContent).toBe("说明");
    expect(container.querySelector("blockquote")?.textContent).toContain("引用");
    expect(container.querySelector("code")?.textContent).toBe("**literal**");
    expect(container.querySelector("code strong")).toBeNull();
  });

  test("preserves code whitespace and gives tables a keyboard scroll region", () => {
    const { container } = render(<ChatText text={"```ts\n  const x = '**literal**';\n```\n\n|格式|状态|\n|---|---|\n|GIF|正常|"} />);
    expect(container.querySelector("pre code")?.textContent).toBe("  const x = '**literal**';\n");
    expect(container.querySelector("pre")?.tabIndex).toBe(0);
    const region = container.querySelector(".chat-markdown-table");
    expect(region?.getAttribute("tabindex")).toBe("0");
    expect(region?.getAttribute("aria-label")).toBeTruthy();
    expect(region?.querySelector("tbody td")?.textContent).toBe("GIF");
  });

  test("keeps user message Markdown and whitespace literal in plain mode", () => {
    const text = "**小著**\n\n- `代码`\n  缩进";
    const { container } = render(<ChatText text={text} format="plain" />);
    expect(container.textContent).toBe(text);
    expect(container.querySelector("strong, ul, code")).toBeNull();
  });

  test("completes partial emphasis only while streaming without remounting blocks", () => {
    const { container, rerender } = render(<ChatText text="已完成段落。\n\n**正在" streaming />);
    const firstParagraph = container.querySelector("p");
    expect(container.querySelector("strong")?.textContent).toBe("正在");
    rerender(<ChatText text="已完成段落。\n\n**正在回复**" streaming />);
    expect(container.querySelector("p")).toBe(firstParagraph);
    expect(container.querySelector("strong")?.textContent).toBe("正在回复");
    rerender(<ChatText text="已完成段落。\n\n**正在回复" />);
    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toContain("**正在回复");
  });

  test("does not make partial links clickable during streaming", () => {
    const { container } = render(<ChatText text="查看[文档](https://exam" streaming />);
    expect(container.textContent).toContain("文档");
    expect(container.querySelector("a[href]")).toBeNull();
  });

  test("keeps unsafe URLs and HTML inert and never loads Markdown images", () => {
    const text = "[危险](javascript:alert%281%29) [本地](file:///C:/secret) [相对](/settings.html)\n\n<img src=x onerror=alert(1)>\n\n![图片说明](https://example.test/tracker.png)\n\n[文档](https://example.test/docs)";
    const { container } = render(<ChatText text={text} />);
    expect(container.querySelector("img, script, iframe")).toBeNull();
    expect(container.textContent).toContain("图片说明");
    const links = container.querySelectorAll("a[href]");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("https://example.test/docs");
    expect(links[0]?.getAttribute("target")).toBe("_blank");
    expect(links[0]?.getAttribute("rel")).toContain("noopener");
  });
});
