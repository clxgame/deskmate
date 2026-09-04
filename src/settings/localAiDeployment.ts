export type LocalAiDeploymentStage =
  | "verifyingApi"
  | "installingOpenCode"
  | "installingCcSwitch"
  | "importingProvider"
  | "verifyingConfiguration"
  | "syncingModelCatalog";

export type LocalAiDeploymentStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "working"; readonly stage: LocalAiDeploymentStage }
  | {
      readonly kind: "success";
      readonly ccSwitchVersion: string;
      readonly openCodeVersion: string;
      readonly modelCount: number;
      readonly ccSwitchSyncRequired: boolean;
      readonly ccSwitchRunning: boolean;
    }
  | { readonly kind: "error"; readonly message: string };

export type LocalAiDeploymentReceipt = {
  readonly ccSwitchVersion: string;
  readonly openCodeVersion: string;
  readonly modelId: string;
  readonly modelCount: number;
  readonly ccSwitchSyncRequired: boolean;
  readonly ccSwitchRunning: boolean;
};

type NativeStatusRecord = {
  readonly [key: string]: unknown;
};

const DEPLOYMENT_STAGES: readonly LocalAiDeploymentStage[] = [
  "verifyingApi",
  "installingOpenCode",
  "installingCcSwitch",
  "importingProvider",
  "verifyingConfiguration",
  "syncingModelCatalog",
];

function isRecord(value: unknown): value is NativeStatusRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validVersion(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);
}

function validModelCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export function normalizeLocalAiDeploymentStage(
  value: unknown,
): LocalAiDeploymentStage | null {
  if (!isRecord(value) || typeof value["stage"] !== "string") return null;
  return DEPLOYMENT_STAGES.find((stage) => stage === value["stage"]) ?? null;
}

export function normalizeLocalAiDeploymentReceipt(
  value: unknown,
): LocalAiDeploymentReceipt | null {
  if (!isRecord(value)) return null;
  const ccSwitchVersion = value["ccSwitchVersion"];
  const openCodeVersion = value["openCodeVersion"];
  const modelId = value["modelId"];
  const modelCount = value["modelCount"];
  const ccSwitchSyncRequired = value["ccswitchSyncRequired"];
  const ccSwitchRunning = value["ccswitchRunning"];
  if (
    !validVersion(ccSwitchVersion) ||
    !validVersion(openCodeVersion) ||
    typeof modelId !== "string" ||
    modelId.trim().length === 0 ||
    !validModelCount(modelCount) ||
    typeof ccSwitchSyncRequired !== "boolean" ||
    typeof ccSwitchRunning !== "boolean"
  ) {
    return null;
  }
  return {
    ccSwitchVersion,
    openCodeVersion,
    modelId: modelId.trim(),
    modelCount,
    ccSwitchSyncRequired,
    ccSwitchRunning,
  };
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
