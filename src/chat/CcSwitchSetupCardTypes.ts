import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import type {
  CcSwitchObservedFiles,
  CcSwitchProviderSelection,
  CcSwitchRecoveryHandle,
  CcSwitchVerificationResult,
} from "../lib/ccswitch";
import type { Dict } from "../lib/i18n";
import type { CcSwitchProviderDraft } from "./ccSwitchSetup";

export const POLL_INTERVAL_MS = 1_200;
export const EXTERNAL_WAIT_TIMEOUT_MS = 120_000;

export type SetupStep =
  | "draft"
  | "unavailable"
  | "validating"
  | "model-ready"
  | "confirming"
  | "launching"
  | "waiting-external-confirmation"
  | "verified"
  | "invalid"
  | "user-cancelled"
  | "external-timeout"
  | "changed-invalid"
  | "restore-confirmation"
  | "discard-confirmation"
  | "stale-conflict"
  | "failure";

export type RecoveryReturnStep = "external-timeout" | "changed-invalid" | "failure";

export type PreparedSetup = {
  readonly ticketId: string;
  readonly providerName: string;
  readonly endpoint: string;
  readonly selectedModel: string;
  readonly expiresAt: number;
  readonly initial: CcSwitchObservedFiles;
  readonly recovery: CcSwitchRecoveryHandle;
};

export type CcSwitchSetupCardProps = {
  readonly t: Dict;
  readonly draft: CcSwitchProviderDraft | null;
  readonly onClose: () => void;
  readonly pollIntervalMs?: number;
  readonly externalWaitTimeoutMs?: number;
};

export type CcSwitchSetupActions = {
  readonly validate: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  readonly selectModel: () => Promise<void>;
  readonly close: () => Promise<void>;
  readonly cancel: () => Promise<"destroyed" | "retained" | null>;
  readonly launch: () => Promise<void>;
  readonly restore: () => Promise<void>;
  readonly discard: () => Promise<void>;
  readonly setProviderName: (value: string) => void;
  readonly setEndpoint: (value: string) => void;
  readonly setSelectedModelId: (value: string) => void;
  readonly setHasApiKey: (value: boolean) => void;
  readonly setSwitchImmediately: (value: boolean) => void;
  readonly showRestoreConfirmation: (from: RecoveryReturnStep) => void;
  readonly showDiscardConfirmation: (from: RecoveryReturnStep) => void;
  readonly returnToRecoveryStep: () => void;
};

export type CcSwitchSetupController = {
  readonly step: SetupStep;
  readonly providerName: string;
  readonly endpoint: string;
  readonly selectedModelId: string;
  readonly switchImmediately: boolean;
  readonly catalog: CcSwitchProviderSelection | null;
  readonly recoveryAvailable: boolean;
  readonly error: string | null;
  readonly verification: CcSwitchVerificationResult | null;
  readonly submitting: boolean;
  readonly canValidate: boolean;
  readonly apiKeyInputRef: RefObject<HTMLInputElement | null>;
  readonly dialogRef: RefObject<HTMLDivElement | null>;
  readonly actions: CcSwitchSetupActions;
};

export type CcSwitchSetupStateValues = {
  readonly step: SetupStep;
  readonly providerName: string;
  readonly endpoint: string;
  readonly selectedModelId: string;
  readonly switchImmediately: boolean;
  readonly catalog: CcSwitchProviderSelection | null;
  readonly prepared: PreparedSetup | null;
};

export type CcSwitchSetupStateSetters = {
  readonly setStep: Dispatch<SetStateAction<SetupStep>>;
  readonly setCatalog: Dispatch<SetStateAction<CcSwitchProviderSelection | null>>;
  readonly setPrepared: Dispatch<SetStateAction<PreparedSetup | null>>;
  readonly setRecoveryAvailable: Dispatch<SetStateAction<boolean>>;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  readonly setVerification: Dispatch<SetStateAction<CcSwitchVerificationResult | null>>;
  readonly setSubmitting: Dispatch<SetStateAction<boolean>>;
  readonly setSelectedModelId: Dispatch<SetStateAction<string>>;
};

export type CcSwitchSetupRuntimeRefs = {
  readonly apiKeyInputRef: RefObject<HTMLInputElement | null>;
  readonly liveTicketRef: RefObject<string | null>;
  readonly recoveryRef: RefObject<CcSwitchRecoveryHandle | null>;
  readonly mountedRef: RefObject<boolean>;
  readonly lifecycleGenerationRef: RefObject<number>;
  readonly submissionRef: RefObject<boolean>;
};

export type CcSwitchSetupRuntime = {
  readonly t: Dict;
  readonly draft: CcSwitchProviderDraft | null;
  readonly onClose: () => void;
  readonly pollIntervalMs: number;
  readonly externalWaitTimeoutMs: number;
  readonly state: CcSwitchSetupStateValues;
  readonly setters: CcSwitchSetupStateSetters;
  readonly refs: CcSwitchSetupRuntimeRefs;
  readonly clearApiKeyInput: () => void;
};
