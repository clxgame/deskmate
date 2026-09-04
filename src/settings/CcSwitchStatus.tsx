import type { Dict } from "../lib/i18n";
import type { LocalAiDeploymentStatus } from "./localAiDeployment";

export {
  localAiDeploymentErrorCode,
  normalizeLocalAiDeploymentReceipt,
  normalizeLocalAiDeploymentStage,
} from "./localAiDeployment";
export type {
  LocalAiDeploymentReceipt,
  LocalAiDeploymentStage,
  LocalAiDeploymentStatus,
} from "./localAiDeployment";

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
  readonly deployment: LocalAiDeploymentStatus;
  readonly canDeploy: boolean;
  readonly t: Dict;
  readonly onDeploy: () => void;
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

function deploymentText(
  deployment: LocalAiDeploymentStatus,
  status: CcSwitchCapabilityStatus,
  t: Dict,
): string {
  switch (deployment.kind) {
    case "idle":
      return statusText(status, t);
    case "working":
      return t.localAiDeployStage(deployment.stage);
    case "success":
      return t.localAiDeploySuccess(
        deployment.ccSwitchVersion,
        deployment.openCodeVersion,
      );
    case "error":
      return deployment.message;
    default:
      return assertNever(deployment);
  }
}

function deploymentRole(
  deployment: LocalAiDeploymentStatus,
  status: CcSwitchCapabilityStatus,
): "status" | "alert" {
  if (deployment.kind === "error") return "alert";
  if (deployment.kind === "working" || deployment.kind === "success") return "status";
  return statusRole(status);
}

/// The deep link can only carry one model, so the success state has to say
/// whether the wider catalog landed and whether CC Switch still needs a nudge.
function modelSyncHint(
  deployment: LocalAiDeploymentStatus,
  t: Dict,
): string | null {
  if (deployment.kind !== "success") return null;
  if (!deployment.ccSwitchSyncRequired) return null;
  if (deployment.modelCount <= 1) return t.localAiDeployModelSyncIncomplete;
  return t.localAiDeployModelSyncHint(
    deployment.modelCount,
    deployment.ccSwitchRunning,
  );
}

export function CcSwitchStatus({
  status,
  deployment,
  canDeploy,
  t,
  onDeploy,
}: CcSwitchStatusProps) {
  const working = deployment.kind === "working";
  const disabled =
    working ||
    !canDeploy ||
    status.kind === "checking" ||
    status.kind === "unsupported";
  const syncHint = modelSyncHint(deployment, t);

  return (
    <section
      className={`set-ccswitch set-ccswitch-${status.kind} set-ccswitch-deploy-${deployment.kind}`}
      aria-label={t.ccSwitchStatusTitle}
      aria-busy={working}
    >
      <div className="set-ccswitch-head">
        <h3 className="set-section-head">{t.ccSwitchStatusTitle}</h3>
        <span className="set-ccswitch-app">OpenCode</span>
      </div>
      <p className="set-ccswitch-status" role={deploymentRole(deployment, status)}>
        {deploymentText(deployment, status, t)}
        {syncHint !== null && (
          <span className="set-ccswitch-model-sync">{syncHint}</span>
        )}
      </p>
      <p className="set-ccswitch-description">{t.localAiDeployHint}</p>
      <button
        className="set-ccswitch-action"
        type="button"
        disabled={disabled}
        onClick={onDeploy}
      >
        {working ? t.localAiDeployWorking : t.localAiDeployAction}
      </button>
    </section>
  );
}
