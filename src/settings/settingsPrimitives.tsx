import type { ReactNode } from "react";
import type { Settings } from "../lib/settings";
import type { Dict } from "../lib/i18n";

export type Patch = <K extends keyof Settings>(key: K, value: Settings[K]) => void;
export type ReplaceSettings = (settings: Settings) => void;
export type PersistSettings = (settings: Settings) => Promise<void>;

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

export function BentoCard({
  title,
  description,
  badge,
  action,
  children,
  className,
}: {
  readonly title?: string;
  readonly description?: string;
  readonly badge?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const cardClassName = className === undefined ? "set-bento-card" : `set-bento-card ${className}`;
  return (
    <section className={cardClassName}>
      {(title || description || action || badge) && (
        <header className="set-bento-head">
          <div className="set-bento-title-row">
            <div className="set-bento-title-wrap">
              {title && <h3 className="set-bento-title">{title}</h3>}
              {badge && <span className="set-bento-badge">{badge}</span>}
            </div>
            {action && <div className="set-bento-action">{action}</div>}
          </div>
          {description && <p className="set-bento-desc">{description}</p>}
        </header>
      )}
      <div className="set-bento-body">{children}</div>
    </section>
  );
}
