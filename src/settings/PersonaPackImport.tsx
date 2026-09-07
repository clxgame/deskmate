import type { Dict } from "../lib/i18n";
import { AppIcon } from "../ui/AppIcon";
import type { PackActivity } from "./personaPackModel";
import { alignPackTooltip } from "./alignPackTooltip";

type PersonaPackImportProps = {
  readonly activity: PackActivity;
  readonly t: Dict;
  readonly onImport: () => void;
};

export function PersonaPackImport({ activity, t, onImport }: PersonaPackImportProps) {
  const label = activity === "import" ? t.packImporting : t.packImportLocal;
  return (
    <article className="set-pack set-pack-available set-pack-empty"
      aria-label={t.packImportLocal} aria-describedby="persona-pack-import-tooltip"
      onPointerEnter={alignPackTooltip} onFocus={alignPackTooltip}>
      <button aria-label={label} title={label} type="button"
        className="set-btn set-pack-action set-pack-action-primary"
        onClick={onImport} disabled={activity !== "idle"}>
        <AppIcon name="add" size={24} className="set-pack-action-icon" />
      </button>
      <span className="set-pack-tooltip" id="persona-pack-import-tooltip" role="tooltip">
        {t.packOfflineDescription}
      </span>
    </article>
  );
}
