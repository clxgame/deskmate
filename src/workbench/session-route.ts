export type WorkbenchSessionTarget = {
  readonly directory: string;
  readonly sessionId: string;
};

function encodeDirectory(directory: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(directory)))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function sessionRoute(target: WorkbenchSessionTarget): string {
  return `/${encodeDirectory(target.directory)}/session/${encodeURIComponent(target.sessionId)}`;
}

export function sessionTargetFromUrl(value: string): WorkbenchSessionTarget | undefined {
  const match = /^\/([^/]+)\/session\/([^/?#]+)(?:[?#].*)?$/.exec(value);
  if (!match?.[1] || !match[2]) return undefined;
  try {
    const bytes = Uint8Array.from(atob(match[1].replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
    return { directory: new TextDecoder("utf-8", { fatal: true }).decode(bytes), sessionId: decodeURIComponent(match[2]) };
  } catch (error) {
    if (error instanceof Error) return undefined;
    throw error;
  }
}

export function createSessionOwnershipRouter(
  lookup: (sessionId: string) => Promise<WorkbenchSessionTarget>,
  apply: (target: WorkbenchSessionTarget | undefined) => void,
  report: (error: unknown) => void,
): (url: string) => Promise<void> {
  let current: WorkbenchSessionTarget | undefined;
  let revision = 0;
  return async (url) => {
    const pending = ++revision;
    const scoped = sessionTargetFromUrl(url);
    if (scoped) {
      current = scoped;
      apply(scoped);
      return;
    }
    const sessionId = /^\/server\/c2lkZWNhcg\/session\/([a-zA-Z0-9_-]+)(?:[?#].*)?$/.exec(url)?.[1];
    if (sessionId && current?.sessionId === sessionId) {
      apply(current);
      return;
    }
    current = undefined;
    apply(undefined);
    if (!sessionId) return;
    try {
      const target = await lookup(sessionId);
      if (pending !== revision) return;
      if (target.sessionId !== sessionId || !target.directory) throw new Error("workbench_session_identity_mismatch");
      current = target;
      apply(target);
    } catch (error) {
      if (pending !== revision) return;
      report(error);
    }
  };
}
