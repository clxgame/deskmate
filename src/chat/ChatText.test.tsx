import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ChatText } from "./ChatText";

afterEach(cleanup);

describe("ChatText", () => {
  test("emphasizes signature terms without changing the message text", () => {
    const message =
      "因为本人：系著名当代游戏电子游戏音乐先锋级选手\n\n您叫我小著就行..嘿嘿..";

    const { container } = render(<ChatText text={message} />);
    const emphasized = Array.from(
      container.querySelectorAll("strong.chat-emphasis"),
    );

    expect(emphasized.map((element) => element.textContent)).toEqual([
      "著名",
      "小著",
    ]);
    expect(container.textContent).toBe(message);
  });

  test("leaves ordinary copy untouched", () => {
    const message = "霄·太郎是也~";
    const { container } = render(<ChatText text={message} />);

    expect(container.textContent).toBe(message);
    expect(container.querySelector("strong.chat-emphasis")).toBeNull();
  });
});
