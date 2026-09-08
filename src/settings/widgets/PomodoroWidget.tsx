import { useEffect, useId, useRef, useState } from "react";
import {
  DEFAULT_POMODORO_PREFERENCES, pausePomodoro, resetPomodoro,
  selectPomodoroPhase, startPomodoro, type PomodoroPreferences,
} from "../../lib/pomodoro";
import { AppIcon } from "../../ui/AppIcon";
import { PomodoroCountdown } from "../../ui/PomodoroCountdown";
import type { TabProps } from "../settingsPrimitives";
import { usePomodoro } from "./usePomodoro";
import "./pomodoro.css";

export function PomodoroWidget({ settings, patch, t }: TabProps) {
  const timer = usePomodoro();
  const id = useId();
  const saved = settings.pomodoro ?? DEFAULT_POMODORO_PREFERENCES;
  const expectedPreferences = useRef(saved);
  const [draft, setDraft] = useState({ focusMinutes: String(saved.focusMinutes), breakMinutes: String(saved.breakMinutes) });
  useEffect(() => {
    const expected = expectedPreferences.current;
    if (saved.focusMinutes !== expected.focusMinutes || saved.breakMinutes !== expected.breakMinutes) {
      setDraft({ focusMinutes: String(saved.focusMinutes), breakMinutes: String(saved.breakMinutes) });
      expectedPreferences.current = saved;
    }
  }, [saved]);
  const preferences: PomodoroPreferences = {
    focusMinutes: Number(draft.focusMinutes), breakMinutes: Number(draft.breakMinutes),
  };
  const valid = Number.isInteger(preferences.focusMinutes) && preferences.focusMinutes >= 1
    && preferences.focusMinutes <= 180 && Number.isInteger(preferences.breakMinutes)
    && preferences.breakMinutes >= 1 && preferences.breakMinutes <= 60;
  const snapshot = timer.snapshot;
  const status = snapshot?.status ?? "idle";
  const phase = snapshot?.phase ?? "focus";
  const editable = { idle: true, running: false, paused: false, ready: true }[status];
  const activeAction = {
    idle: { label: t.pomodoroStart, icon: "play", run: () => startPomodoro(preferences) },
    running: { label: t.pomodoroPause, icon: "pause", run: pausePomodoro },
    paused: { label: t.pomodoroResume, icon: "play", run: () => startPomodoro(preferences) },
    ready: { label: t.pomodoroStart, icon: "play", run: () => startPomodoro(preferences) },
  } as const;
  const statusText = {
    idle: t.pomodoroIdle, running: t.pomodoroRunning, paused: t.pomodoroPaused,
    ready: { focus: t.pomodoroReadyFocus, break: t.pomodoroReadyBreak }[phase],
  }[status];
  const action = activeAction[status];
  const available = snapshot !== null && !timer.busy && valid;
  function edit(field: keyof PomodoroPreferences, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    const minutes = Number(value);
    const limit = { focusMinutes: 180, breakMinutes: 60 }[field];
    if (Number.isInteger(minutes) && minutes >= 1 && minutes <= limit) {
      const next = { ...saved, [field]: minutes };
      expectedPreferences.current = next;
      patch("pomodoro", next);
    }
  }

  return (
    <section className="set-pomodoro" aria-labelledby={`${id}-title`} aria-busy={timer.busy}>
      <h3 id={`${id}-title`}>{t.pomodoroTitle}</h3>
      <div className="set-pomodoro-phases" role="group" aria-label={t.pomodoroPhase}>
        {(["focus", "break"] as const).map((value) => (
          <button key={value} type="button" className="set-btn" aria-pressed={phase === value}
            disabled={!available} onClick={() => void timer.run(() => selectPomodoroPhase(value, preferences))}>
            {{ focus: t.pomodoroFocus, break: t.pomodoroBreak }[value]}
          </button>
        ))}
      </div>
      <div className="set-pomodoro-countdown" role="timer" aria-label={t.pomodoroRemaining}>
        <PomodoroCountdown remainingMs={snapshot?.remainingMs ?? null} />
      </div>
      <p className="set-pomodoro-status" role="status">
        {timer.busy ? t.pomodoroBusy : snapshot === null ? t.pomodoroLoading : statusText}
      </p>
      <div className="set-pomodoro-actions">
        <button type="button" className="set-btn set-pomodoro-primary" disabled={!available}
          onClick={() => void timer.run(action.run)}>
          <AppIcon name={action.icon} size={16} />{action.label}
        </button>
        <button type="button" className="set-btn" disabled={snapshot === null || timer.busy}
          onClick={() => void timer.run(resetPomodoro)}>
          <AppIcon name="reset" size={16} />{t.pomodoroReset}
        </button>
      </div>
      <div className="set-pomodoro-preferences">
        {(["focusMinutes", "breakMinutes"] as const).map((field) => (
          <label key={field} htmlFor={`${id}-${field}`}>
            <span>{{ focusMinutes: t.pomodoroFocusMinutes, breakMinutes: t.pomodoroBreakMinutes }[field]}</span>
            <input id={`${id}-${field}`} className="set-input" type="number" inputMode="numeric"
              min={1} max={{ focusMinutes: 180, breakMinutes: 60 }[field]} step={1} value={draft[field]}
              disabled={!editable || timer.busy || snapshot === null} aria-invalid={!valid}
              aria-describedby={!valid ? `${id}-validation` : undefined}
              onChange={(event) => edit(field, event.currentTarget.value)} />
          </label>
        ))}
      </div>
      {!valid && <p id={`${id}-validation`} className="set-pomodoro-error" role="alert">{t.pomodoroInvalidPreferences}</p>}
      {timer.error !== null && <div className="set-pomodoro-error" role="alert">
        <span>{t.pomodoroError}</span>
        <button type="button" className="set-btn" disabled={timer.busy} onClick={timer.retry}>{t.pomodoroRetry}</button>
      </div>}
      <p className="set-pomodoro-hint">{t.pomodoroHint}</p>
    </section>
  );
}
