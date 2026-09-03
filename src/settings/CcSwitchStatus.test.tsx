import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import * as tauriEvent from "@tauri-apps/api/event";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactElement } from "react";
import type { Dict } from "../lib/i18n";
import type {
  CcSwitchCapabilityStatus,
  LocalAiDeploymentStatus,
} from "./CcSwitchStatus";

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  (command) => defaultInvoke(command),
);
const emit = mock<(event: string, payload?: unknown) => Promise<void>>(() =>
  Promise.resolve(),
);
const listen = mock<(event: string, handler: unknown) => Promise<() => void>>(() =>
  Promise.resolve(() => undefined),
);

mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
mock.module("@tauri-apps/api/event", () => ({ ...tauriEvent, emit, listen }));

const {
  CcSwitchStatus,
  localAiDeploymentErrorCode,
  normalizeCcSwitchCapabilityStatus,
} = await import("./CcSwitchStatus");
const { dict, LANGS } = await import("../lib/i18n");
const SettingsApp = (await import("./SettingsApp")).default;

const originalFetch = globalThis.fetch;

const settingsFixture = {
  autostart: false, language: "zh-CN", theme: "dark", providerId: "yume",
  modelId: "gpt-5.4-mini", yolo: false,
  baseUrl: "https://ai-gateway.kurogames.com", apiKey: "configured-key",
  petScale: 1, outlineWidth: 0.0008, rimWidth: 0.1, rimIntensity: 0.3,
  specularIntensity: 0.05, petVisible: true, alwaysOnTop: false,
  scheduledTasks: [], shortcutToggleChat: "", shortcutTogglePet: "",
  personaId: "xiaozhu", mouseFollow: false, userName: "",
  memoryAutoExtract: true, memoryAiUse: true, updateRepo: "owner/repo",
};

function defaultInvoke(command: string): Promise<unknown> {
  if (command === "get_settings") return Promise.resolve(settingsFixture);
  if (command === "sidecar_base_url") return Promise.resolve("http://127.0.0.1:48111");
  if (command === "ccswitch_capability_status") return Promise.resolve({ kind: "ready", version: "3.20.0" });
  if (command === "verify_api_key") return Promise.resolve(1);
  if (command === "deploy_local_ai_stack") {
    return Promise.resolve({
      ccSwitchVersion: "3.20.1",
      openCodeVersion: "1.18.21",
      modelId: "gpt-5.4-mini",
    });
  }
  if (command === "fetch_ai_usage") return Promise.reject(new Error("unauthorized"));
  return Promise.resolve(undefined);
}

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  invoke.mockClear();
  invoke.mockImplementation((command) => defaultInvoke(command));
  emit.mockClear();
  listen.mockClear();
  const fetchResponse = mock(() =>
    Promise.resolve(new Response(JSON.stringify(modelCatalogFixture), { status: 200 })),
  );
  globalThis.fetch = Object.assign(fetchResponse, {
    preconnect: mock(() => undefined),
  });
});

const modelCatalogFixture = {
  providers: [{
    id: "yume", name: "YUME",
    models: { "gpt-5.4-mini": { id: "gpt-5.4-mini", name: "gpt-5.4-mini" } },
  }],
};

function renderStatus(element: ReactElement) {
  render(<div className="set-root">{element}</div>);
}

type StatusFixture = {
  readonly status: CcSwitchCapabilityStatus;
  readonly deployment?: LocalAiDeploymentStatus;
  readonly t?: Dict;
  readonly onDeploy?: () => void;
};

function renderCcSwitch(fixture: StatusFixture) {
  renderStatus(
    <CcSwitchStatus status={fixture.status} t={fixture.t ?? dict("zh-CN")}
      deployment={fixture.deployment ?? { kind: "idle" }}
      canDeploy
      onDeploy={fixture.onDeploy ?? (() => undefined)} />,
  );
}

type InvokeFixture = {
  readonly status?: unknown;
  readonly statusError?: Error;
  readonly showResult?: unknown;
};

function useInvokeFixture(fixture: InvokeFixture) {
  invoke.mockImplementation((command) => {
    switch (command) {
      case "get_settings":
        return Promise.resolve(settingsFixture);
      case "sidecar_base_url":
        return Promise.resolve("http://127.0.0.1:48111");
      case "ccswitch_capability_status":
        if (fixture.statusError) return Promise.reject(fixture.statusError);
        return Promise.resolve(fixture.status ?? { kind: "ready", version: "3.20.0" });
      case "verify_api_key":
        return Promise.resolve(1);
      case "deploy_local_ai_stack":
        return Promise.resolve({
          ccSwitchVersion: "3.20.1",
          openCodeVersion: "1.18.21",
          modelId: "gpt-5.4-mini",
        });
      case "fetch_ai_usage":
        return Promise.reject(new Error("unauthorized"));
      default:
        return Promise.resolve(undefined);
    }
  });
}

async function openAiSettings() {
  const user = userEvent.setup();
  render(<SettingsApp />);
  await user.click(await screen.findByRole("button", { name: /AI/ }));
  return user;
}

describe("CC Switch status component", () => {
  test("announces ready status and starts one-click deployment from the keyboard", async () => {
    const user = userEvent.setup();
    const onDeploy = mock<() => void>(() => undefined);
    renderCcSwitch({ status: { kind: "ready", version: "3.20.0" }, onDeploy });

    expect(screen.getByRole("status").textContent).toContain("CC Switch 3.20.0");
    const button = screen.getByRole("button", { name: "一键部署" });
    await user.tab();
    expect(document.activeElement).toBe(button);
    await user.keyboard("{Enter}");

    expect(onDeploy).toHaveBeenCalledTimes(1);
  });

  test("shows checking state with the deployment action temporarily disabled", () => {
    renderCcSwitch({ status: { kind: "checking" } });

    expect(screen.getByRole("status").textContent).toBe("正在检查 CC Switch…");
    expect(
      (screen.getByRole("button", { name: "一键部署" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  test("lets a fresh machine deploy even when CC Switch is unavailable", async () => {
    const user = userEvent.setup();
    const onDeploy = mock<() => void>(() => undefined);
    renderCcSwitch({
      status: { kind: "unavailable", reason: "missing-handler" },
      onDeploy,
    });

    expect(screen.getByRole("alert").textContent).toContain("未检测到 CC Switch");
    await user.click(screen.getByRole("button", { name: "一键部署" }));

    expect(onDeploy).toHaveBeenCalledTimes(1);
  });

  test("renders native deployment progress and verified completion", () => {
    renderCcSwitch({
      status: { kind: "ready", version: "3.20.1" },
      deployment: { kind: "working", stage: "installingOpenCode" },
    });
    expect(screen.getByRole("status").textContent).toContain("正在部署 OpenCode");
    expect(
      (screen.getByRole("button", { name: "部署中…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    cleanup();
    renderCcSwitch({
      status: { kind: "ready", version: "3.20.1" },
      deployment: {
        kind: "success",
        ccSwitchVersion: "3.20.1",
        openCodeVersion: "1.18.21",
      },
    });
    expect(
      within(screen.getByLabelText("CC Switch")).getByRole("status").textContent,
    ).toContain("部署完成");
  });

  test("renders unsupported and recoverable-error states with alert semantics", () => {
    const t = dict("en-US");
    renderCcSwitch({ status: { kind: "unsupported" }, t });
    expect(screen.getByRole("alert").textContent).toContain(
      "CC Switch setup is available on Windows only",
    );

    cleanup();
    renderCcSwitch({ status: { kind: "recoverable-error" }, t });
    expect(screen.getByRole("alert").textContent).toContain(
      "Check failed. You can retry",
    );
  });

  test("keeps every CC Switch label populated in all four languages", () => {
    for (const lang of LANGS) {
      renderCcSwitch({
        status: { kind: "ready", version: "3.20.0" },
        t: dict(lang.value),
      });
      const region = screen.getByLabelText(dict(lang.value).ccSwitchStatusTitle);
      expect(region.textContent?.includes("3.20.0")).toBe(true);
      expect(within(region).getByRole("button")).toBeDefined();
      cleanup();
    }
  });

  test("normalizes malformed native output without exposing unknown fields", () => {
    const sensitiveMarker = "SYNTHETIC_STATUS_FIELD_DO_NOT_RENDER";
    const status = normalizeCcSwitchCapabilityStatus({
      kind: "ready",
      version: { token: sensitiveMarker },
      message: sensitiveMarker,
      platform: sensitiveMarker,
    });

    renderCcSwitch({ status });

    const region = screen.getByLabelText("CC Switch");
    expect(within(region).getByRole("alert").textContent).toContain(
      "未检测到 CC Switch",
    );
    expect(region.textContent).not.toContain(sensitiveMarker);
    expect(within(region).getByRole("button", { name: "一键部署" })).toBeDefined();
  });

  test("recognizes only known renderer errors and never returns an Error secret", () => {
    expect(localAiDeploymentErrorCode(new Error("models_unavailable"))).toBe(
      "models_unavailable",
    );
    expect(localAiDeploymentErrorCode(new Error("sk-do-not-render"))).toBe(
      "local_ai_deploy_failed",
    );
  });
});

describe("CC Switch entry in AI settings", () => {
  test("places CC Switch below YOLO warning and above AI usage", async () => {
    await openAiSettings();

    await waitFor(() => {
      expect(screen.getByLabelText("CC Switch")).toBeDefined();
    });
    const panelText = document.querySelector(".set-panel")?.textContent ?? "";
    expect(panelText.indexOf("允许 AI 直接执行命令,谨慎开启")).toBeLessThan(
      panelText.indexOf("CC Switch"),
    );
    expect(panelText.indexOf("CC Switch")).toBeLessThan(panelText.indexOf("AI 用量"));
  });

  test("refreshes capability safely when the native command is unavailable", async () => {
    useInvokeFixture({ statusError: new Error("unknown command") });
    const user = await openAiSettings();

    expect((await screen.findByRole("alert")).textContent).toContain(
      "未检测到 CC Switch",
    );
    await user.click(screen.getByRole("button", { name: "一键部署" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("deploy_local_ai_stack", {
        request: { modelId: "gpt-5.4-mini" },
      });
    });
    expect(emit).not.toHaveBeenCalled();
  });

  test("normalizes unknown native status into a retry-safe unavailable state", async () => {
    const sensitiveMarker = "SYNTHETIC_NATIVE_FIELD_DO_NOT_RENDER";
    useInvokeFixture({
      status: {
        kind: "ready",
        version: { token: sensitiveMarker },
        reason: sensitiveMarker,
        platform: sensitiveMarker,
      },
    });
    const user = await openAiSettings();

    const region = await screen.findByLabelText("CC Switch");
    expect(within(region).getByRole("alert").textContent).toContain(
      "未检测到 CC Switch",
    );
    expect(region.textContent).not.toContain(sensitiveMarker);
    await user.click(within(region).getByRole("button", { name: "一键部署" }));

    expect(emit).not.toHaveBeenCalled();
  });

  test("verifies the API then deploys the selected model without opening chat", async () => {
    const user = await openAiSettings();

    await user.click(await screen.findByRole("button", { name: "一键部署" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("verify_api_key", {
        baseUrl: settingsFixture.baseUrl,
        apiKey: settingsFixture.apiKey,
      });
      expect(invoke).toHaveBeenCalledWith("deploy_local_ai_stack", {
        request: { modelId: "gpt-5.4-mini" },
      });
    });
    expect(invoke).not.toHaveBeenCalledWith("show_chat_window");
    expect(emit).not.toHaveBeenCalled();
    expect(
      within(screen.getByLabelText("CC Switch")).getByRole("status").textContent,
    ).toContain("部署完成");
  });

  test("never renders unknown native deployment fields or a rejected API key", async () => {
    const secret = "sk-native-error-must-not-render";
    invoke.mockImplementation((command) => {
      if (command === "deploy_local_ai_stack") {
        return Promise.reject({ code: "local_ai_install_failed", detail: secret });
      }
      return defaultInvoke(command);
    });
    const user = await openAiSettings();

    await user.click(await screen.findByRole("button", { name: "一键部署" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("部署失败");
    expect(alert.textContent).not.toContain(secret);
  });
});
