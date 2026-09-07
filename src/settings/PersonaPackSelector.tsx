import type { Dict } from "../lib/i18n";
import { personaLabel, type PackManifest } from "../pet/personaCatalog";

type PersonaPackSelectorProps = {
  readonly pack: PackManifest;
  readonly activePersonaId: string;
  readonly onActivePersonaChange: (personaId: string) => void;
  readonly t: Dict;
  readonly language: string;
};

export function PersonaPackSelector({
  pack, activePersonaId, onActivePersonaChange, t, language,
}: PersonaPackSelectorProps) {
  const selectedPersonaId = pack.personas.some((persona) => persona.id === activePersonaId)
    ? activePersonaId : (pack.personas[0]?.id ?? "");
  return (
    <div className="set-pack-active-persona">
      <div className="set-pack-active-persona-field">
        <label className="set-pack-active-persona-label" htmlFor="active-persona">{t.persona}</label>
        <select className="set-select" id="active-persona" aria-label={t.persona}
          value={selectedPersonaId} disabled={pack.personas.length === 0}
          onChange={(event) => onActivePersonaChange(event.target.value)}>
          {pack.personas.length === 0 && <option value="">{t.packAvailablePersonas(0)}</option>}
          {pack.personas.map((persona) => (
            <option key={persona.id} value={persona.id}>
              {personaLabel({ ...persona, packId: pack.packId }, language)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}