export type UpdateState =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | { readonly kind: "downloading"; readonly version: string; readonly percent: number | null }
  | { readonly kind: "verifying"; readonly version: string }
  | { readonly kind: "waitingForIdle"; readonly version: string; readonly canceling: boolean }
  | { readonly kind: "installing"; readonly version: string }
  | { readonly kind: "restarting"; readonly version: string }
  | { readonly kind: "uptodate" }
  | { readonly kind: "error"; readonly message: string };

export type UpdateAction =
  | { readonly type: "idle" }
  | { readonly type: "check" }
  | { readonly type: "download"; readonly version: string;
      readonly downloaded: number; readonly contentLength: number | null }
  | { readonly type: "verify"; readonly version: string }
  | { readonly type: "wait"; readonly version: string }
  | { readonly type: "cancelWait" }
  | { readonly type: "install"; readonly version: string }
  | { readonly type: "restart"; readonly version: string }
  | { readonly type: "uptodate" }
  | { readonly type: "fail"; readonly message: string };

export const initialUpdateState: UpdateState = { kind: "idle" };

export function reduceUpdateState(state: UpdateState, action: UpdateAction): UpdateState {
  switch (action.type) {
    case "idle": return { kind: "idle" };
    case "check": return { kind: "checking" };
    case "download": {
      const percent = action.contentLength === null || action.contentLength <= 0
        ? null
        : Math.min(100, Math.max(0, Math.round((action.downloaded / action.contentLength) * 100)));
      return { kind: "downloading", version: action.version, percent };
    }
    case "verify": return { kind: "verifying", version: action.version };
    case "wait": return { kind: "waitingForIdle", version: action.version, canceling: false };
    case "cancelWait":
      return state.kind === "waitingForIdle" ? { ...state, canceling: true } : state;
    case "install": return { kind: "installing", version: action.version };
    case "restart": return { kind: "restarting", version: action.version };
    case "uptodate": return { kind: "uptodate" };
    case "fail": return { kind: "error", message: action.message };
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
