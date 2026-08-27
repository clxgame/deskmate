import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  () => Promise.resolve(undefined),
);

mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));

const { AiUsage } = await import("./AiUsage");
const { dict } = await import("../lib/i18n");

const t = dict("zh-CN");

afterEach(cleanup);

beforeEach(() => {
  invoke.mockReset();
});

describe("AI usage", () => {
  test("shows the Kuro weekly summary below the AI settings", async () => {
    invoke.mockImplementation(() =>
      Promise.resolve({
        remainingCny: 27260000,
        limitCny: 30000000,
        remainingPct: 91,
        daysUntilReset: 6,
        todayCostCny: 2735900,
        todayRequests: 438,
        topModels: [
          { name: "claude-opus-4.8", costCny: 2372500, requests: 190 },
          { name: "gpt-5.4-mini", costCny: 331200, requests: 218 },
        ],
      }),
    );

    render(
      <AiUsage
        baseUrl="https://ai-gateway.kurogames.com"
        apiKey="kuro-key"
        t={t}
      />,
    );

    expect(await screen.findByRole("heading", { name: "AI 用量" })).toBeDefined();
    expect(await screen.findByText("¥2726 / ¥3000")).toBeDefined();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("91");
    expect(screen.getByText("6 天后重置")).toBeDefined();
    expect(screen.getByText("¥273.59 · 438 次")).toBeDefined();
    expect(screen.getByText("claude-opus-4.8")).toBeDefined();
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("fetch_ai_usage", {
        baseUrl: "https://ai-gateway.kurogames.com",
        apiKey: "kuro-key",
      });
    });
  });

  test("waits for an API key instead of querying the gateway", async () => {
    render(<AiUsage baseUrl="https://ai-gateway.kurogames.com" apiKey="" t={t} />);

    expect(await screen.findByText("填写 API Key 后即可查看用量")).toBeDefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  test("explains a usage-permission rejection in the active language", async () => {
    invoke.mockImplementation(() => Promise.reject("Error: status:401"));
    render(
      <AiUsage
        baseUrl="https://ai-gateway.kurogames.com"
        apiKey="gateway-key"
        t={dict("en-US")}
      />,
    );

    expect(
      await screen.findByText("This API key cannot access usage details"),
    ).toBeDefined();
  });

  test("localizes the ai-usage title", async () => {
    invoke.mockImplementation(() => Promise.reject(new Error("status:401")));
    render(
      <AiUsage
        baseUrl="https://ai-gateway.kurogames.com"
        apiKey="gateway-key"
        t={dict("ko-KR")}
      />,
    );

    expect(await screen.findByRole("heading", { name: "AI 사용량" })).toBeDefined();
  });

  test("reloads the summary from its refresh action", async () => {
    invoke.mockImplementation(() =>
      Promise.resolve({
        remainingCny: 5000000,
        limitCny: 10000000,
        remainingPct: 50,
        daysUntilReset: 1,
        todayCostCny: 100000,
        todayRequests: 2,
        topModels: [],
      }),
    );
    const user = userEvent.setup();
    render(
      <AiUsage
        baseUrl="https://ai-gateway.kurogames.com"
        apiKey="kuro-key"
        t={t}
      />,
    );

    await screen.findByText("¥500 / ¥1000");
    await user.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  });
});
