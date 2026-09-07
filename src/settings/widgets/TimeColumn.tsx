import { useEffect, useId, useRef, type KeyboardEvent } from "react";

interface TimeColumnProps {
  readonly label: string;
  readonly count: number;
  readonly value: number;
  readonly onChange: (value: number) => void;
}

export function TimeColumn({ label, count, value, onChange }: TimeColumnProps) {
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.getElementById(`${id}-${value}`)?.scrollIntoView({ block: "nearest" });
  }, [id, value]);
  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = {
      ArrowDown: (value + 1) % count,
      ArrowUp: (value + count - 1) % count,
      Home: 0,
      End: count - 1,
    }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      onChange(next);
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const columns = event.currentTarget.closest(".set-time-picker-columns");
      const following = event.currentTarget.parentElement?.nextElementSibling?.querySelector<HTMLElement>("[role=listbox]");
      const confirm = columns?.parentElement?.querySelector<HTMLElement>(".set-time-picker-confirm");
      (following ?? confirm)?.focus();
    }
  };
  return (
    <div className="set-time-picker-column">
      <span id={`${id}-label`} className="set-time-picker-label">{label}</span>
      <div className="set-time-picker-list" role="listbox" ref={listRef} tabIndex={0}
        aria-labelledby={`${id}-label`} aria-activedescendant={`${id}-${value}`} onKeyDown={handleKey}>
        {Array.from({ length: count }, (_, option) => (
          <button key={option} id={`${id}-${option}`} type="button" role="option" tabIndex={-1}
            aria-selected={value === option} className="set-time-picker-option"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => { onChange(option); listRef.current?.focus(); }}>
            {String(option).padStart(2, "0")}
          </button>
        ))}
      </div>
    </div>
  );
}
