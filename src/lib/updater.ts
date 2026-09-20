import { Channel, invoke } from "@tauri-apps/api/core";

export type UpdateEvent =
  | { readonly event: "checking" }
  | { readonly event: "downloadStarted"; readonly data: {
      readonly version: string; readonly contentLength: number | null;
    } }
  | { readonly event: "downloadProgress"; readonly data: {
      readonly version: string; readonly downloaded: number; readonly contentLength: number | null;
    } }
  | { readonly event: "verifying"; readonly data: { readonly version: string } }
  | { readonly event: "waitingForIdle"; readonly data: { readonly version: string } }
  | { readonly event: "installing"; readonly data: { readonly version: string } }
  | { readonly event: "restarting"; readonly data: { readonly version: string } };

export type UpdateStatus =
  | { readonly status: "idle" }
  | { readonly status: "checking" }
  | { readonly status: "downloading"; readonly version: string;
      readonly downloaded: number; readonly contentLength: number | null }
  | { readonly status: "verifying"; readonly version: string }
  | { readonly status: "waitingForIdle"; readonly version: string }
  | { readonly status: "installing"; readonly version: string }
  | { readonly status: "restarting"; readonly version: string }
  | { readonly status: "upToDate"; readonly currentVersion: string }
  | { readonly status: "error"; readonly code: string };

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

export function getUpdateStatus(): Promise<UpdateStatus> {
  return invoke<UpdateStatus>("update_status");
}

export function cancelUpdate(): Promise<void> {
  return invoke<void>("cancel_update");
}
