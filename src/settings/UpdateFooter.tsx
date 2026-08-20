import { useEffect, useRef, useState } from "react";
import { getAppVersion } from "../lib/settings";
import { updateApp, type UpdateEvent } from "../lib/updater";
import type { Dict } from "../lib/i18n";
import {
  initialUpdateState,
  reduceUpdateState,
  type UpdateAction,
} from "./updateState";

function updateErrorMessage(t: Dict, error: Error | string): string {
  const raw = error instanceof Error ? error.message : error;
  const code = raw.replace(/^Error:?\s*/i, "");
  return code === "invalid_repo" || code === "placeholder"
    ? t.updateNeedRepo
    : t.updateError;
}

export function UpdateFooter({ repo, t }: { readonly repo: string; readonly t: Dict }) {
  const [version, setVersion] = useState("");
  const [state, setState] = useState(initialUpdateState);
  const updateInFlight = useRef(false);

  useEffect(() => {
    void getAppVersion().then(setVersion, (error: unknown) => {
      console.error("failed to load app version", error);
    });
  }, []);

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
      const outcome = await updateApp(repo, onEvent);
      switch (outcome.status) {
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
      if (error instanceof Error || typeof error === "string") {
        dispatch({ type: "fail", message: updateErrorMessage(t, error) });
        return;
      }
      dispatch({ type: "fail", message: t.updateError });
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
    state.kind === "checking" || state.kind === "downloading" || state.kind === "installing";

  return (
    <footer className="set-footer">
      <span className="set-footer-version">{version ? `v${version}` : ""}</span>
      {status && <span className={statusClass}>{status}</span>}
      {!isBusy && (
        <button className="set-footer-btn" onClick={() => void onUpdate()}>
          {t.updateCheck}
        </button>
      )}
    </footer>
  );
}
