import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  getAppVersion,
  getSettings,
  hideSettingsWindow,
  emitPetScalePreview,
  previewPetScale,
  setSettings,
  type Settings,
} from "../lib/settings";
import { listen } from "@tauri-apps/api/event";
import { dict, LANGS, type Dict } from "../lib/i18n";
import { UpdateFooter } from "./UpdateFooter";
import { AiTab } from "./AiTab";
import { MemoryTab } from "./MemoryTab";
import { type WorklogTarget } from "./worklog/WorklogTab";
import { WidgetTab, type WidgetId } from "./widgets/WidgetTab";
import { PersonaPacks } from "./PersonaPacks";
import { Row, Switch, type TabProps } from "./settingsPrimitives";
import type { InstalledPack } from "../lib/packs";
import {
  DEFAULT_PERSONA_ID,
  personaById,
} from "../pet/personaCatalog";
import { THEME_IDS, type ThemeId } from "./theme";
import { AppIcon, type AppIconName } from "../ui/AppIcon";
import "./settings.css";

type TabId =
  | "general"
  | "ai"
  | "widget"
  | "shortcuts"
  | "account"
  | "memory"
  | "about";

const TAB_ICONS = [
  { id: "general", icon: "general" },
  { id: "ai", icon: "ai" },
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

const THEME_LABEL_KEYS: Record<
  ThemeId,
  "themeDark" | "themeMint" | "themePeach" | "themeLavender"
> = {
  dark: "themeDark",
  mint: "themeMint",
  peach: "themePeach",
  lavender: "themeLavender",
};

function themeLabel(t: Dict, id: ThemeId): string {
  return t[THEME_LABEL_KEYS[id]];
}

const SAVE_DELAY_MS = 400;

// allow: SIZE_OK — existing settings composition root; widget controls are extracted and remaining tabs are outside this change.
export default function SettingsApp() {
  const [tab, setTab] = useState<TabId>("general");
  const [activeWidget, setActiveWidget] = useState<WidgetId>("tasks");
  const [worklogRequest, setWorklogRequest] = useState<{ readonly target: WorklogTarget | null; readonly id: number } | null>(null);
  const [settings, setLocalSettings] = useState<Settings | null>(null);
  const t = dict(settings?.language ?? "zh-CN");

  const settingsRef = useRef<Settings | null>(null);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    const unlisten = listen<string>("deskmate://settings-tab", (event) => {
      if (event.payload === "widget") setTab("widget");
      if (event.payload === "worklog") {
        setTab("widget"); setActiveWidget("worklog");
      }
    });
    const targetListener = listen<WorklogTarget | null>("deskmate://worklog-target", (event) => {
      setWorklogRequest((previous) => ({ target: event.payload, id: (previous?.id ?? 0) + 1 }));
      setTab("widget"); setActiveWidget("worklog");
    });
    return () => {
      void unlisten.then((stopListening) => stopListening());
      void targetListener.then((stopListening) => stopListening());
    };
  }, []);

  useEffect(() => {
    let closed = false;
    void (async () => {
      try {
        const loaded = await getSettings();
        if (!closed) {
          settingsRef.current = loaded;
          setLocalSettings(loaded);
        }
      } catch (error) {
        console.error(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    })();
    return () => {
      closed = true;
    };
  }, []);

  // Flush any pending write when the window goes away.
  useEffect(() => {
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, []);

  const replace = useCallback((next: Settings) => {
    settingsRef.current = next;
    setLocalSettings(next);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void setSettings(next).catch((error: unknown) =>
        console.error(error instanceof Error ? error : new Error(String(error))),
      );
    }, SAVE_DELAY_MS);
  }, []);

  const persist = useCallback(async (next: Settings) => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    settingsRef.current = next;
    setLocalSettings(next);
    await setSettings(next);
  }, []);

  /** Update one field locally, then persist the whole object debounced. */
  const patch = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      const current = settingsRef.current;
      if (current === null) return;

      replace({ ...current, [key]: value });
    },
    [replace],
  );

  return (
    <div className="set-root" data-theme={settings?.theme ?? "dark"}>
      <header className="set-titlebar" data-tauri-drag-region="">
        <span className="set-title">{t.settingsTitle}</span>
        <button
          className="set-close"
          onClick={() => void hideSettingsWindow()}
          aria-label={t.close}
        >
          <AppIcon name="close" size={18} />
        </button>
      </header>

      <div className="set-body">
        <nav className="set-sidebar">
          {TAB_ICONS.map((item) => (
            <button
              key={item.id}
              id={`set-category-${item.id}`}
              className={`set-tab${tab === item.id ? " set-tab-active" : ""}`}
              onClick={() => setTab(item.id)}
            >
              <AppIcon className="set-tab-icon" name={item.icon} size={20} />
              {tabLabel(t, item.id)}
            </button>
          ))}
        </nav>

        {settings === null ? (
          <div className="set-panel">
            <div className="set-loading">{t.loading}</div>
          </div>
        ) : (
          <main className="set-panel" aria-labelledby={`set-category-${tab}`}>
            {tab === "general" && (
              <GeneralTab settings={settings} patch={patch} t={t} />
            )}
            {tab === "ai" && (
              <AiTab
                settings={settings}
                patch={patch}
                replace={replace}
                persist={persist}
                t={t}
              />
            )}
            {tab === "widget" && (
              <WidgetTab settings={settings} patch={patch} t={t} activeWidget={activeWidget} onSelect={setActiveWidget} worklogRequest={worklogRequest} />
            )}
            {tab === "shortcuts" && (
              <ShortcutsTab settings={settings} patch={patch} t={t} />
            )}
            {tab === "account" && (
              <AccountTab settings={settings} patch={patch} t={t} />
            )}
            {tab === "memory" && (
              <MemoryTab
                language={settings.language}
                personaId={settings.personaId}
                autoExtract={settings.memoryAutoExtract}
                aiUse={settings.memoryAiUse}
                onAutoExtractChange={(value) =>
                  patch("memoryAutoExtract", value)
                }
                onAiUseChange={(value) => patch("memoryAiUse", value)}
                t={t}
              />
            )}
            {tab === "about" && (
              <AboutTab settings={settings} patch={patch} t={t} />
            )}
          </main>
        )}
      </div>

      {settings !== null && <UpdateFooter repo={settings.updateRepo} t={t} />}
    </div>
  );
}

// ---------------------------------------------------------------- primitives

function RenderSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <Row label={label}>
      <input
        className="set-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="set-slider-value">{format(value)}</span>
    </Row>
  );
}

function ThemePicker({
  value,
  onChange,
  t,
}: {
  value: ThemeId;
  onChange: (value: ThemeId) => void;
  t: Dict;
}) {
  return (
    <div className="set-theme-picker" role="radiogroup" aria-label={t.theme}>
      {THEME_IDS.map((id) => {
        const label = themeLabel(t, id);
        return (
          <button
            key={id}
            className={`set-theme-choice${value === id ? " set-theme-choice-active" : ""}`}
            type="button"
            role="radio"
            aria-checked={value === id}
            aria-label={label}
            title={label}
            onClick={() => onChange(id)}
          >
            <span
              className={`set-theme-swatch set-theme-swatch-${id}`}
              aria-hidden="true"
            />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ 通用

function GeneralTab({ settings, patch, t }: TabProps) {
  return (
    <>
      <Row label={t.autostart}>
        <Switch
          label={t.autostart}
          checked={settings.autostart}
          onChange={(v) => patch("autostart", v)}
        />
      </Row>
      <Row label={t.language}>
        <select
          className="set-select"
          value={settings.language}
          onChange={(e) => patch("language", e.target.value)}
        >
          {LANGS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t.theme}>
        <ThemePicker
          value={settings.theme}
          onChange={(value) => patch("theme", value)}
          t={t}
        />
      </Row>
      <p className="set-note">{t.themeHint}</p>
    </>
  );
}

// --------------------------------------------------------------- 快捷键

function ShortcutsTab({ settings, patch, t }: TabProps) {
  return (
    <>
      <Row label={t.shortcutToggleChat}>
        <ShortcutInput
          label={t.shortcutToggleChat}
          value={settings.shortcutToggleChat}
          onChange={(v) => patch("shortcutToggleChat", v)}
          t={t}
        />
      </Row>
      <Row label={t.shortcutTogglePet}>
        <ShortcutInput
          label={t.shortcutTogglePet}
          value={settings.shortcutTogglePet}
          onChange={(v) => patch("shortcutTogglePet", v)}
          t={t}
        />
      </Row>
      <p className="set-note">{t.shortcutHint}</p>
    </>
  );
}

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

function ShortcutInput({
  value,
  onChange,
  label,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  t: Dict;
}) {
  const [capturing, setCapturing] = useState(false);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.key === "Escape" || e.key === "Backspace" || e.key === "Delete") {
      onChange("");
      setCapturing(true);
      return;
    }
    if (MODIFIER_KEYS.has(e.key)) return;

    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.shiftKey) parts.push("Shift");
    if (e.altKey) parts.push("Alt");
    if (e.metaKey) parts.push("Super");
    parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
    onChange(parts.join("+"));
    // Show the freshly captured combo instead of the prompt.
    setCapturing(false);
  };

  return (
    <input
      className="set-input set-input-shortcut"
      type="text"
      readOnly
      aria-label={label}
      value={capturing ? "" : value}
      placeholder={capturing ? t.shortcutCapture : t.shortcutUnset}
      onFocus={() => setCapturing(true)}
      onBlur={() => setCapturing(false)}
      onKeyDown={onKeyDown}
    />
  );
}

// ----------------------------------------------------------------- 角色

function AccountTab({ settings, patch, t }: TabProps) {
  const personaId = personaById(settings.personaId || DEFAULT_PERSONA_ID).id;
  const scaleFrame = useRef<number | null>(null);
  const scalePreviewValue = useRef(settings.petScale);

  useEffect(() => {
    return () => {
      if (scaleFrame.current !== null) {
        window.cancelAnimationFrame(scaleFrame.current);
      }
    };
  }, []);

  const [installedPacks, setInstalledPacks] = useState<InstalledPack[]>([]);
  return (
    <>
      <div className="set-pet-controls">
        <Row label={t.petScale}>
          <input
            className="set-slider"
            type="range"
            min={0.1}
            max={2}
            step={0.1}
            value={settings.petScale}
            aria-label={t.petScale}
            onChange={(e) => {
              const value = Number(e.target.value);
              patch("petScale", value);
              scalePreviewValue.current = value;
              void emitPetScalePreview(value).catch((error: unknown) =>
                console.error("pet scale preview failed", error),
              );
              if (scaleFrame.current === null) {
                scaleFrame.current = window.requestAnimationFrame(() => {
                  scaleFrame.current = null;
                  void previewPetScale(scalePreviewValue.current).catch(
                    (error: unknown) =>
                      console.error("pet scale resize failed", error),
                  );
                });
              }
            }}
          />
          <span className="set-slider-value">
            {settings.petScale.toFixed(1)}x
          </span>
        </Row>
        <Row label={t.petVisible}>
          <Switch
            label={t.petVisible}
            checked={settings.petVisible}
            onChange={(v) => patch("petVisible", v)}
          />
        </Row>
      </div>
      <Row label={t.userName} className="set-row-nickname">
        <input
          className="set-input"
          type="text"
          value={settings.userName}
          placeholder={t.userNamePlaceholder}
          onChange={(e) => patch("userName", e.target.value)}
        />
      </Row>
      <PersonaPacks
        t={t}
        language={settings.language}
        installed={installedPacks}
        onInstalledChange={setInstalledPacks}
        activePersonaId={personaId}
        onActivePersonaRemoved={() => patch("personaId", DEFAULT_PERSONA_ID)}
        onActivePersonaChange={(nextPersonaId) => patch("personaId", nextPersonaId)}
      />
      <Row label={t.mouseFollow}>
        <Switch
          label={t.mouseFollow}
          checked={settings.mouseFollow}
          onChange={(value) => patch("mouseFollow", value)}
        />
      </Row>
      <RenderSlider
        label={t.outlineWidth}
        value={settings.outlineWidth}
        min={0}
        max={0.03}
        step={0.0001}
        format={(value) => value.toFixed(4)}
        onChange={(value) => patch("outlineWidth", value)}
      />
      <RenderSlider
        label={t.rimWidth}
        value={settings.rimWidth}
        min={0}
        max={1}
        step={0.01}
        format={(value) => value.toFixed(2)}
        onChange={(value) => patch("rimWidth", value)}
      />
      <RenderSlider
        label={t.rimIntensity}
        value={settings.rimIntensity}
        min={0}
        max={2}
        step={0.05}
        format={(value) => value.toFixed(2)}
        onChange={(value) => patch("rimIntensity", value)}
      />
      <RenderSlider
        label={t.specularIntensity}
        value={settings.specularIntensity}
        min={0}
        max={2}
        step={0.05}
        format={(value) => value.toFixed(2)}
        onChange={(value) => patch("specularIntensity", value)}
      />
    </>
  );
}

// ----------------------------------------------------------------- 关于

function AboutTab({ t }: TabProps) {
  const [version, setVersion] = useState("");

  useEffect(() => {
    let closed = false;
    void (async () => {
      try {
        const v = await getAppVersion();
        if (!closed) setVersion(v);
      } catch (error) {
        console.error(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    })();
    return () => {
      closed = true;
    };
  }, []);

  return (
    <>
      <p className="set-about-name">YUME</p>
      <p className="set-about-version">{version ? `v${version}` : "…"}</p>
      <p className="set-about-desc">{t.aboutDesc}</p>
      <p className="set-about-credits">{t.aboutCredits}</p>
    </>
  );
}
