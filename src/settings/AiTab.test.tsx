// allow: SIZE_OK — one integration harness owns the provider/settings mocks and restores global fetch after every case.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import * as tauriEvent from "@tauri-apps/api/event";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef, useState } from "react";
import { dict } from "../lib/i18n";
import type { Settings } from "../lib/settings";
import {
  legacySettingsFixture,
  multiProviderSettingsFixture,
} from "../testing/settingsFixtures";
import type {
  Patch,
  PersistSettings,
  ReplaceSettings,
} from "./settingsPrimitives";

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  (command) => {
    switch (command) {
      case "sidecar_base_url":
        return Promise.resolve("http://127.0.0.1:4242");
      case "ccswitch_capability_status":
        return Promise.resolve({ kind: "ready", version: "3.20.0" });
      case "fetch_ai_usage":
        return Promise.resolve({
          remainingCny: 27260000,
          limitCny: 30000000,
          remainingPct: 91,
          daysUntilReset: 6,
          todayCostCny: 2735900,
          todayRequests: 438,
          topModels: [],
        });
      default:
        return Promise.resolve(undefined);
    }
  },
);
const listen = mock<(_event: string, _handler: (event: unknown) => void) => Promise<() => void>>(
  () => Promise.resolve(() => undefined),
);
const persist = mock<PersistSettings>(() => Promise.resolve());
const originalFetch = globalThis.fetch;
const fetchCall = mock((_input: string | URL | Request, _init?: RequestInit) =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        providers: [
          {
            id: "yume",
            name: "YUME",
            models: { "gpt-5.4-mini": { name: "GPT 5.4 Mini" } },
          },
        ],
      }),
    ),
  ),
);
const fetchMock: typeof fetch = Object.assign(fetchCall, {
  preconnect: globalThis.fetch.preconnect,
});

mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
mock.module("@tauri-apps/api/event", () => ({ ...tauriEvent, listen }));

const { AiTab } = await import("./AiTab");
const { useAiTabController } = await import("./useAiTabController");

const t = dict("en-US");

function textIndex(container: HTMLElement, text: string): number {
  return container.textContent?.indexOf(text) ?? -1;
}

function PickModelProbe({
  settings,
  replace,
  value,
}: {
  readonly settings: Settings;
  readonly replace: ReplaceSettings;
  readonly value: string;
}) {
  const picked = useRef(false);
  const controller = useAiTabController({ settings, replace, persist, t });

  useEffect(() => {
    if (picked.current) return;
    picked.current = true;
    controller.pickModel(value);
  }, [controller, value]);

  return null;
}

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  invoke.mockClear();
  listen.mockClear();
  persist.mockClear();
  fetchCall.mockClear();
  globalThis.fetch = fetchMock;
});

describe("AI settings tab extraction", () => {
  test("renders the current controls in the locked order after expanding a provider", async () => {
    const user = userEvent.setup();
    const settings = legacySettingsFixture({ language: "en-US" });
    const patch = mock<Patch>((_key, _value) => undefined);
    const replace = mock<ReplaceSettings>((_settings) => undefined);

    render(
      <main className="set-panel">
        <AiTab
          settings={settings}
          patch={patch}
          replace={replace}
          persist={persist}
          t={t}
        />
      </main>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText(t.ccSwitchStatusTitle)).toBeDefined();
    });

    const panel = document.querySelector(".set-panel");
    expect(panel).toBeInstanceOf(HTMLElement);
    if (!(panel instanceof HTMLElement)) return;

    expect(screen.queryByRole("heading", { name: t.tabAi, level: 2 })).toBeNull();
    expect(screen.queryByDisplayValue(settings.apiKey)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Kuro" }));

    const orderedLabels = [
      t.baseUrl,
      t.apiKey,
      t.verify,
      t.model,
      t.ccSwitchStatusTitle,
      t.aiUsageTitle,
    ];
    const positions = orderedLabels.map((label) => textIndex(panel, label));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(screen.getByDisplayValue(settings.baseUrl)).toBeDefined();
    expect(screen.getByDisplayValue(settings.apiKey)).toBeDefined();
    expect(screen.getByRole("option", { name: "GPT 5.4 Mini" })).toHaveProperty(
      "value",
      "yume/gpt-5.4-mini",
    );
  });

  test("renders usage per provider and verifies the selected provider card", async () => {
    const user = userEvent.setup();
    const settings = multiProviderSettingsFixture({
      activeProviderId: "provider-omo-kuro",
      baseUrl: "https://omo-kuro.example.test/v1",
      apiKey: "omo-configured-key",
    });
    const patch = mock<Patch>((_key, _value) => undefined);
    const replace = mock<ReplaceSettings>((_settings) => undefined);

    render(
      <main className="set-panel">
        <AiTab
          settings={settings}
          patch={patch}
          replace={replace}
          persist={persist}
          t={t}
        />
      </main>,
    );

    expect(
      await screen.findByRole("heading", { name: "AI usage · OMO Kuro" }),
    ).toBeDefined();
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("fetch_ai_usage", {
        providerId: "provider-kuro",
      });
    });

    await user.click(screen.getByRole("button", { name: "OMO Kuro" }));
    await user.click(
      within(screen.getByRole("article", { name: "OMO Kuro" })).getByRole(
        "button",
        { name: t.verify },
      ),
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("verify_api_key", {
        providerId: "provider-omo-kuro",
        baseUrl: "https://omo-kuro.example.test/v1",
        apiKey: "omo-configured-key",
      });
    });
  });

  test("shows only the selected provider's verified models and clears the old selection", async () => {
    const user = userEvent.setup();
    const settings = multiProviderSettingsFixture({
      language: "en-US",
      activeProviderId: "provider-kuro",
      providerId: "yume",
      modelId: "gpt-5.4-mini",
    });
    const patch = mock<Patch>((_key, _value) => undefined);
    const replace = mock<ReplaceSettings>((_settings) => undefined);
    fetchCall.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            providers: [
              {
                id: "yume",
                name: "Catalog YUME",
                models: { "gpt-5.4-mini": { name: "GPT 5.4 Mini" } },
              },
              {
                id: "yume-2",
                name: "Untrusted catalog label",
                models: {
                  "claude-sonnet-4.5": { name: "Claude Sonnet 4.5" },
                },
              },
              {
                id: "unknown-sidecar",
                name: "Unknown",
                models: { orphan: { name: "Orphan" } },
              },
            ],
          }),
        ),
      ),
    );

    function StatefulAiTab() {
      const [current, setCurrent] = useState(settings);
      return <main className="set-panel"><AiTab
        settings={current}
        patch={patch}
        replace={(next) => { replace(next); setCurrent(next); }}
        persist={persist}
        t={t}
      /></main>;
    }
    render(<StatefulAiTab />);

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "GPT 5.4 Mini" })).toBeDefined();
    });
    expect(screen.queryByRole("option", { name: "Claude Sonnet 4.5" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Orphan" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "OMO Kuro" }));
    expect(replace).toHaveBeenCalledWith({
      ...settings,
      activeProviderId: "provider-omo-kuro",
      providerId: "",
      modelId: "",
    });
    expect(screen.getByRole("combobox")).toHaveProperty("value", "");
    expect(screen.queryByRole("option", { name: "GPT 5.4 Mini" })).toBeNull();
    expect(screen.getByRole("option", { name: "Claude Sonnet 4.5" })).toBeDefined();

    await user.selectOptions(
      screen.getByRole("combobox"),
      "yume-2/claude-sonnet-4.5",
    );

    expect(replace).toHaveBeenCalledTimes(2);
    expect(replace).toHaveBeenLastCalledWith({
      ...settings,
      providerId: "yume-2",
      modelId: "claude-sonnet-4.5",
      activeProviderId: "provider-omo-kuro",
    });
    expect(patch).not.toHaveBeenCalledWith("providerId", "yume-2");
    expect(patch).not.toHaveBeenCalledWith("modelId", "claude-sonnet-4.5");
    expect(patch).not.toHaveBeenCalledWith(
      "activeProviderId",
      "provider-omo-kuro",
    );
  });

  test("hides a provider's old models after its API binding changes until verification succeeds", async () => {
    const user = userEvent.setup();
    const initial = multiProviderSettingsFixture({ language: "en-US" });

    function StatefulAiTab() {
      const [current, setCurrent] = useState(initial);
      return <AiTab settings={current} patch={() => undefined} replace={setCurrent} persist={persist} t={t} />;
    }
    render(<StatefulAiTab />);

    await waitFor(() => expect(screen.getByRole("option", { name: "GPT 5.4 Mini" })).toBeDefined());
    await user.click(screen.getByRole("button", { name: "Kuro" }));
    fireEvent.change(screen.getByLabelText(`${t.aiProviderBaseUrl} · Kuro`), {
      target: { value: "https://api.deepseek.com" },
    });

    expect(screen.queryByRole("option", { name: "GPT 5.4 Mini" })).toBeNull();
    expect(screen.getByRole("combobox")).toHaveProperty("value", "");

    await user.click(within(screen.getByRole("article", { name: "Kuro" })).getByRole("button", { name: t.verify }));
    await waitFor(() => expect(screen.getByRole("option", { name: "GPT 5.4 Mini" })).toBeDefined());
  });

  test("does not replace settings when the controller receives an unknown sidecar selection", async () => {
    const settings = multiProviderSettingsFixture({ language: "en-US" });
    const replace = mock<ReplaceSettings>((_settings) => undefined);

    render(
      <PickModelProbe
        settings={settings}
        replace={replace}
        value="unknown-sidecar/orphan"
      />,
    );

    await waitFor(() => {
      expect(listen).toHaveBeenCalled();
    });
    expect(replace).not.toHaveBeenCalled();
  });
});
