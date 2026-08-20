import { Channel, invoke } from "@tauri-apps/api/core";

export type UpdateEvent =
  | { readonly event: "checking" }
  | {
      readonly event: "downloadStarted";
      readonly data: {
        readonly version: string;
        readonly contentLength: number | null;
      };
    }
  | {
      readonly event: "downloadProgress";
      readonly data: {
        readonly downloaded: number;
        readonly contentLength: number | null;
      };
    }
  | {
      readonly event: "installing";
      readonly data: { readonly version: string };
    };

export type UpdateOutcome =
  | { readonly status: "upToDate"; readonly currentVersion: string }
  | { readonly status: "installed"; readonly version: string };

export function updateApp(
  repo: string,
  onEvent: (event: UpdateEvent) => void,
): Promise<UpdateOutcome> {
  const channel = new Channel<UpdateEvent>(onEvent);
  return invoke<UpdateOutcome>("update_app", { repo, onEvent: channel });
}
