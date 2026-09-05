import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import * as tauriEvent from "@tauri-apps/api/event";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { dict } from "../lib/i18n";
import { legacySettingsFixture } from "../testing/settingsFixtures";
import type { Patch } from "./settingsPrimitives";

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

const t = dict("en-US");

function textIndex(container: HTMLElement, text: string): number {
  return container.textContent?.indexOf(text) ?? -1;
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

    render(
      <main className="set-panel">
        <AiTab settings={settings} patch={patch} t={t} />
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
});
