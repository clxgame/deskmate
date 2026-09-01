import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

function hasMeaningfulDocumentFocus(): boolean {
  const activeElement = document.activeElement;
  return (
    activeElement instanceof HTMLElement &&
    activeElement !== document.body &&
    activeElement !== document.documentElement
  );
}

function focusChatInput(): void {
  globalThis.setTimeout(() => {
    if (hasMeaningfulDocumentFocus()) return;
    const input = document.querySelector(".chat-input");
    if (input instanceof HTMLTextAreaElement) {
      input.focus();
    }
  }, 0);
}

function logNavigationError(error: unknown): void {
  console.error(error instanceof Error ? error : new Error(String(error)));
}

export function ChatKeyboardNavigation() {
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged((event) => {
      if (event.payload) {
        focusChatInput();
      }
    });

    return () => {
      void unlisten.then((stopListening) => stopListening()).catch(logNavigationError);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        void invoke("open_settings").catch(logNavigationError);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return null;
}
