import { useCallback, useEffect, useState } from "react";
import type { Dict } from "../lib/i18n";
import {
  importPack,
  listInstalledPacks,
  pickPackFile,
  uninstallPack,
  type InstalledPack,
} from "../lib/packs";
import {
  KNOWN_PACKS,
  personaById,
  personaCatalog,
  packLabel,
  personaLabel,
  type PackManifest,
} from "../pet/personaCatalog";
import { PersonaPackCard } from "./PersonaPackCard";
import {
  availablePersonaCount,
  stateFor,
  type PackActivity,
} from "./personaPackModel";
import "./persona-packs.css";

type Notice = {
  readonly tone: "ok" | "error";
  readonly message: string;
};

export interface PersonaPacksProps {
  readonly t: Dict;
  readonly language: string;
  readonly installed: readonly InstalledPack[];
  readonly onInstalledChange: (packs: InstalledPack[]) => void;
  readonly onActivePersonaRemoved: () => void;
  readonly onActivePersonaChange: (personaId: string) => void;
  readonly activePersonaId: string;
}

function errorText(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const trimmed = raw.replace(/^Error:?\s*/i, "").trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function PersonaPacks({
  t,
  language,
  installed,
  onInstalledChange,
  onActivePersonaRemoved,
  onActivePersonaChange,
  activePersonaId,
}: PersonaPacksProps) {
  const [activity, setActivity] = useState<PackActivity>("idle");
  const [notice, setNotice] = useState<Notice | null>(null);

  const refresh = useCallback(async () => {
    onInstalledChange(await listInstalledPacks());
  }, [onInstalledChange]);

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      setNotice({
        tone: "error",
        message: errorText(detail, t.packLoadFailed),
      });
    });
  }, [refresh, t.packLoadFailed]);

  const onImport = async () => {
    let path: string | null;
    try {
      path = await pickPackFile(t.packImport);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      setNotice({ tone: "error", message: errorText(detail, t.packImportFailed) });
      return;
    }
    if (path === null) return;

    setActivity("import");
    setNotice(null);
    try {
      await importPack(path);
      await refresh();
      setNotice({ tone: "ok", message: t.packImportOk });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      setNotice({ tone: "error", message: errorText(detail, t.packImportFailed) });
    } finally {
      setActivity("idle");
    }
  };

  const onUninstall = async (pack: PackManifest) => {
    if (!window.confirm(t.packUninstallConfirm)) return;
    const ownsActive = personaById(activePersonaId).packId === pack.packId;

    setActivity("uninstall");
    setNotice(null);
    try {
      await uninstallPack(pack.packId);
      await refresh();
      if (ownsActive) {
        onActivePersonaRemoved();
        setNotice({ tone: "ok", message: t.packActivePersonaReset });
      } else {
        setNotice({ tone: "ok", message: t.packUninstallOk });
      }
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      setNotice({ tone: "error", message: errorText(detail, t.packUninstallFailed) });
    } finally {
      setActivity("idle");
    }
  };

  const packs = KNOWN_PACKS.map((pack) => ({
    pack,
    state: stateFor(pack, installed),
  }));
  const availablePacks = packs.filter(({ state }) => state.kind !== "available").length;
  const availablePersonas = packs.reduce(
    (total, { pack, state }) => total + availablePersonaCount(pack, state),
    0,
  );
  const personas = personaCatalog(installed);
  const selectablePacks = KNOWN_PACKS.map((pack) => ({
    pack,
    personas: personas.filter((persona) => persona.packId === pack.packId),
  })).filter((group) => group.personas.length > 0);
  const activePackId = personaById(activePersonaId).packId;
  const selectedGroup =
    selectablePacks.find((group) => group.pack.packId === activePackId) ??
    selectablePacks[0];
  const selectedPersonaId =
    selectedGroup?.personas.some((persona) => persona.id === activePersonaId)
      ? activePersonaId
      : (selectedGroup?.personas[0]?.id ?? "");

  return (
    <section className="set-packs" aria-labelledby="persona-packs-heading">
      <div className="set-packs-head">
        <div>
          <h3 className="set-packs-title" id="persona-packs-heading">
            {t.personaPacks}
          </h3>
          <p className="set-packs-summary" aria-live="polite">
            {t.packLibrarySummary(availablePacks, availablePersonas)}
          </p>
        </div>
      </div>

      <ul className="set-pack-list">
        {packs.map(({ pack, state }) => (
          <li key={pack.packId}>
            <PersonaPackCard
              pack={pack}
              state={state}
              activity={activity}
              language={language}
              t={t}
              onImport={() => void onImport()}
              onUninstall={(target) => void onUninstall(target)}
            />
          </li>
        ))}
      </ul>

      <div className="set-pack-active-persona">
        <div className="set-pack-active-persona-field">
          <label className="set-pack-active-persona-label" htmlFor="active-pack">
            {t.personaPack}
          </label>
          <select
            className="set-select"
            id="active-pack"
            aria-label={t.personaPack}
            value={selectedGroup?.pack.packId ?? ""}
            onChange={(event) => {
              const nextGroup = selectablePacks.find(
                (group) => group.pack.packId === event.target.value,
              );
              const nextPersona = nextGroup?.personas[0];
              if (nextPersona !== undefined) onActivePersonaChange(nextPersona.id);
            }}
            disabled={selectablePacks.length === 0}
          >
            {selectablePacks.map(({ pack }) => (
              <option key={pack.packId} value={pack.packId}>
                {packLabel(pack, language)}
              </option>
            ))}
          </select>
        </div>
        <div className="set-pack-active-persona-field">
          <label className="set-pack-active-persona-label" htmlFor="active-persona">
            {t.persona}
          </label>
          <select
            className="set-select"
            id="active-persona"
            aria-label={t.persona}
            value={selectedPersonaId}
            onChange={(event) => onActivePersonaChange(event.target.value)}
            disabled={selectedGroup === undefined}
          >
            {(selectedGroup?.personas ?? []).map((persona) => (
              <option key={persona.id} value={persona.id}>
                {personaLabel(persona, language)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {notice !== null && (
        <p
          className={`set-pack-feedback set-pack-feedback-${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      )}
    </section>
  );
}
