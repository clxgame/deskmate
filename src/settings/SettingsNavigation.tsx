import type { Dict } from "../lib/i18n";
import { AppIcon, type AppIconName } from "../ui/AppIcon";

export type TabId =
  | "general"
  | "ai"
  | "widget"
  | "permissions"
  | "shortcuts"
  | "account"
  | "memory"
  | "about";

const TAB_ICONS = [
  { id: "general", icon: "general" },
  { id: "ai", icon: "ai" },
  { id: "permissions", icon: "permissions" },
  { id: "widget", icon: "widget" },
  { id: "shortcuts", icon: "shortcuts" },
  { id: "account", icon: "pet" },
  { id: "memory", icon: "memory" },
  { id: "about", icon: "about" },
] as const satisfies readonly { readonly id: TabId; readonly icon: AppIconName }[];

function tabLabel(t: Dict, id: TabId): string {
  switch (id) {
    case "general":
      return t.tabGeneral;
    case "ai":
      return t.tabAi;
    case "permissions":
      return t.tabPermissions;
    case "widget":
      return t.tabWidget;
    case "shortcuts":
      return t.tabShortcuts;
    case "account":
      return t.tabAccount;
    case "memory":
      return t.tabMemory;
    case "about":
      return t.tabAbout;
  }
}

export function SettingsNavigation({ tab, onSelect, t }: {
  readonly tab: TabId;
  readonly onSelect: (tab: TabId) => void;
  readonly t: Dict;
}) {
  return (
    <nav className="set-sidebar" aria-label={t.settingsTitle}>
      {TAB_ICONS.map((item) => (
        <button
          key={item.id}
          id={`set-category-${item.id}`}
          className={`set-tab${tab === item.id ? " set-tab-active" : ""}`}
          onClick={() => onSelect(item.id)}
        >
          <AppIcon className="set-tab-icon" name={item.icon} size={20} />
          {tabLabel(t, item.id)}
        </button>
      ))}
    </nav>
  );
}
