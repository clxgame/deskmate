import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import * as tauriEvent from "@tauri-apps/api/event";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef } from "react";
import { dict } from "../lib/i18n";
import type { Settings } from "../lib/settings";
import {
  legacySettingsFixture,
  multiProviderSettingsFixture,
} from "../testing/settingsFixtures";
import type { Patch, ReplaceSettings } from "./settingsPrimitives";

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
  patch,
  replace,
  value,
}: {
  readonly settings: Settings;
  readonly patch: Patch;
  readonly replace: ReplaceSettings;
  readonly value: string;
}) {
  const picked = useRef(false);
  const controller = useAiTabController({ settings, patch, replace, t });

  useEffect(() => {
    if (picked.current) return;
    picked.current = true;
    controller.pickModel(value);
  }, [controller, value]);

  return null;
}

afterEach(cleanup);

beforeEach(() => {
  invoke.mockClear();
  listen.mockClear();
  fetchCall.mockClear();
  globalThis.fetch = fetchMock;
});

describe("AI settings tab extraction", () => {
  test("renders the current controls in the locked order", async () => {
    const settings = legacySettingsFixture({ language: "en-US" });
    const patch = mock<Patch>((_key, _value) => undefined);
    const replace = mock<ReplaceSettings>((_settings) => undefined);

    render(
      <main className="set-panel">
        <AiTab settings={settings} patch={patch} replace={replace} t={t} />
      </main>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText(t.ccSwitchStatusTitle)).toBeDefined();
    });

    const panel = document.querySelector(".set-panel");
    expect(panel).toBeInstanceOf(HTMLElement);
    if (!(panel instanceof HTMLElement)) return;

    const orderedLabels = [
      t.baseUrl,
      t.apiKey,
      t.verify,
      t.model,
      t.yolo,
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

  test("passes the active provider UUID to usage and verification calls", async () => {
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
        <AiTab settings={settings} patch={patch} replace={replace} t={t} />
      </main>,
    );

    expect(
      await screen.findByRole("heading", { name: "AI usage · OMO Kuro" }),
    ).toBeDefined();
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("fetch_ai_usage", {
        providerId: "provider-omo-kuro",
      });
    });

    await user.click(screen.getByRole("button", { name: t.verify }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("verify_api_key", {
        providerId: "provider-omo-kuro",
        baseUrl: "https://omo-kuro.example.test/v1",
        apiKey: "omo-configured-key",
      });
    });
  });

  test("replaces settings once when a configured sidecar model is selected", async () => {
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

    render(
      <main className="set-panel">
        <AiTab settings={settings} patch={patch} replace={replace} t={t} />
      </main>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("option", { name: "Claude Sonnet 4.5" }),
      ).toBeDefined();
    });
    expect(screen.queryByRole("option", { name: "Orphan" })).toBeNull();

    await user.selectOptions(
      screen.getByRole("combobox"),
      "yume-2/claude-sonnet-4.5",
    );

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith({
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

  test("does not replace settings when the controller receives an unknown sidecar selection", async () => {
    const settings = multiProviderSettingsFixture({ language: "en-US" });
    const patch = mock<Patch>((_key, _value) => undefined);
    const replace = mock<ReplaceSettings>((_settings) => undefined);

    render(
      <PickModelProbe
        settings={settings}
        patch={patch}
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
