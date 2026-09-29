/** Browser fixture for checking the real settings UI without native side effects. */
import { createRoot } from "react-dom/client";
import packageJson from "../../package.json";
import { legacySettingsFixture } from "../../src/testing/settingsFixtures";
import "../../src/theme.css";

const preview = window as typeof window & {
  __TAURI_INTERNALS__?: unknown;
  __TAURI_EVENT_PLUGIN_INTERNALS__?: unknown;
};
let settings = legacySettingsFixture({ updateRepo: "" });
let callbackId = 0;

preview.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: "settings" }, currentWebview: { label: "settings" } },
  transformCallback: (callback: (...args: unknown[]) => unknown) => {
    const id = ++callbackId;
    Object.assign(window, { [`_${id}`]: callback });
    return id;
  },
  unregisterCallback: () => undefined,
  invoke: async (command: string, args: { settings?: typeof settings } = {}) => {
    switch (command) {
      case "get_settings": return settings;
      case "set_settings": settings = args.settings ?? settings; return undefined;
      case "get_pet_visibility_error": return null;
      case "app_version": return packageJson.version;
      case "update_status": return { status: "idle" };
      case "check_update": return null;
      case "installed_packs": return [];
      case "plugin:event|listen": return ++callbackId;
      default: return undefined;
    }
  },
};
preview.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };

const { default: SettingsApp } = await import("../../src/settings/SettingsApp");
createRoot(document.getElementById("root")!).render(<SettingsApp />);
