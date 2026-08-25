import type { Dict } from "../lib/i18n";
import type { InstalledPack } from "../lib/packs";
import type { PackManifest } from "../pet/personaCatalog";

export type PackActivity = "idle" | "import" | "uninstall";

export type PackState =
  | { readonly kind: "builtin" }
  | {
      readonly kind: "installed";
      readonly version: string;
      readonly personaIds: readonly string[];
    }
  | { readonly kind: "available" };

export type PackPersona = PackManifest["personas"][number];

export type PackPresentation = {
  readonly status: string;
  readonly description: string;
  readonly count: string;
};

function assertNever(value: never): never {
  throw new TypeError(`Unhandled persona pack state: ${String(value)}`);
}

export function stateFor(
  pack: PackManifest,
  installed: readonly InstalledPack[],
): PackState {
  if (pack.builtin) return { kind: "builtin" };

  const local = installed.find((entry) => entry.packId === pack.packId);
  return local === undefined
    ? { kind: "available" }
    : {
        kind: "installed",
        version: local.version,
        personaIds: local.personaIds,
      };
}

export function visiblePersonas(
  pack: PackManifest,
  state: PackState,
): readonly PackPersona[] {
  switch (state.kind) {
    case "builtin":
    case "available":
      return pack.personas;
    case "installed": {
      const present = new Set(state.personaIds);
      return pack.personas.filter((persona) => present.has(persona.id));
    }
    default:
      return assertNever(state);
  }
}

export function availablePersonaCount(
  pack: PackManifest,
  state: PackState,
): number {
  switch (state.kind) {
    case "builtin":
    case "installed":
      return visiblePersonas(pack, state).length;
    case "available":
      return 0;
    default:
      return assertNever(state);
  }
}

export function presentationFor(
  state: PackState,
  personaCount: number,
  t: Dict,
): PackPresentation {
  switch (state.kind) {
    case "builtin":
      return {
        status: t.packBuiltin,
        description: t.packBuiltinDescription,
        count: t.packAvailablePersonas(personaCount),
      };
    case "installed":
      return {
        status: t.packInstalledVersion(state.version),
        description: t.packOfflineDescription,
        count: t.packAvailablePersonas(personaCount),
      };
    case "available":
      return {
        status: t.packNotInstalled,
        description: t.packOfflineDescription,
        count: t.packIncludedPersonas(personaCount),
      };
    default:
      return assertNever(state);
  }
}
