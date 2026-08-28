import { useEffect, useMemo, useRef, useState } from "react";
import {
  cancelCcSwitchSetup,
  completeCcSwitchRecovery,
  getCcSwitchCapabilityStatus,
  observeCcSwitchOpenCodeFiles,
  type CcSwitchRecoveryHandle,
} from "../lib/ccswitch";
import {
  cancelSetup,
  discardSetup,
  launchSetup,
  restoreSetup,
} from "./CcSwitchSetupCardRecovery";
import { selectModel, validateSetup } from "./CcSwitchSetupCardFlow";
import { useCcSwitchSetupPolling } from "./CcSwitchSetupCardPolling";
import type {
  CcSwitchSetupCardProps,
  CcSwitchSetupController,
  CcSwitchSetupRuntime,
  PreparedSetup,
  RecoveryReturnStep,
  SetupStep,
} from "./CcSwitchSetupCardTypes";
import { EXTERNAL_WAIT_TIMEOUT_MS, POLL_INTERVAL_MS } from "./CcSwitchSetupCardTypes";

export function useCcSwitchSetupController(props: CcSwitchSetupCardProps): CcSwitchSetupController {
  const { t, draft, onClose } = props;
  const pollIntervalMs = props.pollIntervalMs ?? POLL_INTERVAL_MS;
  const externalWaitTimeoutMs = props.externalWaitTimeoutMs ?? EXTERNAL_WAIT_TIMEOUT_MS;
  const [step, setStep] = useState<SetupStep>("draft");
  const [providerName, setProviderName] = useState(draft?.providerName ?? "YUME OpenCode");
  const [endpoint, setEndpoint] = useState(draft?.baseUrl ?? "");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [switchImmediately, setSwitchImmediately] = useState(true);
  const [catalog, setCatalog] = useState<CcSwitchSetupController["catalog"]>(null);
  const [prepared, setPrepared] = useState<PreparedSetup | null>(null);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verification, setVerification] = useState<CcSwitchSetupController["verification"]>(null);
  const [submitting, setSubmitting] = useState(false);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);
  const liveTicketRef = useRef<string | null>(null);
  const recoveryRef = useRef<CcSwitchRecoveryHandle | null>(null);
  const mountedRef = useRef(true);
  const lifecycleGenerationRef = useRef(0);
  const submissionRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const recoveryReturnStepRef = useRef<RecoveryReturnStep>("failure");

  const clearApiKeyInput = (): void => {
    const input = apiKeyInputRef.current;
    if (input) input.value = "";
    setHasApiKey(false);
  };
  const canValidate =
    step !== "unavailable" &&
    providerName.trim().length > 0 &&
    endpoint.trim().length > 0 &&
    hasApiKey;
  const runtime = useMemo<CcSwitchSetupRuntime>(
    () => ({
      t,
      draft,
      onClose,
      pollIntervalMs,
      externalWaitTimeoutMs,
      state: { step, providerName, endpoint, selectedModelId, switchImmediately, catalog, prepared },
      setters: {
        setStep,
        setCatalog,
        setPrepared,
        setRecoveryAvailable,
        setError,
        setVerification,
        setSubmitting,
        setSelectedModelId,
      },
      refs: {
        apiKeyInputRef,
        liveTicketRef,
        recoveryRef,
        mountedRef,
        lifecycleGenerationRef,
        submissionRef,
      },
      clearApiKeyInput,
    }),
    [
      catalog,
      draft,
      endpoint,
      externalWaitTimeoutMs,
      onClose,
      pollIntervalMs,
      prepared,
      providerName,
      selectedModelId,
      step,
      switchImmediately,
      t,
    ],
  );

  useEffect(() => {
    mountedRef.current = true;
    void getCcSwitchCapabilityStatus()
      .then((status) => {
        if (!mountedRef.current) return;
        if (status.kind !== "ready") {
          setStep("unavailable");
          setError(t.ccSwitchSetupUnavailable);
        }
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setStep("unavailable");
        setError(t.ccSwitchSetupUnavailable);
      });
    return () => {
      mountedRef.current = false;
    };
  }, [t]);

  useEffect(() => {
    return () => {
      lifecycleGenerationRef.current += 1;
      submissionRef.current = false;
      const handleId = liveTicketRef.current;
      liveTicketRef.current = null;
      if (handleId) void cancelCcSwitchSetup(handleId).catch(() => undefined);
      const recovery = recoveryRef.current;
      recoveryRef.current = null;
      if (!recovery) return;
      void observeCcSwitchOpenCodeFiles()
        .then((observed) =>
          completeCcSwitchRecovery({ snapshotId: recovery.snapshotId, kind: "cancelled", observed }),
        )
        .catch(() =>
          completeCcSwitchRecovery({
            snapshotId: recovery.snapshotId,
            kind: "readFailed",
            observed: null,
          }).catch(() => undefined),
        );
    };
  }, []);

  useEffect(() => {
    if (step === "confirming" || step === "restore-confirmation" || step === "discard-confirmation") {
      dialogRef.current?.focus();
    }
  }, [step]);

  useCcSwitchSetupPolling(runtime);

  return {
    step,
    providerName,
    endpoint,
    selectedModelId,
    switchImmediately,
    catalog,
    recoveryAvailable,
    error,
    verification,
    submitting,
    canValidate,
    apiKeyInputRef,
    dialogRef,
    actions: {
      validate: (event) => validateSetup(runtime, event, canValidate),
      selectModel: () => selectModel(runtime),
      close: async () => {
        const retention = await cancelSetup(runtime);
        if (retention !== "retained") onClose();
      },
      cancel: () => cancelSetup(runtime),
      launch: () => launchSetup(runtime),
      restore: () => restoreSetup(runtime),
      discard: () => discardSetup(runtime),
      setProviderName,
      setEndpoint,
      setSelectedModelId,
      setHasApiKey,
      setSwitchImmediately,
      showRestoreConfirmation(from) {
        recoveryReturnStepRef.current = from;
        setStep("restore-confirmation");
      },
      showDiscardConfirmation(from) {
        recoveryReturnStepRef.current = from;
        setStep("discard-confirmation");
      },
      returnToRecoveryStep() {
        setStep(recoveryReturnStepRef.current);
      },
    },
  };
}
