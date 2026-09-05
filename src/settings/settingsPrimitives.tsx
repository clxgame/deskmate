import type { ReactNode } from "react";
import type { Settings } from "../lib/settings";
import type { Dict } from "../lib/i18n";

export type Patch = <K extends keyof Settings>(key: K, value: Settings[K]) => void;

export interface TabProps {
  readonly settings: Settings;
  readonly patch: Patch;
  readonly t: Dict;
}

interface RowProps {
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string;
}

export function Row({ label, children, className }: RowProps) {
  const rowClassName = className === undefined ? "set-row" : `set-row ${className}`;
  return (
    <div className={rowClassName}>
      <span className="set-row-label">{label}</span>
      <div className="set-row-control">{children}</div>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  readonly checked: boolean;
  readonly onChange: (value: boolean) => void;
  readonly label: string;
}) {
  return (
    <label className="set-switch">
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="set-switch-track" />
    </label>
  );
}
