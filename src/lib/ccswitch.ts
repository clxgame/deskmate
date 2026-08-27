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

export type CcSwitchProviderSetupInput = {
  readonly providerName: string;
  readonly endpoint: string;
  readonly apiKey: string;
  readonly selectedModel: string;
  readonly models: readonly CcSwitchModelChoice[];
  readonly preImportHash: string;
};

export type CcSwitchHandoffReceipt = {
  readonly contractVersion: number;
  readonly ticketId: string;
  readonly providerName: string;
  readonly endpoint: string;
  readonly selectedModel: string;
  readonly preImportHash: string;
  readonly expiresAt: number;
};

export type CcSwitchProviderValidationResult = {
  readonly contractVersion: number;
  readonly receipt: CcSwitchHandoffReceipt;
  readonly models: readonly CcSwitchModelChoice[];
};

export type LaunchCcSwitchImportRequest = {
  readonly ticketId: string;
  readonly providerName: string;
  readonly endpoint: string;
  readonly selectedModel: string;
  readonly preImportHash: string;
  readonly switchImmediately: boolean;
  readonly acceptedProcessArgumentDisclosure: boolean;
};

export type CcSwitchLaunchReceipt = CcSwitchHandoffReceipt & {
  readonly enabled: boolean;
};

export function getCcSwitchCapabilityStatus(): Promise<CcSwitchCapabilityStatus> {
  return invoke<CcSwitchCapabilityStatus>("ccswitch_capability_status");
}

export function prepareCcSwitchOpenCodeProvider(
  input: CcSwitchProviderSetupInput,
): Promise<CcSwitchProviderValidationResult> {
  return invoke<CcSwitchProviderValidationResult>(
    "prepare_ccswitch_opencode_provider",
    { input },
  );
}

export function launchCcSwitchOpenCodeImport(
  request: LaunchCcSwitchImportRequest,
): Promise<CcSwitchLaunchReceipt> {
  return invoke<CcSwitchLaunchReceipt>("launch_ccswitch_opencode_import", {
    request,
  });
}

export function cancelCcSwitchSetup(ticketId: string): Promise<void> {
  return invoke<void>("cancel_ccswitch_setup", { ticketId });
}
