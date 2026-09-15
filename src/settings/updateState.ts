export type UpdateState =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | {
      readonly kind: "available";
      readonly version: string;
      readonly downloadUrl: string;
      readonly opening: boolean;
      readonly openError: string | null;
    }
  | { readonly kind: "downloading"; readonly percent: number | null }
  | { readonly kind: "installing" }
  | { readonly kind: "uptodate" }
  | { readonly kind: "error"; readonly message: string };

export type UpdateAction =
  | { readonly type: "check" }
  | { readonly type: "available"; readonly version: string; readonly downloadUrl: string }
  | { readonly type: "openDownload" }
  | { readonly type: "downloadOpened" }
  | { readonly type: "downloadFailed"; readonly message: string }
  | { readonly type: "downloadStarted"; readonly contentLength: number | null }
  | {
      readonly type: "downloadProgress";
      readonly downloaded: number;
      readonly contentLength: number | null;
    }
  | { readonly type: "install" }
  | { readonly type: "uptodate" }
  | { readonly type: "fail"; readonly message: string };

export const initialUpdateState: UpdateState = { kind: "idle" };

export function reduceUpdateState(
  state: UpdateState,
  action: UpdateAction,
): UpdateState {
  switch (action.type) {
    case "check":
      return { kind: "checking" };
    case "available":
      return { kind: "available", version: action.version, downloadUrl: action.downloadUrl,
        opening: false, openError: null };
    case "openDownload":
      return state.kind === "available" ? { ...state, opening: true, openError: null } : state;
    case "downloadOpened":
      return state.kind === "available" ? { ...state, opening: false } : state;
    case "downloadFailed":
      return state.kind === "available"
        ? { ...state, opening: false, openError: action.message } : state;
    case "downloadStarted":
      return {
        kind: "downloading",
        percent: action.contentLength === null ? null : 0,
      };
    case "downloadProgress": {
      const percent =
        action.contentLength === null || action.contentLength <= 0
          ? null
          : Math.min(
              100,
              Math.max(
                0,
                Math.round((action.downloaded / action.contentLength) * 100),
              ),
            );
      return { kind: "downloading", percent };
    }
    case "install":
      return { kind: "installing" };
    case "uptodate":
      return { kind: "uptodate" };
    case "fail":
      return { kind: "error", message: action.message };
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
