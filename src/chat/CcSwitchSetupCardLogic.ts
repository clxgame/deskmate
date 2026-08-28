import type { CcSwitchObservedFiles } from "../lib/ccswitch";

export function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (typeof code === "string") return code;
  }
  return "unknown";
}

export async function ignoreAsyncError(promise: Promise<unknown>): Promise<void> {
  await promise.catch(() => undefined);
}

export function observationsMatch(
  left: CcSwitchObservedFiles,
  right: CcSwitchObservedFiles,
): boolean {
  return (
    left.config.kind === right.config.kind &&
    (left.config.kind === "missing" ||
      (right.config.kind === "present" && left.config.sha256 === right.config.sha256)) &&
    left.auth.kind === right.auth.kind &&
    (left.auth.kind === "missing" ||
      (right.auth.kind === "present" && left.auth.sha256 === right.auth.sha256))
  );
}

export function currentConfigHash(files: CcSwitchObservedFiles): string | undefined {
  return files.config.kind === "present" ? files.config.sha256 : undefined;
}
