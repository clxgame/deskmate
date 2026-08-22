import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  getAppVersion,
  getSettings,
  hideSettingsWindow,
  emitPetScalePreview,
  listModels,
  previewPetScale,
  setSettings,
  verifyApiKey,
  type ProviderModel,
  type Settings,
} from "../lib/settings";
import { dict, verifyError, LANGS, type Dict } from "../lib/i18n";
import { UpdateFooter } from "./UpdateFooter";
import {
  DEFAULT_PERSONA_ID,
  PERSONAS,
  personaById,
  personaLabel,
} from "../pet/personaCatalog";
import { THEME_IDS, type ThemeId } from "./theme";
import "./settings.css";

type TabId = "general" | "ai" | "widget" | "shortcuts" | "account" | "about";

const TAB_GLYPHS: { id: TabId; glyph: string }[] = [
  { id: "general", glyph: "◎" },
  { id: "ai", glyph: "✦" },
  { id: "widget", glyph: "▣" },
  { id: "shortcuts", glyph: "⌘" },
  { id: "account", glyph: "◍" },
  { id: "about", glyph: "ⓘ" },
];

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

export default function SettingsApp() {
  const [tab, setTab] = useState<TabId>("general");
  const [settings, setLocalSettings] = useState<Settings | null>(null);
  const t = dict(settings?.language ?? "zh-CN");

  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let closed = false;
    void (async () => {
      try {
        const loaded = await getSettings();
        if (!closed) setLocalSettings(loaded);
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

  /** Update one field locally, then persist the whole object debounced. */
  const patch = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      setLocalSettings((prev) => {
        if (!prev) return prev;
        const next: Settings = { ...prev, [key]: value };
        if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          saveTimer.current = null;
          void setSettings(next).catch((e: unknown) => console.error(e));
        }, SAVE_DELAY_MS);
        return next;
      });
    },
    [],
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
          ×
        </button>
      </header>

      <div className="set-body">
        <nav className="set-sidebar">
          {TAB_GLYPHS.map((g) => (
            <button
              key={g.id}
              className={`set-tab${tab === g.id ? " set-tab-active" : ""}`}
              onClick={() => setTab(g.id)}
            >
              <span className="set-tab-glyph">{g.glyph}</span>
              {tabLabel(t, g.id)}
            </button>
          ))}
        </nav>

        {settings === null ? (
          <div className="set-panel">
            <div className="set-loading">{t.loading}</div>
          </div>
        ) : (
          <main className="set-panel">
            {tab === "general" && (
              <GeneralTab settings={settings} patch={patch} t={t} />
            )}
            {tab === "ai" && <AiTab settings={settings} patch={patch} t={t} />}
            {tab === "widget" && (
              <WidgetTab settings={settings} patch={patch} t={t} />
            )}
            {tab === "shortcuts" && (
              <ShortcutsTab settings={settings} patch={patch} t={t} />
            )}
            {tab === "account" && (
              <AccountTab settings={settings} patch={patch} t={t} />
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

type Patch = <K extends keyof Settings>(key: K, value: Settings[K]) => void;
interface TabProps {
  settings: Settings;
  patch: Patch;
  t: Dict;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <span className="set-row-label">{label}</span>
      <div className="set-row-control">{children}</div>
    </div>
  );
}

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

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="set-switch">
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="set-switch-track" />
    </label>
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
      <h2 className="set-panel-head">{t.tabGeneral}</h2>
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

// -------------------------------------------------------------------- AI

function AiTab({ settings, patch, t }: TabProps) {
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [failed, setFailed] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    let closed = false;
    void (async () => {
      try {
        const list = await listModels();
        if (!closed) setModels(list);
      } catch (error) {
        console.error(
          error instanceof Error ? error : new Error(String(error)),
        );
        if (!closed) setFailed(true);
      }
    })();
    return () => {
      closed = true;
    };
  }, []);

  const verify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const count = await verifyApiKey(settings.baseUrl, settings.apiKey);
      setVerifyResult({ ok: true, message: t.verifyOk(count) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVerifyResult({ ok: false, message: verifyError(t, message) });
    } finally {
      setVerifying(false);
    }
  };

  // Group by provider, preserving first-seen provider order.
  const groups: { providerName: string; models: ProviderModel[] }[] = [];
  for (const m of models) {
    let group = groups.find((g) => g.providerName === m.providerName);
    if (!group) {
      group = { providerName: m.providerName, models: [] };
      groups.push(group);
    }
    group.models.push(m);
  }

  const current = settings.providerId
    ? `${settings.providerId}/${settings.modelId}`
    : "";

  const onPick = (raw: string) => {
    if (!raw) {
      patch("providerId", "");
      patch("modelId", "");
      return;
    }
    const slash = raw.indexOf("/");
    patch("providerId", raw.slice(0, slash));
    patch("modelId", raw.slice(slash + 1));
  };

  return (
    <>
      <h2 className="set-panel-head">{t.tabAi}</h2>
      <Row label={t.baseUrl}>
        <input
          className="set-input"
          type="text"
          value={settings.baseUrl}
          placeholder="https://ai-gateway.kurogames.com"
          aria-label={t.baseUrl}
          onChange={(e) => {
            setVerifyResult(null);
            patch("baseUrl", e.target.value);
          }}
        />
      </Row>
      <Row label={t.apiKey}>
        <input
          className="set-input set-input-key"
          type="password"
          value={settings.apiKey}
          placeholder={t.apiKeyPlaceholder}
          aria-label={t.apiKey}
          onChange={(e) => {
            setVerifyResult(null);
            patch("apiKey", e.target.value);
          }}
        />
        <button
          className="set-verify"
          onClick={() => void verify()}
          disabled={verifying || !settings.apiKey.trim()}
        >
          {verifying ? t.verifying : t.verify}
        </button>
      </Row>
      {verifyResult && (
        <p
          className={`set-note ${verifyResult.ok ? "set-note-ok" : "set-note-error"}`}
        >
          {verifyResult.message}
        </p>
      )}

      <Row label={t.model}>
        <select
          className="set-select"
          value={current}
          onChange={(e) => onPick(e.target.value)}
        >
          <option value="">{t.modelDefault}</option>
          {groups.map((g) => (
            <optgroup key={g.providerName} label={g.providerName}>
              {g.models.map((m) => (
                <option
                  key={`${m.providerId}/${m.modelId}`}
                  value={`${m.providerId}/${m.modelId}`}
                >
                  {m.modelName}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Row>
      {failed && <p className="set-note set-note-error">{t.aiUnreachable}</p>}

      <Row label={t.yolo}>
        <Switch
          label={t.yolo}
          checked={settings.yolo}
          onChange={(v) => patch("yolo", v)}
        />
      </Row>
      <p className="set-note set-note-warn">{t.yoloWarn}</p>
    </>
  );
}

// --------------------------------------------------------------- 小组件

function WidgetTab({ settings, patch, t }: TabProps) {
  const [newTime, setNewTime] = useState("09:00");
  const [newPrompt, setNewPrompt] = useState("");
  const scaleFrame = useRef<number | null>(null);
  const scalePreviewValue = useRef(settings.petScale);

  useEffect(() => {
    return () => {
      if (scaleFrame.current !== null) {
        window.cancelAnimationFrame(scaleFrame.current);
      }
    };
  }, []);

  const tasks = settings.scheduledTasks;

  const addTask = () => {
    const prompt = newPrompt.trim();
    if (!prompt || !/^\d{2}:\d{2}$/.test(newTime)) return;
    patch("scheduledTasks", [
      ...tasks,
      {
        id: `task-${Date.now()}`,
        time: newTime,
        prompt,
        enabled: true,
      },
    ]);
    setNewPrompt("");
  };

  return (
    <>
      <h2 className="set-panel-head">{t.tabWidget}</h2>
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
      <Row label={t.alwaysOnTop}>
        <Switch
          label={t.alwaysOnTop}
          checked={settings.alwaysOnTop}
          onChange={(v) => patch("alwaysOnTop", v)}
        />
      </Row>

      <h3 className="set-section-head">{t.scheduledTasks}</h3>
      <p className="set-muted">{t.scheduledTasksHint}</p>

      {tasks.map((task) => (
        <div className="set-task" key={task.id}>
          <span className="set-task-time">{task.time}</span>
          <span className="set-task-prompt" title={task.prompt}>
            {task.prompt}
          </span>
          <Switch
            label={t.taskEnable(task.time)}
            checked={task.enabled}
            onChange={(v) =>
              patch(
                "scheduledTasks",
                tasks.map((x) => (x.id === task.id ? { ...x, enabled: v } : x)),
              )
            }
          />
          <button
            className="set-task-delete"
            aria-label={t.taskDelete}
            title={t.taskDelete}
            onClick={() =>
              patch(
                "scheduledTasks",
                tasks.filter((x) => x.id !== task.id),
              )
            }
          >
            ×
          </button>
        </div>
      ))}

      <div className="set-task set-task-new">
        <input
          className="set-input set-task-time-input"
          type="time"
          value={newTime}
          aria-label={t.taskTime}
          onChange={(e) => setNewTime(e.target.value)}
        />
        <input
          className="set-input set-task-prompt-input"
          type="text"
          value={newPrompt}
          placeholder={t.taskPromptPlaceholder}
          aria-label={t.taskPrompt}
          onChange={(e) => setNewPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addTask();
          }}
        />
        <button
          className="set-task-add"
          onClick={addTask}
          disabled={!newPrompt.trim()}
        >
          {t.taskAdd}
        </button>
      </div>
    </>
  );
}

// --------------------------------------------------------------- 快捷键

function ShortcutsTab({ settings, patch, t }: TabProps) {
  return (
    <>
      <h2 className="set-panel-head">{t.tabShortcuts}</h2>
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
  return (
    <>
      <h2 className="set-panel-head">{t.tabAccount}</h2>
      <Row label={t.userName}>
        <input
          className="set-input"
          type="text"
          value={settings.userName}
          placeholder={t.userNamePlaceholder}
          onChange={(e) => patch("userName", e.target.value)}
        />
      </Row>
      <Row label={t.persona}>
        <select
          className="set-select"
          aria-label={t.persona}
          value={personaId}
          onChange={(e) => patch("personaId", e.target.value)}
        >
          {PERSONAS.map((persona) => (
            <option key={persona.id} value={persona.id}>
              {personaLabel(persona, settings.language)}
            </option>
          ))}
        </select>
      </Row>
      <p className="set-note">{t.personaComing}</p>
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
      <p className="set-note">{t.renderTuningHint}</p>
    </>
  );
}

// ----------------------------------------------------------------- 关于

function AboutTab({ settings, patch, t }: TabProps) {
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
      <h2 className="set-panel-head">{t.tabAbout}</h2>
      <p className="set-about-name">deskmate</p>
      <p className="set-about-version">{version ? `v${version}` : "…"}</p>
      <p className="set-about-desc">{t.aboutDesc}</p>
      <p className="set-about-credits">{t.aboutCredits}</p>
      <Row label={t.updateRepo}>
        <input
          className="set-input"
          type="text"
          value={settings.updateRepo}
          placeholder="yourname/deskmate"
          aria-label={t.updateRepo}
          onChange={(e) => patch("updateRepo", e.target.value)}
        />
      </Row>
      <p className="set-note">GitHub 仓库(用户名/仓库名),用于检查更新。</p>
    </>
  );
}
