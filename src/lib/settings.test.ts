import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import type { ProviderModel } from "./settings";

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  () => Promise.resolve(undefined),
);

mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));

const { getAiUsage, listModels, modelsMatchVerification, verifyApiKey } =
  await import("./settings");

const originalFetch = globalThis.fetch;

const yumeModel: ProviderModel = {
  sidecarId: "yume",
  providerName: "YUME",
  modelId: "model-a",
  modelName: "Model A",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  invoke.mockReset();
});

describe("provider-aware settings IPC", () => {
  test("passes the provider UUID when verifying gateway credentials", async () => {
    invoke.mockImplementation(() => Promise.resolve(47));

    const count = await verifyApiKey(
      "provider-kuro",
      "https://ai-gateway.kurogames.com",
      "secret-key",
    );

    expect(count).toBe(47);
    expect(invoke).toHaveBeenCalledWith("verify_api_key", {
      providerId: "provider-kuro",
      baseUrl: "https://ai-gateway.kurogames.com",
      apiKey: "secret-key",
    });
  });

  test("passes the provider UUID when querying usage", async () => {
    invoke.mockImplementation(() =>
      Promise.resolve({
        remainingCny: 1,
        limitCny: 2,
        remainingPct: 50,
        daysUntilReset: 3,
        todayCostCny: 4,
        todayRequests: 5,
        topModels: [],
      }),
    );

    await getAiUsage("provider-kuro");

    expect(invoke).toHaveBeenCalledWith("fetch_ai_usage", {
      providerId: "provider-kuro",
    });
  });

  test("maps sidecar provider ids onto ProviderModel.sidecarId", async () => {
    invoke.mockImplementation((command) =>
      command === "sidecar_base_url"
        ? Promise.resolve("http://127.0.0.1:48111")
        : Promise.resolve(undefined),
    );
    const fetchResponse = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            providers: [
              {
                id: "yume-2",
                name: "OMO Kuro",
                models: {
                  "model-b": { id: "model-b", name: "Model B" },
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    globalThis.fetch = Object.assign(fetchResponse, {
      preconnect: originalFetch.preconnect,
    });

    const models = await listModels();

    expect(models).toEqual([
      {
        sidecarId: "yume-2",
        providerName: "OMO Kuro",
        modelId: "model-b",
        modelName: "Model B",
      },
    ]);
  });
});

describe("verified model catalog", () => {
  test("requires a refreshed YUME provider when the API reports models", () => {
    expect(modelsMatchVerification([], "yume", 2)).toBe(false);
    expect(modelsMatchVerification([{ ...yumeModel, sidecarId: "kuro" }], "yume", 2)).toBe(
      false,
    );
    expect(modelsMatchVerification([yumeModel], "yume", 2)).toBe(true);
  });

  test("rejects an empty refreshed catalog", () => {
    expect(modelsMatchVerification([], "yume", 0)).toBe(false);
  });
});
