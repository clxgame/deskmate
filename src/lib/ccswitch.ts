import { invoke } from "@tauri-apps/api/core";

export type CcSwitchCapabilityStatus =
  | { readonly kind: "ready"; readonly version: string }
  | {
      readonly kind: "unavailable";
      readonly reason: "missing-handler" | "not-installed" | "unknown";
    }
  | { readonly kind: "unsupported"; readonly platform: string }
  | { readonly kind: "recoverable-error"; readonly message: string };

export type CcSwitchModelChoice = {
  readonly id: string;
  readonly name: string;
};

export type CcSwitchFileObservation =
  | { readonly kind: "missing" }
  | { readonly kind: "present"; readonly sha256: string };

export type CcSwitchObservedFiles = {
  readonly config: CcSwitchFileObservation;
  readonly auth: CcSwitchFileObservation;
};

export type CcSwitchProviderValidationInput = {
  readonly providerName: string;
  readonly endpoint: string;
  readonly apiKey: string;
};

export type CcSwitchProviderModelSelection = {
  readonly selectionId: string;
  readonly selectedModel: string;
};

export type CcSwitchHandoffReceipt = {
  readonly contractVersion: number;
  readonly ticketId: string;
  readonly providerName: string;
  readonly endpoint: string;
  readonly selectedModel: string;
  readonly expiresAt: number;
};

export type CcSwitchProviderSelection = {
  readonly contractVersion: number;
  readonly selectionId: string;
  readonly providerName: string;
  readonly endpoint: string;
  readonly models: readonly CcSwitchModelChoice[];
  readonly expiresAt: number;
};

export type CcSwitchPreparedProvider = {
  readonly contractVersion: number;
  readonly receipt: CcSwitchHandoffReceipt;
  readonly recovery: CcSwitchRecoveryHandle;
};

export type LaunchCcSwitchImportRequest = {
  readonly ticketId: string;
  readonly switchImmediately: boolean;
  readonly acceptedProcessArgumentDisclosure: boolean;
};

export type CcSwitchLaunchReceipt = CcSwitchHandoffReceipt & {
  readonly enabled: boolean;
};

export type CcSwitchRecoveryHandle = {
  readonly snapshotId: string;
  readonly original: CcSwitchObservedFiles;
};

export type CcSwitchVerificationTarget = {
  readonly providerName: string;
  readonly endpoint: string;
  readonly modelId: string;
  readonly initial: CcSwitchObservedFiles;
};

export type CcSwitchVerificationResult =
  | { readonly kind: "pending"; readonly currentHash?: string }
  | {
      readonly kind: "verified";
      readonly providerName: string;
      readonly modelId: string;
      readonly currentHash: string;
    }
  | {
      readonly kind: "changedInvalid";
      readonly reason: "malformedConfig" | "authChanged" | "providerMissing" | "modelMissing";
      readonly currentHash?: string;
    }
  | {
      readonly kind: "readFailure";
      readonly changed?: boolean;
      readonly currentHash?: string;
    }
  | { readonly kind: "timeout"; readonly changed: boolean; readonly currentHash?: string };

export type CcSwitchRecoveryRetention = "destroyed" | "retained";

export type CcSwitchRecoveryCompletion = {
  readonly snapshotId: string;
  readonly kind: "verified" | "cancelled" | "timedOut" | "readFailed";
  readonly observed?: CcSwitchObservedFiles | null;
};

export function getCcSwitchCapabilityStatus(): Promise<CcSwitchCapabilityStatus> {
  return invoke<CcSwitchCapabilityStatus>("ccswitch_capability_status");
}

export function validateCcSwitchOpenCodeProvider(
  input: CcSwitchProviderValidationInput,
): Promise<CcSwitchProviderSelection> {
  return invoke<CcSwitchProviderSelection>(
    "prepare_ccswitch_opencode_provider",
    { input },
  );
}

export function selectCcSwitchOpenCodeModel(
  input: CcSwitchProviderModelSelection,
): Promise<CcSwitchPreparedProvider> {
  return invoke<CcSwitchPreparedProvider>("select_ccswitch_opencode_model", { input });
}

export function launchCcSwitchOpenCodeImport(
  request: LaunchCcSwitchImportRequest,
): Promise<CcSwitchLaunchReceipt> {
  return invoke<CcSwitchLaunchReceipt>("launch_ccswitch_opencode_import", {
    request,
  });
}

export function cancelCcSwitchSetup(handleId: string): Promise<void> {
  return invoke<void>("cancel_ccswitch_setup", { handleId });
}

export function observeCcSwitchOpenCodeFiles(): Promise<CcSwitchObservedFiles> {
  return invoke<CcSwitchObservedFiles>("observe_ccswitch_opencode_files");
}

export function checkCcSwitchOpenCodeImport(
  target: CcSwitchVerificationTarget,
): Promise<CcSwitchVerificationResult> {
  return invoke<CcSwitchVerificationResult>("check_ccswitch_opencode_import", {
    target,
  });
}

export function completeCcSwitchRecovery(
  completion: CcSwitchRecoveryCompletion,
): Promise<CcSwitchRecoveryRetention> {
  return invoke<CcSwitchRecoveryRetention>("complete_ccswitch_recovery", {
    completion,
  });
}

export function restoreCcSwitchRecovery(snapshotId: string): Promise<CcSwitchFileObservation> {
  return invoke<CcSwitchFileObservation>("restore_ccswitch_recovery", {
    snapshotId,
  });
}

export function discardCcSwitchRecovery(
  snapshotId: string,
  confirmed: boolean,
): Promise<void> {
  return invoke<void>("discard_ccswitch_recovery", {
    snapshotId,
    confirmed,
  });
}
