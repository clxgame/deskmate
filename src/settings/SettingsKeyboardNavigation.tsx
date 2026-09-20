import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

function getSettingsTabs(): readonly HTMLButtonElement[] {
  return Array.from(document.querySelectorAll(".set-tab")).filter(
    (element): element is HTMLButtonElement => element instanceof HTMLButtonElement,
  );
}

function hasMeaningfulDocumentFocus(): boolean {
  const activeElement = document.activeElement;
  return (
    activeElement instanceof HTMLElement &&
    activeElement !== document.body &&
    activeElement !== document.documentElement
  );
}

function focusActiveSettingsTab(): void {
  globalThis.setTimeout(() => {
    if (hasMeaningfulDocumentFocus()) return;
    const activeTab = document.querySelector(".set-tab-active");
    if (activeTab instanceof HTMLButtonElement) {
      activeTab.focus();
      return;
    }
    getSettingsTabs()[0]?.focus();
  }, 0);
}

function focusElement(selector: string): boolean {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) return false;
  element.focus();
  return true;
}

function clickAndFocusElement(selector: string): boolean {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLButtonElement)) return false;
  element.click();
  element.focus();
  return true;
}

function logNavigationError(error: unknown): void {
  console.error(error instanceof Error ? error : new Error(String(error)));
}

function hasOpenModal(): boolean {
  const modals = document.querySelectorAll<HTMLElement>(
    'dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
  );
  return Array.from(modals).some((modal) => {
    for (let element: HTMLElement | null = modal; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (element.hidden || element.getAttribute("aria-hidden") === "true" ||
          style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
  });
}

export function SettingsKeyboardNavigation() {
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged((event) => {
      if (event.payload) {
        focusActiveSettingsTab();
      }
    });

    return () => {
      void unlisten.then((stopListening) => stopListening()).catch(logNavigationError);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (hasOpenModal()) return;
      if (event.shiftKey) {
        const key = event.key.toLowerCase();
        const handled =
          (key === "b" && focusElement(".set-ai-base-url")) ||
          (key === "v" && clickAndFocusElement(".set-verify")) ||
          (key === "c" && clickAndFocusElement(".set-ccswitch-action"));
        if (!handled) return;
        event.preventDefault();
        return;
      }
      const tabIndex = Number.parseInt(event.key, 10) - 1;
      const tab = getSettingsTabs()[tabIndex];
      if (tab === undefined) return;
      event.preventDefault();
      tab.click();
      tab.focus();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return null;
}
