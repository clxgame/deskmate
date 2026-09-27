import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

type Props = {
  readonly trigger: RefObject<HTMLButtonElement | null>;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly label: string;
};

export function ComposerPopover({ trigger, onClose, children, label }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({ left: 8, bottom: 8, width: 280, maxHeight: 300 });
  useLayoutEffect(() => {
    const update = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 16);
      setPlacement({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        bottom: window.innerHeight - rect.top + 6,
        width, maxHeight: Math.max(88, rect.top - 16),
      });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [trigger]);
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
    <div ref={panel} className="composer-popover" role="menu" aria-label={label} tabIndex={-1}
      style={{ left: placement.left, bottom: placement.bottom, width: placement.width, maxHeight: placement.maxHeight }}
      onKeyDown={keyDown}>{children}</div>, document.body,
  );
}
