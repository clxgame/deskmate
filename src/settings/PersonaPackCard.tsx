import type { Dict } from "../lib/i18n";
import { packLabel, type PackManifest } from "../pet/personaCatalog";
import {
  presentationFor,
  visiblePersonas,
  type PackActivity,
  type PackState,
} from "./personaPackModel";

type PackActionProps = {
  readonly state: PackState;
  readonly activity: PackActivity;
  readonly t: Dict;
  readonly onImport: () => void;
  readonly onUninstall: () => void;
};

export type PersonaPackCardProps = {
  readonly pack: PackManifest;
  readonly state: PackState;
  readonly activity: PackActivity;
  readonly language: string;
  readonly t: Dict;
  readonly onImport: () => void;
  readonly onUninstall: (pack: PackManifest) => void;
};

function assertNever(value: never): never {
  throw new TypeError(`Unhandled persona pack action: ${String(value)}`);
}

function PackGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4.5 7.5 12 3l7.5 4.5v9L12 21l-7.5-4.5z" />
      <path d="m4.8 7.7 7.2 4.2 7.2-4.2M12 12v8.5" />
    </svg>
  );
}

function PackAddGlyph() {
  return (
    <svg aria-hidden="true" className="set-pack-action-icon" viewBox="0 0 24 24">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function PackMinusGlyph() {
  return (
    <svg aria-hidden="true" className="set-pack-action-icon" viewBox="0 0 24 24">
      <path d="M5 12h14" />
    </svg>
  );
}

function PackAction({
  state,
  activity,
  t,
  onImport,
  onUninstall,
}: PackActionProps) {
  const busy = activity !== "idle";
  switch (state.kind) {
    case "builtin":
      return null;
    case "available":
      return (
        <button
          aria-label={activity === "import" ? t.packImporting : t.packImportLocal}
          className="set-btn set-pack-action set-pack-action-primary"
          type="button"
          onClick={onImport}
          disabled={busy}
          title={activity === "import" ? t.packImporting : t.packImportLocal}
        >
          <PackAddGlyph />
        </button>
      );
    case "installed":
      return (
        <button
          aria-label={activity === "uninstall" ? t.packUninstalling : t.packUninstall}
          className="set-btn set-pack-action set-pack-action-danger"
          type="button"
          onClick={onUninstall}
          disabled={busy}
          title={activity === "uninstall" ? t.packUninstalling : t.packUninstall}
        >
          <PackMinusGlyph />
        </button>
      );
    default:
      return assertNever(state);
  }
}

export function PersonaPackCard({
  pack,
  state,
  activity,
  language,
  t,
  onImport,
  onUninstall,
}: PersonaPackCardProps) {
  const personas = visiblePersonas(pack, state);
  const presentation = presentationFor(state, personas.length, t);
  const headingId = `persona-pack-${pack.packId}`;

  return (
    <article
      className={`set-pack set-pack-${state.kind}`}
      aria-labelledby={headingId}
      aria-describedby={`${headingId}-tooltip`}
    >
      <span
        className="set-pack-thumb"
        role="img"
        aria-label={packLabel(pack, language)}
        title={t.packThumbnailPlaceholder}
      >
        {pack.thumbnail === undefined ? (
          <PackGlyph />
        ) : (
          <img className="set-pack-thumb-image" src={pack.thumbnail} alt="" aria-hidden="true" />
        )}
      </span>
      <div className="set-pack-main">
        <div className="set-pack-title-row">
          <h4 className="set-pack-name" id={headingId}>
            {packLabel(pack, language)}
          </h4>
          <span className={`set-pack-status set-pack-status-${state.kind}`}>
            {presentation.status}
          </span>
        </div>
        <span className="set-pack-count" aria-label={presentation.count}>
          {personas.length}
        </span>
      </div>
      <PackAction
        state={state}
        activity={activity}
        t={t}
        onImport={onImport}
        onUninstall={() => onUninstall(pack)}
      />
      <span className="set-pack-tooltip" id={`${headingId}-tooltip`} role="tooltip">
        {presentation.description}
      </span>
    </article>
  );
}
