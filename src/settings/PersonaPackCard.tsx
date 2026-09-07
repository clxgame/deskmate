import type { Dict } from "../lib/i18n";
import { packLabel, type PackManifest } from "../pet/personaCatalog";
import { AppIcon } from "../ui/AppIcon";
import type { PackActivity } from "./personaPackModel";
import { alignPackTooltip } from "./alignPackTooltip";

export type PersonaPackCardProps = {
  readonly pack: PackManifest;
  readonly selected: boolean;
  readonly activity: PackActivity;
  readonly language: string;
  readonly t: Dict;
  readonly onSelect: (pack: PackManifest) => void;
  readonly onUninstall: (pack: PackManifest) => void;
};

export function PersonaPackCard({
  pack, selected, activity, language, t, onSelect, onUninstall,
}: PersonaPackCardProps) {
  const kind = pack.builtin ? "builtin" : "installed";
  const headingId = "persona-pack-heading-" + pack.packId;
  const tooltipId = "persona-pack-tooltip-" + pack.packId;
  const name = packLabel(pack, language);
  const description = pack.builtin ? t.packBuiltinDescription : t.packOfflineDescription;
  const uninstallLabel = activity === "uninstall" ? t.packUninstalling : t.packUninstall;

  return (
    <article className={"set-pack set-pack-" + kind + (selected ? " set-pack-selected" : "")}
      aria-labelledby={headingId} aria-describedby={tooltipId}
      onPointerEnter={alignPackTooltip} onFocus={alignPackTooltip}>
      <button className="set-pack-select" type="button" aria-label={name}
        aria-pressed={selected} aria-controls="active-persona"
        aria-describedby={tooltipId} disabled={activity !== "idle"}
        onClick={() => onSelect(pack)} />
      <span className="set-pack-thumb" role="img" aria-label={name}>
        {pack.thumbnail === undefined ? <AppIcon name="pack" size={24} /> : (
          <img className="set-pack-thumb-image" src={pack.thumbnail} alt="" aria-hidden="true" />
        )}
      </span>
      <div className="set-pack-main">
        <div className="set-pack-title-row">
          <h4 className="set-pack-name" id={headingId} title={name}>{name}</h4>
          <span className={"set-pack-status set-pack-status-" + kind}>
            {pack.builtin ? t.packBuiltin : t.packInstalledVersion(pack.version)}
          </span>
        </div>
        <span className="set-pack-count" aria-label={t.packAvailablePersonas(pack.personas.length)}>
          {pack.personas.length}
        </span>
      </div>
      {!pack.builtin && (
        <button aria-label={uninstallLabel} title={uninstallLabel} type="button"
          className="set-btn set-pack-action set-pack-action-danger"
          onClick={() => onUninstall(pack)} disabled={activity !== "idle"}>
          <AppIcon name="delete" size={20} className="set-pack-action-icon" />
        </button>
      )}
      <span className="set-pack-tooltip" id={tooltipId} role="tooltip">
        {description}
      </span>
    </article>
  );
}
