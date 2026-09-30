import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { ThemeId } from "../settings/theme";

type Props = {
  readonly trigger: RefObject<HTMLButtonElement | null>;
  readonly anchor: RefObject<HTMLElement | null>;
  readonly theme: ThemeId;
  readonly align?: "start" | "end";
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly label: string;
};

export function ComposerPopover({ trigger, anchor, theme, align = "start", onClose, children, label }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({ left: 8, bottom: 8, width: 280, maxHeight: 300 });
  const update = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    const boundary = anchor.current?.getBoundingClientRect();
    if (!rect || !boundary) return;
    const width = Math.max(0, Math.min(320, window.innerWidth - 16));
    const next = {
      left: Math.max(8, Math.min(align === "end" ? rect.right - width : rect.left, window.innerWidth - width - 8)),
      bottom: window.innerHeight - boundary.top + 8,
      width, maxHeight: Math.max(0, Math.min(360, boundary.top - 16)),
    };
    setPlacement(current => current.left === next.left && current.bottom === next.bottom
      && current.width === next.width && current.maxHeight === next.maxHeight ? current : next);
  }, [trigger, anchor, align]);
  // Content and notices can move the anchor without changing the viewport.
  useLayoutEffect(update);
  useLayoutEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    for (const element of [anchor.current, trigger.current, anchor.current?.parentElement]) {
      if (element) observer.observe(element);
    }
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
    };
  }, [anchor, trigger, update]);
  useEffect(() => {
    const first = panel.current?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)");
    (first ?? panel.current)?.focus();
  }, []);
  useEffect(() => {
    const closeOnOutside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", closeOnOutside);
    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, [onClose, trigger]);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      trigger.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const items = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      if (items[next]) {
        event.preventDefault();
        items[next].focus();
      }
    } else if (event.key === "Enter") {
      event.stopPropagation();
    }
  };
  return createPortal(
    <div ref={panel} className="composer-popover" data-theme={theme} role="menu" aria-label={label} tabIndex={-1}
      style={{ left: placement.left, bottom: placement.bottom, width: placement.width, maxHeight: placement.maxHeight }}
      onKeyDown={keyDown}>{children}</div>, document.body,
  );
}
