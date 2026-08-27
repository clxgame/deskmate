import type { Dict } from "../lib/i18n";

export type CcSwitchCapabilityStatus =
  | { readonly kind: "checking" }
  | { readonly kind: "ready"; readonly version: string }
  | {
      readonly kind: "unavailable";
      readonly reason: "missing-handler" | "not-installed" | "unknown";
    }
  | { readonly kind: "unsupported" }
  | { readonly kind: "recoverable-error" };

type NativeStatusRecord = {
  readonly [key: string]: unknown;
};

interface CcSwitchStatusProps {
  readonly status: CcSwitchCapabilityStatus;
  readonly t: Dict;
  readonly onOpenSetup: () => void;
  readonly onRefresh: () => void;
}

function assertNever(_value: never): never {
  throw new Error("Unexpected CC Switch status");
}

function isRecord(value: unknown): value is NativeStatusRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unavailableUnknown(): CcSwitchCapabilityStatus {
  return { kind: "unavailable", reason: "unknown" };
}

export function normalizeCcSwitchCapabilityStatus(
  value: unknown,
): CcSwitchCapabilityStatus {
  if (!isRecord(value)) return unavailableUnknown();

  switch (value["kind"]) {
    case "checking":
      return { kind: "checking" };
    case "ready": {
      const version = value["version"];
      if (typeof version !== "string") return unavailableUnknown();
      const trimmedVersion = version.trim();
      if (trimmedVersion.length === 0) return unavailableUnknown();
      return { kind: "ready", version: trimmedVersion };
    }
    case "unavailable":
      switch (value["reason"]) {
        case "missing-handler":
        case "not-installed":
        case "unknown":
          return { kind: "unavailable", reason: value["reason"] };
        default:
          return unavailableUnknown();
      }
    case "unsupported":
      return { kind: "unsupported" };
    case "recoverable-error":
      return { kind: "recoverable-error" };
    default:
      return unavailableUnknown();
  }
}

function statusText(status: CcSwitchCapabilityStatus, t: Dict): string {
  switch (status.kind) {
    case "checking":
      return t.ccSwitchStatusChecking;
    case "ready":
      return t.ccSwitchStatusReady(status.version);
    case "unavailable":
      return t.ccSwitchStatusUnavailable;
    case "unsupported":
      return t.ccSwitchStatusUnsupported();
    case "recoverable-error":
      return t.ccSwitchStatusRecoverableError;
    default:
      return assertNever(status);
  }
}

function statusRole(status: CcSwitchCapabilityStatus): "status" | "alert" {
  switch (status.kind) {
    case "checking":
    case "ready":
      return "status";
    case "unavailable":
    case "unsupported":
    case "recoverable-error":
      return "alert";
    default:
      return assertNever(status);
  }
}

export function CcSwitchStatus({
  status,
  t,
  onOpenSetup,
  onRefresh,
}: CcSwitchStatusProps) {
  const canOpenSetup = status.kind === "ready";
  const canRefresh =
    status.kind === "unavailable" ||
    status.kind === "unsupported" ||
    status.kind === "recoverable-error";

  return (
    <section
      className={`set-ccswitch set-ccswitch-${status.kind}`}
      aria-label={t.ccSwitchStatusTitle}
    >
      <div className="set-ccswitch-head">
        <h3 className="set-section-head">{t.ccSwitchStatusTitle}</h3>
        <span className="set-ccswitch-app">OpenCode</span>
      </div>
      <p className="set-ccswitch-status" role={statusRole(status)}>
        {statusText(status, t)}
      </p>
      {(canOpenSetup || canRefresh) && (
        <button
          className="set-ccswitch-action"
          type="button"
          onClick={canOpenSetup ? onOpenSetup : onRefresh}
        >
          {canOpenSetup ? t.ccSwitchSetupOpen : t.ccSwitchStatusRefresh}
        </button>
      )}
    </section>
  );
}
