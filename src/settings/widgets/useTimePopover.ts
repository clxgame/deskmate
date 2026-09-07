import { useLayoutEffect, useRef, type RefObject } from "react";

interface TimePopoverOptions {
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly onDismiss: (restoreFocus: boolean) => void;
}

export function useTimePopover({ triggerRef, onDismiss }: TimePopoverOptions) {
  const popupRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const popup = popupRef.current;
    const trigger = triggerRef.current;
    if (popup === null || trigger === null) return;
    popup.showPopover();
    const position = () => {
      const gutter = Number.parseFloat(getComputedStyle(popup).getPropertyValue("--time-picker-viewport-gutter")) || 12;
      const gap = Number.parseFloat(getComputedStyle(popup).getPropertyValue("--s-2")) || 8;
      const anchor = trigger.getBoundingClientRect();
      const bounds = popup.getBoundingClientRect();
      const left = Math.max(gutter, Math.min(anchor.left, window.innerWidth - bounds.width - gutter));
      const below = anchor.bottom + gap;
      const preferredTop = below + bounds.height <= window.innerHeight - gutter
        ? below : anchor.top - bounds.height - gap;
      const top = Math.max(gutter, Math.min(preferredTop, window.innerHeight - bounds.height - gutter));
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
    };
    position();
    popup.querySelector<HTMLElement>("[role=listbox]")?.focus();
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !popup.contains(event.target) && !trigger.contains(event.target)) {
        onDismiss(false);
      }
    };
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onDismiss(true);
      }
    };
    const dismissAfterFocusLeaves = (event: FocusEvent) => {
      if (event.target instanceof Node && !popup.contains(event.target)) onDismiss(false);
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("keydown", dismissOnEscape, true);
    document.addEventListener("focusin", dismissAfterFocusLeaves);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("keydown", dismissOnEscape, true);
      document.removeEventListener("focusin", dismissAfterFocusLeaves);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      popup.hidePopover();
    };
  }, [onDismiss, triggerRef]);
  return popupRef;
}
