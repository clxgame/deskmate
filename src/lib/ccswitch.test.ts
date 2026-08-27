import { describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  async (command) => {
    if (command === "ccswitch_capability_status") {
      return { kind: "ready", version: "3.20.0" };
    }
    if (command === "prepare_ccswitch_opencode_provider") {
      return {
        contractVersion: 1,
        receipt: {
          contractVersion: 1,
          ticketId: "ticket-1",
          providerName: "Provider",
          endpoint: "https://api.example.test",
          selectedModel: "model-a",
          preImportHash: "hash-before",
          expiresAt: 123,
        },
        models: [{ id: "model-a", name: "Model A" }],
      };
    }
    if (command === "launch_ccswitch_opencode_import") {
      return {
        contractVersion: 1,
        ticketId: "ticket-1",
        providerName: "Provider",
        endpoint: "https://api.example.test",
        selectedModel: "model-a",
        preImportHash: "hash-before",
        expiresAt: 123,
        enabled: true,
      };
    }
    return undefined;
  },
);

mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));

const {
  cancelCcSwitchSetup,
  getCcSwitchCapabilityStatus,
  launchCcSwitchOpenCodeImport,
  prepareCcSwitchOpenCodeProvider,
} = await import("./ccswitch");

describe("CC Switch Tauri wrappers", () => {
  test("reads capability status from the native command", async () => {
    await expect(getCcSwitchCapabilityStatus()).resolves.toEqual({
      kind: "ready",
      version: "3.20.0",
    });
    expect(invoke).toHaveBeenCalledWith("ccswitch_capability_status");
  });

  test("passes provider setup input only through the secure native boundary", async () => {
    const runtimeCredential = `runtime-${crypto.randomUUID()}`;

    await prepareCcSwitchOpenCodeProvider({
      providerName: "Provider",
      endpoint: "https://api.example.test",
      apiKey: runtimeCredential,
      selectedModel: "model-a",
      models: [{ id: "model-a", name: "Model A" }],
      preImportHash: "hash-before",
    });

    expect(invoke).toHaveBeenCalledWith("prepare_ccswitch_opencode_provider", {
      input: {
        providerName: "Provider",
        endpoint: "https://api.example.test",
        apiKey: runtimeCredential,
        selectedModel: "model-a",
        models: [{ id: "model-a", name: "Model A" }],
        preImportHash: "hash-before",
      },
    });
  });

  test("launches only with an explicit disclosure flag and can cancel by ticket", async () => {
    await launchCcSwitchOpenCodeImport({
      ticketId: "ticket-1",
      providerName: "Provider",
      endpoint: "https://api.example.test",
      selectedModel: "model-a",
      preImportHash: "hash-before",
      switchImmediately: true,
      acceptedProcessArgumentDisclosure: true,
    });
    await cancelCcSwitchSetup("ticket-1");

    expect(invoke).toHaveBeenCalledWith("launch_ccswitch_opencode_import", {
      request: {
        ticketId: "ticket-1",
        providerName: "Provider",
        endpoint: "https://api.example.test",
        selectedModel: "model-a",
        preImportHash: "hash-before",
        switchImmediately: true,
        acceptedProcessArgumentDisclosure: true,
      },
    });
    expect(invoke).toHaveBeenCalledWith("cancel_ccswitch_setup", {
      ticketId: "ticket-1",
    });
  });
});
