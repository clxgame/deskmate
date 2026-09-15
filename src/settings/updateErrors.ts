import type { Dict } from "../lib/i18n";

export function updateErrorMessage(t: Dict, error: unknown): string {
  const raw = error instanceof Error ? error.message : error;
  if (typeof raw !== "string") return t.updateError;
  switch (raw.replace(/^Error:?\s*/i, "")) {
    case "invalid_repo":
    case "placeholder": return t.updateNeedRepo;
    case "network": return t.updateNetworkError;
    case "manifest_not_found": return t.updateReleaseMissing;
    case "platform_not_available": return t.updatePlatformMissing;
    case "rate_limited": return t.updateRateLimited;
    case "invalid_manifest": return t.updateManifestInvalid;
    case "invalid_signature": return t.updateSignatureInvalid;
    case "open_failed": return t.updateOpenFailed;
    default: return t.updateError;
  }
}
