import { useCallback, useEffect, useRef, useState } from "react";
import {
  getPomodoro, onPomodoroChanged,
  type PomodoroSnapshot,
} from "../../lib/pomodoro";

export function usePomodoro() {
  const [snapshot, setSnapshot] = useState<PomodoroSnapshot | null>(null);
  const [readError, setReadError] = useState<Error | null>(null);
  const [commandError, setCommandError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const current = useRef<PomodoroSnapshot | null>(null);
  const generation = useRef(0);
  const commandEpoch = useRef(0);
  const readSequence = useRef(0);
  const pendingRead = useRef<number | null>(null);
  const commandBusy = useRef(false);

  const accept = useCallback((next: PomodoroSnapshot) => {
    if (current.current && next.revision < current.current.revision) return;
    current.current = next;
    setSnapshot(next);
    setReadError(null);
  }, []);

  const refresh = useCallback(async () => {
    if (commandBusy.current || pendingRead.current !== null) return;
    const mountedAt = generation.current;
    const epoch = commandEpoch.current;
    const readId = ++readSequence.current;
    pendingRead.current = readId;
    try {
      const next = await getPomodoro();
      if (generation.current === mountedAt && epoch === commandEpoch.current) accept(next);
    } catch (cause) {
      if (generation.current === mountedAt && epoch === commandEpoch.current) {
        setReadError(cause instanceof Error ? cause : new Error(String(cause)));
      }
    } finally {
      if (pendingRead.current === readId) pendingRead.current = null;
    }
  }, [accept]);

  useEffect(() => {
    const mountedAt = ++generation.current;
    let unsubscribe: (() => void) | undefined;
    setReadError(null);
    setCommandError(null);
    void refresh();
    void onPomodoroChanged((next) => {
      if (generation.current !== mountedAt) return;
      if (current.current === null || next.revision > current.current.revision) accept(next);
    }, (cause) => {
      if (generation.current === mountedAt) setReadError(cause);
    }).then((stop) => {
      if (generation.current === mountedAt) unsubscribe = stop;
      else stop();
    }).catch((cause: unknown) => {
      if (generation.current === mountedAt) {
        setReadError(cause instanceof Error ? cause : new Error(String(cause)));
      }
    });
    const refreshVisible = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    const interval = window.setInterval(refreshVisible, 1000);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      generation.current += 1;
      pendingRead.current = null;
      commandBusy.current = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshVisible);
      unsubscribe?.();
    };
  }, [accept, attempt, refresh]);

  const run = useCallback(async (operation: () => Promise<PomodoroSnapshot>) => {
    if (commandBusy.current) return;
    const mountedAt = generation.current;
    commandBusy.current = true;
    commandEpoch.current += 1;
    setBusy(true);
    setReadError(null);
    try {
      const next = await operation();
      if (generation.current === mountedAt) {
        accept(next);
        setCommandError(null);
      }
    } catch (cause) {
      if (generation.current === mountedAt) {
        setCommandError(cause instanceof Error ? cause : new Error(String(cause)));
      }
    } finally {
      if (generation.current === mountedAt) {
        commandBusy.current = false;
        setBusy(false);
      }
    }
  }, [accept]);

  return { snapshot, error: commandError ?? readError, busy, run, retry: () => setAttempt((value) => value + 1) };
}
