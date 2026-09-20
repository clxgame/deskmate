import { useEffect, useRef, useState } from "react";
import { getAppVersion } from "../lib/settings";
import {
  cancelUpdate,
  getUpdateStatus,
  updateApp,
  type UpdateEvent,
  type UpdateStatus,
} from "../lib/updater";
import type { Dict } from "../lib/i18n";
import { updateErrorMessage } from "./updateErrors";
import { initialUpdateState, reduceUpdateState, type UpdateAction } from "./updateState";

const defaultServices = { getAppVersion, updateApp, getUpdateStatus, cancelUpdate };

export function UpdateFooter({ repo, t, services = defaultServices }: {
  readonly repo: string;
  readonly t: Dict;
  readonly services?: typeof defaultServices;
}) {
  const [version, setVersion] = useState("");
  const [state, setState] = useState(initialUpdateState);
  const updateInFlight = useRef(false);

  const dispatch = (action: UpdateAction): void => {
    setState((current) => reduceUpdateState(current, action));
  };

  const applyStatus = (status: UpdateStatus): void => {
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
      void services.getUpdateStatus().then((status) => {
        // Older test doubles and partially upgraded IPC hosts can resolve an
        // unknown command without a payload. Keep the footer idle instead of
        // letting background polling disrupt the rest of Settings.
        if (!disposed && status) applyStatus(status);
      }, () => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [services]);

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
    if (updateInFlight.current) return;
    if (!repo.trim()) {
      dispatch({ type: "fail", message: t.updateNeedRepo });
      return;
    }
    updateInFlight.current = true;
    dispatch({ type: "check" });
    try {
      const outcome = await services.updateApp(repo, onEvent);
      if (outcome.status === "upToDate") dispatch({ type: "uptodate" });
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

  let status = t.updateHint;
  let statusClass = "set-footer-status";
  switch (state.kind) {
    case "idle": break;
    case "checking": status = t.updateChecking; break;
    case "downloading": status = `${t.updateUpdating}${state.percent === null ? "" : ` ${state.percent}%`}`; break;
    case "verifying": status = t.updateVerifying; break;
    case "waitingForIdle": status = state.canceling ? t.updateCanceling : t.updateWaitingForIdle; break;
    case "installing": status = t.updateInstalling; break;
    case "restarting": status = t.updateRestarting; break;
    case "uptodate": status = t.updateUpToDate; break;
    case "error": status = state.message; statusClass += " set-footer-error"; break;
    default: {
      const exhaustive: never = state;
      status = exhaustive;
    }
  }

  const isBusy = ["checking", "downloading", "verifying", "waitingForIdle", "installing", "restarting"]
    .includes(state.kind);
  return (
    <footer className="set-footer">
      <span className="set-footer-version">{version ? `v${version}` : ""}</span>
      <button className="set-footer-btn set-footer-btn-accent" disabled={isBusy}
        onClick={() => void onUpdate()}>{t.updateCheck}</button>
      {state.kind === "waitingForIdle" && (
        <button className="set-footer-btn" disabled={state.canceling}
          onClick={() => void onCancelWait()}>{t.updateCancelWait}</button>
      )}
      <span className={statusClass} title={status} role="status">{status}</span>
    </footer>
  );
}
