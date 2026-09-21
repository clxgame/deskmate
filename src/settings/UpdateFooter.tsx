import { useEffect, useRef, useState } from "react";
import { getAppVersion } from "../lib/settings";
import {
  cancelUpdate,
  checkUpdate,
  getUpdateStatus,
  updateApp,
  type UpdateEvent,
  type UpdateStatus,
} from "../lib/updater";
import type { Dict } from "../lib/i18n";
import { updateErrorMessage } from "./updateErrors";
import { initialUpdateState, reduceUpdateState, type UpdateAction } from "./updateState";

const defaultServices = { getAppVersion, checkUpdate, updateApp, getUpdateStatus, cancelUpdate };
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const FOCUS_CHECK_INTERVAL_MS = 60 * 1000;
const busyStatuses = ["checking", "downloading", "verifying", "waitingForIdle", "installing", "restarting"];

export function UpdateFooter({ repo, t, services = defaultServices }: {
  readonly repo: string;
  readonly t: Dict;
  readonly services?: typeof defaultServices;
}) {
  const [version, setVersion] = useState("");
  const [state, setState] = useState(initialUpdateState);
  const [available, setAvailable] = useState<{ repo: string; version: string } | null>(null);
  const [attempted, setAttempted] = useState(false);
  const updateInFlight = useRef(false);
  const backendBusy = useRef(false);
  const attempt = useRef(0);

  const dispatch = (action: UpdateAction): void => {
    setState((current) => reduceUpdateState(current, action));
  };

  const applyStatus = (status: UpdateStatus): void => {
    backendBusy.current = busyStatuses.includes(status.status);
    if (backendBusy.current) setAttempted(true);
    switch (status.status) {
      case "idle": dispatch({ type: "idle" }); return;
      case "checking": dispatch({ type: "check" }); return;
      case "downloading":
        dispatch({ type: "download", version: status.version, downloaded: status.downloaded,
          contentLength: status.contentLength }); return;
      case "verifying": dispatch({ type: "verify", version: status.version }); return;
      case "waitingForIdle": dispatch({ type: "wait", version: status.version }); return;
      case "installing": dispatch({ type: "install", version: status.version }); return;
      case "restarting": dispatch({ type: "restart", version: status.version }); return;
      case "upToDate": dispatch({ type: "uptodate" }); return;
      case "error": dispatch({ type: "fail", message: updateErrorMessage(t, status.code) }); return;
      default: {
        const exhaustive: never = status;
        return exhaustive;
      }
    }
  };

  useEffect(() => {
    let disposed = false;
    void services.getAppVersion().then((loaded) => { if (!disposed) setVersion(loaded); }, () => undefined);
    const refresh = (): void => {
      if (updateInFlight.current) return;
      const requestedAttempt = attempt.current;
      void services.getUpdateStatus().then((status) => {
        // Older test doubles and partially upgraded IPC hosts can resolve an
        // unknown command without a payload. Keep the footer idle instead of
        // letting background polling disrupt the rest of Settings.
        if (!disposed && status && !updateInFlight.current && requestedAttempt === attempt.current) {
          applyStatus(status);
        }
      }, () => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [services, t]);

  useEffect(() => {
    let disposed = false;
    let checking = false;
    let lastCheck = 0;
    setAvailable(null);
    const check = async (force = false): Promise<void> => {
      if (!repo.trim() || checking || updateInFlight.current || backendBusy.current || document.hidden) return;
      if (!force && Date.now() - lastCheck < FOCUS_CHECK_INTERVAL_MS) return;
      checking = true;
      lastCheck = Date.now();
      const requestedAttempt = attempt.current;
      try {
        const nextVersion = await services.checkUpdate(repo);
        if (!disposed && requestedAttempt === attempt.current) {
          setAvailable(nextVersion ? { repo, version: nextVersion } : null);
        }
      } catch {
        // Background failures stay quiet. A later focus, reconnect or timer retries.
        if (!disposed && requestedAttempt === attempt.current) setAvailable(null);
      } finally {
        checking = false;
      }
    };
    const onFocus = (): void => { void check(); };
    const onOnline = (): void => { void check(true); };
    void check(true);
    const timer = window.setInterval(() => { void check(true); }, CHECK_INTERVAL_MS);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [repo, services]);

  const onEvent = (event: UpdateEvent): void => {
    switch (event.event) {
      case "checking": dispatch({ type: "check" }); return;
      case "downloadStarted": dispatch({ type: "download", version: event.data.version,
        downloaded: 0, contentLength: event.data.contentLength }); return;
      case "downloadProgress": dispatch({ type: "download", version: event.data.version,
        downloaded: event.data.downloaded, contentLength: event.data.contentLength }); return;
      case "verifying": dispatch({ type: "verify", version: event.data.version }); return;
      case "waitingForIdle": dispatch({ type: "wait", version: event.data.version }); return;
      case "installing": dispatch({ type: "install", version: event.data.version }); return;
      case "restarting": dispatch({ type: "restart", version: event.data.version }); return;
      default: {
        const exhaustive: never = event;
        return exhaustive;
      }
    }
  };

  const onUpdate = async (): Promise<void> => {
    if (updateInFlight.current || available?.repo !== repo) return;
    if (!repo.trim()) {
      dispatch({ type: "fail", message: t.updateNeedRepo });
      return;
    }
    updateInFlight.current = true;
    attempt.current += 1;
    setAttempted(true);
    dispatch({ type: "check" });
    try {
      const outcome = await services.updateApp(repo, onEvent);
      if (outcome.status === "upToDate") {
        setAvailable(null);
        setAttempted(false);
        dispatch({ type: "uptodate" });
      }
      else dispatch({ type: "restart", version: outcome.version });
    } catch (error: unknown) {
      const raw = error instanceof Error ? error.message : error;
      if (raw === "in_progress") {
        try { applyStatus(await services.getUpdateStatus()); } catch { /* polling will retry */ }
      } else {
        dispatch({ type: "fail", message: updateErrorMessage(t, error) });
      }
    } finally {
      updateInFlight.current = false;
    }
  };

  const onCancelWait = async (): Promise<void> => {
    if (state.kind !== "waitingForIdle" || state.canceling) return;
    dispatch({ type: "cancelWait" });
    try {
      await services.cancelUpdate();
    } catch (error: unknown) {
      dispatch({ type: "fail", message: updateErrorMessage(t, error) });
    }
  };

  let status = "";
  let statusClass = "set-footer-status";
  switch (state.kind) {
    case "idle": break;
    case "checking": status = t.updateChecking; break;
    case "downloading": status = `${t.updateUpdating}${state.percent === null ? "" : ` ${state.percent}%`}`; break;
    case "verifying": status = t.updateVerifying; break;
    case "waitingForIdle": status = state.canceling ? t.updateCanceling : t.updateWaitingForIdle; break;
    case "installing": status = t.updateInstalling; break;
    case "restarting": status = t.updateRestarting; break;
    case "uptodate": break;
    case "error": status = state.message; statusClass += " set-footer-error"; break;
    default: {
      const exhaustive: never = state;
      status = exhaustive;
    }
  }

  const isBusy = busyStatuses.includes(state.kind);
  return (
    <footer className="set-footer">
      <span className="set-footer-version">{version ? `v${version}` : ""}</span>
      {(available?.repo === repo || isBusy) && (
        <button className="set-footer-btn set-footer-btn-accent" disabled={isBusy}
          onClick={() => void onUpdate()}>{t.updateCheck}</button>
      )}
      {state.kind === "waitingForIdle" && (
        <button className="set-footer-btn" disabled={state.canceling}
          onClick={() => void onCancelWait()}>{t.updateCancelWait}</button>
      )}
      {attempted && status && (
        <span className={statusClass} title={status} role="status">{status}</span>
      )}
    </footer>
  );
}
