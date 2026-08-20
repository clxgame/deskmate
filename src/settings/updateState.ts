export type UpdateState =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | { readonly kind: "downloading"; readonly percent: number | null }
  | { readonly kind: "installing" }
  | { readonly kind: "uptodate" }
  | { readonly kind: "error"; readonly message: string };

export type UpdateAction =
  | { readonly type: "check" }
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
  _state: UpdateState,
  action: UpdateAction,
): UpdateState {
  switch (action.type) {
    case "check":
      return { kind: "checking" };
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
