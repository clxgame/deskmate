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
  packLabel,
  personaLabel,
  personaById,
  type PackManifest,
} from "../pet/personaCatalog";

/**
 * Persona pack management. Packs are the unit users add and remove, so this
 * lists every pack the app knows about and lets the removable ones be imported
 * from a local `.dmpack` or deleted again.
 */

type Status =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

export interface PersonaPacksProps {
  readonly t: Dict;
  readonly language: string;
  /** Pack ids currently installed on disk, excluding built-ins. */
  readonly installed: readonly InstalledPack[];
  readonly onInstalledChange: (packs: InstalledPack[]) => void;
  /** Called when a removed pack owned the active persona. */
  readonly onActivePersonaRemoved: () => void;
  readonly activePersonaId: string;
}

function errorText(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const trimmed = raw.replace(/^Error:?\s*/i, "").trim();
  // The backend already returns localized messages; keep them.
  return trimmed.length > 0 ? trimmed : fallback;
}

export function PersonaPacks({
  t,
  language,
  installed,
  onInstalledChange,
  onActivePersonaRemoved,
  activePersonaId,
}: PersonaPacksProps) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const refresh = useCallback(async () => {
    try {
      onInstalledChange(await listInstalledPacks());
    } catch (error: unknown) {
      console.error("could not list persona packs", error);
    }
  }, [onInstalledChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isInstalled = (pack: PackManifest): boolean =>
    pack.builtin || installed.some((entry) => entry.packId === pack.packId);

  const onImport = async () => {
    let path: string | null;
    try {
      path = await pickPackFile(t.packImport);
    } catch (error: unknown) {
      setStatus({ kind: "error", message: errorText(error, t.packImportFailed) });
      return;
    }
    if (path === null) return;

    setStatus({ kind: "busy" });
    try {
      await importPack(path);
      await refresh();
      setStatus({ kind: "ok", message: t.packImportOk });
    } catch (error: unknown) {
      setStatus({ kind: "error", message: errorText(error, t.packImportFailed) });
    }
  };

  const onUninstall = async (pack: PackManifest) => {
    if (!window.confirm(t.packUninstallConfirm)) return;
    // Losing the pack that owns the active persona would leave the pet with no
    // model, so hand that case back to the caller to reset.
    const ownsActive = personaById(activePersonaId).packId === pack.packId;

    setStatus({ kind: "busy" });
    try {
      await uninstallPack(pack.packId);
      await refresh();
      if (ownsActive) {
        onActivePersonaRemoved();
        setStatus({ kind: "ok", message: t.packActivePersonaReset });
      } else {
        setStatus({ kind: "ok", message: t.packUninstallOk });
      }
    } catch (error: unknown) {
      setStatus({
        kind: "error",
        message: errorText(error, t.packUninstallFailed),
      });
    }
  };

  const busy = status.kind === "busy";

  return (
    <section className="set-packs">
      <div className="set-packs-head">
        <span className="set-row-label">{t.personaPacks}</span>
        <button
          className="set-btn"
          type="button"
          onClick={() => void onImport()}
          disabled={busy}
        >
          {busy ? t.packImporting : t.packImport}
        </button>
      </div>

      <ul className="set-pack-list">
        {KNOWN_PACKS.map((pack) => {
          const active = isInstalled(pack);
          const personas = pack.personas
            .map((persona) => personaLabel({ ...persona, packId: pack.packId }, language))
            .join("、");
          return (
            <li className="set-pack" key={pack.packId}>
              <div className="set-pack-main">
                <span className="set-pack-name">{packLabel(pack, language)}</span>
                <span className="set-pack-meta">
                  {pack.personas.length} {t.packPersonaCount}
                  {" · "}
                  {pack.builtin
                    ? t.packBuiltin
                    : active
                      ? t.packInstalled
                      : t.packNotInstalled}
                </span>
                <span className="set-pack-personas" title={personas}>
                  {personas}
                </span>
              </div>
              {/* Built-in packs live inside the app bundle and cannot be removed. */}
              {!pack.builtin && active && (
                <button
                  className="set-btn set-btn-danger"
                  type="button"
                  onClick={() => void onUninstall(pack)}
                  disabled={busy}
                >
                  {t.packUninstall}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <p className="set-note">{t.packImportHint}</p>
      {status.kind === "error" && (
        <p className="set-note set-note-error" role="alert">
          {status.message}
        </p>
      )}
      {status.kind === "ok" && (
        <p className="set-note set-note-ok" role="status">
          {status.message}
        </p>
      )}
    </section>
  );
}
