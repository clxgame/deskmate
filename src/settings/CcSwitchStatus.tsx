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

export type LocalAiDeploymentStage =
  | "verifyingApi"
  | "installingOpenCode"
  | "installingCcSwitch"
  | "importingProvider"
  | "verifyingConfiguration";

export type LocalAiDeploymentStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "working"; readonly stage: LocalAiDeploymentStage }
  | {
      readonly kind: "success";
      readonly ccSwitchVersion: string;
      readonly openCodeVersion: string;
    }
  | { readonly kind: "error"; readonly message: string };

export type LocalAiDeploymentReceipt = {
  readonly ccSwitchVersion: string;
  readonly openCodeVersion: string;
  readonly modelId: string;
};

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

const DEPLOYMENT_STAGES: readonly LocalAiDeploymentStage[] = [
  "verifyingApi",
  "installingOpenCode",
  "installingCcSwitch",
  "importingProvider",
  "verifyingConfiguration",
];

export function normalizeLocalAiDeploymentStage(
  value: unknown,
): LocalAiDeploymentStage | null {
  if (!isRecord(value) || typeof value["stage"] !== "string") return null;
  return DEPLOYMENT_STAGES.find((stage) => stage === value["stage"]) ?? null;
}

function validVersion(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);
}

export function normalizeLocalAiDeploymentReceipt(
  value: unknown,
): LocalAiDeploymentReceipt | null {
  if (!isRecord(value)) return null;
  const ccSwitchVersion = value["ccSwitchVersion"];
  const openCodeVersion = value["openCodeVersion"];
  const modelId = value["modelId"];
  if (
    !validVersion(ccSwitchVersion) ||
    !validVersion(openCodeVersion) ||
    typeof modelId !== "string" ||
    modelId.trim().length === 0
  ) {
    return null;
  }
  return { ccSwitchVersion, openCodeVersion, modelId: modelId.trim() };
}

export function localAiDeploymentErrorCode(value: unknown): string {
  if (isRecord(value) && typeof value["code"] === "string") {
    return value["code"];
  }
  if (
    value instanceof Error &&
    [
      "empty_key",
      "bad_url",
      "unauthorized",
      "not_found",
      "no_models",
      "invalid_response",
      "models_unavailable",
    ].includes(value.message)
  ) {
    return value.message;
  }
  return typeof value === "string" ? value : "local_ai_deploy_failed";
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
