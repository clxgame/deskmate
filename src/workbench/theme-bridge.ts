import { DEFAULT_THEME_ID, normalizeThemeId, type ThemeId } from "../settings/theme";
import { syncWorkbenchTheme, type WorkbenchThemeHost } from "./theme-sync";
import { handleHistoryShortcut, type WorkbenchHistoryHost } from "./history-shortcut";

declare global {
  interface Window {
    __TAURI__?: WorkbenchThemeHost & WorkbenchHistoryHost;
  }
}

const STORAGE_KEY = "yume.workbench.theme";

function applyTheme(value: string): void {
  const theme = normalizeThemeId(value);
  document.documentElement.dataset.yumeTheme = theme;
  document.documentElement.style.colorScheme = theme === "dark" ? "dark" : "light";
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch (error) {
    console.warn("YUME workbench theme cache unavailable", error);
  }
}

function cachedTheme(): ThemeId {
  try {
    return normalizeThemeId(localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME_ID);
  } catch (error) {
    console.warn("YUME workbench theme cache unavailable", error);
    return DEFAULT_THEME_ID;
  }
}

applyTheme(cachedTheme());

async function syncHostTheme(): Promise<void> {
  const bridge = window.__TAURI__;
  if (!bridge) {
    console.warn("YUME workbench theme host unavailable");
    return;
  }
  const report = (phase: "listen" | "read", error: unknown) => console.warn(`YUME workbench theme ${phase} failed`, error);
  await syncWorkbenchTheme(bridge, applyTheme, report);
  window.addEventListener("focus", () => {
    void bridge.core.invoke("workbench_theme").then(applyTheme, (error: unknown) => report("read", error));
  });
}

window.addEventListener("keydown", (event) => {
  const bridge = window.__TAURI__;
  if (!bridge) return;
  void handleHistoryShortcut(event, (command) => bridge.core.invoke(command)).catch((error: unknown) => {
    console.error("YUME history organizer could not open", error);
  });
}, { capture: true });

void syncHostTheme();
