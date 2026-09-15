import { useEffect, useRef, useState } from "react";
import { getAppVersion } from "../lib/settings";
import { openUpdateDownload, updateApp, type UpdateEvent } from "../lib/updater";
import type { Dict } from "../lib/i18n";
import { updateErrorMessage } from "./updateErrors";
import {
  initialUpdateState,
  reduceUpdateState,
  type UpdateAction,
} from "./updateState";

const defaultServices = { getAppVersion, updateApp, openUpdateDownload };

export function UpdateFooter({ repo, t, services = defaultServices }: {
  readonly repo: string;
  readonly t: Dict;
  readonly services?: typeof defaultServices;
}) {
  const [version, setVersion] = useState("");
  const [state, setState] = useState(initialUpdateState);
  const updateInFlight = useRef(false);

  useEffect(() => {
    void services.getAppVersion().then(setVersion, (error: unknown) => {
      console.error("failed to load app version", error);
    });
  }, [services]);

  const dispatch = (action: UpdateAction): void => {
    setState((current) => reduceUpdateState(current, action));
  };

  const onEvent = (event: UpdateEvent): void => {
    switch (event.event) {
      case "checking":
        dispatch({ type: "check" });
        return;
      case "downloadStarted":
        dispatch({
          type: "downloadStarted",
          contentLength: event.data.contentLength,
        });
        return;
      case "downloadProgress":
        dispatch({
          type: "downloadProgress",
          downloaded: event.data.downloaded,
          contentLength: event.data.contentLength,
        });
        return;
      case "installing":
        dispatch({ type: "install" });
        return;
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
      switch (outcome.status) {
        case "available":
          dispatch({ type: "available", version: outcome.version, downloadUrl: outcome.downloadUrl });
          return;
        case "upToDate":
          dispatch({ type: "uptodate" });
          return;
        case "installed":
          dispatch({ type: "install" });
          return;
        default: {
          const exhaustive: never = outcome;
          return exhaustive;
        }
      }
    } catch (error: unknown) {
      dispatch({ type: "fail", message: updateErrorMessage(t, error) });
    } finally {
      updateInFlight.current = false;
    }
  };

  const onDownload = async (): Promise<void> => {
    if (state.kind !== "available" || updateInFlight.current) return;
    updateInFlight.current = true;
    dispatch({ type: "openDownload" });
    try {
      await services.openUpdateDownload(repo, state.downloadUrl);
      dispatch({ type: "downloadOpened" });
    } catch {
      dispatch({ type: "downloadFailed", message: t.updateOpenFailed });
    } finally {
      updateInFlight.current = false;
    }
  };

  let status = "";
  let statusClass = "set-footer-status";
  switch (state.kind) {
    case "idle":
      break;
    case "checking":
      status = t.updateChecking;
      break;
    case "available":
      status = state.openError ?? `${t.updateAvailable(state.version)} · ${t.updateManualInstall}`;
      if (state.openError) statusClass += " set-footer-error";
      break;
    case "downloading":
      status = `${t.updateUpdating}${state.percent === null ? "" : ` ${state.percent}%`}`;
      break;
    case "installing":
      status = t.updateUpdating;
      break;
    case "uptodate":
      status = t.updateUpToDate;
      break;
    case "error":
      status = state.message;
      statusClass += " set-footer-error";
      break;
    default: {
      const exhaustive: never = state;
      status = exhaustive;
    }
  }

  const isBusy =
    state.kind === "checking" || state.kind === "downloading" || state.kind === "installing"
    || (state.kind === "available" && state.opening);

  return (
    <footer className={`set-footer${state.kind === "available" ? " set-footer-available" : ""}`}>
      <span className="set-footer-version">{version ? `v${version}` : ""}</span>
      <button className="set-footer-btn" disabled={isBusy} onClick={() => void onUpdate()}>
        {t.updateCheck}
      </button>
      {state.kind === "available" && (
        <button className="set-footer-btn set-footer-btn-accent" disabled={state.opening} onClick={() => void onDownload()}>
          {t.updateDownload}
        </button>
      )}
      {status && <span className={statusClass} title={status} role="status">{status}</span>}
    </footer>
  );
}
