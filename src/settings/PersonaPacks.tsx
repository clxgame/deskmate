import { useCallback, useEffect, useRef, useState } from "react";
import { positionPackTooltip } from "./alignPackTooltip";
import type { Dict } from "../lib/i18n";
import {
  importPack,
  listInstalledPacks,
  pickPackFile,
  uninstallPack,
  type InstalledPack,
} from "../lib/packs";
import {
  personaById,
  type PackManifest,
} from "../pet/personaCatalog";
import { PersonaPackCard } from "./PersonaPackCard";
import { PersonaPackImport } from "./PersonaPackImport";
import { PersonaPackSelector } from "./PersonaPackSelector";
import {
  packLibrary,
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
  const [pendingUninstall, setPendingUninstall] = useState<PackManifest | null>(
    null,
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const libraryRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const alignVisibleTooltips = () => {
      libraryRef.current?.querySelectorAll<HTMLElement>(".set-pack:hover, .set-pack:focus-within")
        .forEach(positionPackTooltip);
    };
    window.addEventListener("resize", alignVisibleTooltips);
    return () => window.removeEventListener("resize", alignVisibleTooltips);
  }, []);

  useEffect(() => { setSelectedPackId(null); }, [activePersonaId]);

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

  const requestUninstall = (pack: PackManifest) => {
    if (activity !== "idle") return;
    setNotice(null);
    setPendingUninstall(pack);
  };

  const onUninstall = async () => {
    const pack = pendingUninstall;
    if (pack === null || activity !== "idle") return;

    setPendingUninstall(null);
    const ownsActive = personaById(activePersonaId).packId === pack.packId;

    setActivity("uninstall");
    setNotice(null);
    try {
      await uninstallPack(pack.packId);
      await refresh();
      setSelectedPackId((current) => current === pack.packId ? null : current);
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

  const packs = packLibrary(installed);
  const selectedPack = packs.find((pack) => pack.packId === selectedPackId)
    ?? packs.find((pack) => pack.packId === personaById(activePersonaId).packId)
    ?? packs[0];
  const availablePersonas = packs.reduce((total, pack) => total + pack.personas.length, 0);
  const selectPack = (pack: PackManifest) => {
    setSelectedPackId(pack.packId);
    if (pack.packId === selectedPack.packId) return;
    const first = pack.personas[0];
    if (first !== undefined) onActivePersonaChange(first.id);
  };

  return (
    <section ref={libraryRef} className="set-packs" aria-labelledby="persona-packs-heading">
      <div className="set-packs-head">
        <div>
          <h3 className="set-packs-title" id="persona-packs-heading">
            {t.personaPacks}
          </h3>
          <p className="set-packs-summary" aria-live="polite">
            {t.packLibrarySummary(packs.length, availablePersonas)}
          </p>
        </div>
      </div>

      <ul className="set-pack-list">
        {packs.map((pack) => (
          <li key={"pack:" + pack.packId}>
            <PersonaPackCard
              pack={pack}
              selected={pack.packId === selectedPack.packId}
              activity={activity}
              language={language}
              t={t}
              onSelect={selectPack}
              onUninstall={() => requestUninstall(pack)}
            />
          </li>
        ))}
        <li key="import">
          <PersonaPackImport activity={activity} t={t} onImport={() => void onImport()} />
        </li>
      </ul>

      {pendingUninstall !== null && (
        <>
          <div
            className="set-confirm-backdrop"
            onClick={() => setPendingUninstall(null)}
          />
          <div className="set-confirm" role="alertdialog" aria-modal="true">
            <p className="set-confirm-body">{t.packUninstallConfirm}</p>
            <div className="set-confirm-actions set-memory-actions">
              <button
                type="button"
                className="set-btn set-btn-danger"
                onClick={() => void onUninstall()}
                disabled={activity !== "idle"}
              >
                {t.memoryConfirmDelete}
              </button>
              <button
                type="button"
                className="set-btn"
                onClick={() => setPendingUninstall(null)}
                disabled={activity !== "idle"}
              >
                {t.memoryCancelEdit}
              </button>
            </div>
          </div>
        </>
      )}

      <PersonaPackSelector
        pack={selectedPack}
        activePersonaId={activePersonaId}
        onActivePersonaChange={onActivePersonaChange}
        t={t}
        language={language}
      />

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
