import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export function useHistoryOrganizerRequest(open: () => void): void {
  useEffect(() => {
    let closed = false;
    const reportFailure = (error: unknown) => {
      console.error("history organizer request failed", error instanceof Error ? error.message : String(error));
    };
    const consume = async () => {
      if (closed) return;
      try {
        const pending = await invoke<boolean>("consume_history_organizer_request");
        if (!closed && pending) open();
      } catch (error: unknown) {
        reportFailure(error);
      }
    };
    const subscription = listen("history://open", () => void consume());
    void subscription.then(() => { if (!closed) void consume(); }, reportFailure);
    return () => {
      closed = true;
      void subscription.then((off) => off(), reportFailure);
    };
  }, [open]);
}
