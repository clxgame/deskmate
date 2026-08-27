// allow: SIZE_OK — the secure setup state machine is kept in one auditable UI boundary.
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  cancelCcSwitchSetup,
  checkCcSwitchOpenCodeImport,
  completeCcSwitchRecovery,
  discardCcSwitchRecovery,
  getCcSwitchCapabilityStatus,
  launchCcSwitchOpenCodeImport,
  observeCcSwitchOpenCodeFiles,
  restoreCcSwitchRecovery,
  selectCcSwitchOpenCodeModel,
  validateCcSwitchOpenCodeProvider,
  type CcSwitchObservedFiles,
  type CcSwitchProviderSelection,
  type CcSwitchRecoveryHandle,
  type CcSwitchVerificationResult,
} from "../lib/ccswitch";
import type { Dict } from "../lib/i18n";
import type { CcSwitchProviderDraft } from "./ccSwitchSetup";

const POLL_INTERVAL_MS = 1_200;
const EXTERNAL_WAIT_TIMEOUT_MS = 120_000;

type SetupStep =
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

type PreparedSetup = {
  readonly ticketId: string;
  readonly providerName: string;
  readonly endpoint: string;
  readonly selectedModel: string;
  readonly preImportHash: string;
  readonly expiresAt: number;
  readonly models: CcSwitchProviderSelection["models"];
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

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "unknown";
}

async function ignoreAsyncError(promise: Promise<unknown>): Promise<void> {
  await promise.catch(() => undefined);
}

function observationsMatch(left: CcSwitchObservedFiles, right: CcSwitchObservedFiles): boolean {
  return (
    left.config.kind === right.config.kind &&
    (left.config.kind === "missing" ||
      (right.config.kind === "present" && left.config.sha256 === right.config.sha256)) &&
    left.auth.kind === right.auth.kind &&
    (left.auth.kind === "missing" ||
      (right.auth.kind === "present" && left.auth.sha256 === right.auth.sha256))
  );
}

function currentConfigHash(files: CcSwitchObservedFiles): string | undefined {
  return files.config.kind === "present" ? files.config.sha256 : undefined;
}

export function CcSwitchSetupCard({
  t,
  draft,
  onClose,
  pollIntervalMs = POLL_INTERVAL_MS,
  externalWaitTimeoutMs = EXTERNAL_WAIT_TIMEOUT_MS,
}: CcSwitchSetupCardProps) {
  const [step, setStep] = useState<SetupStep>("draft");
  const [providerName, setProviderName] = useState(draft?.providerName ?? "YUME OpenCode");
  const [endpoint, setEndpoint] = useState(draft?.baseUrl ?? "");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [switchImmediately, setSwitchImmediately] = useState(true);
  const [catalog, setCatalog] = useState<CcSwitchProviderSelection | null>(null);
  const [prepared, setPrepared] = useState<PreparedSetup | null>(null);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verification, setVerification] = useState<CcSwitchVerificationResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);
  const liveTicketRef = useRef<string | null>(null);
  const recoveryRef = useRef<CcSwitchRecoveryHandle | null>(null);
  const mountedRef = useRef(true);
  const lifecycleGenerationRef = useRef(0);
  const submissionRef = useRef(false);
  const recoveryReturnStepRef = useRef<"external-timeout" | "changed-invalid" | "failure">(
    "failure",
  );

  const clearApiKeyInput = (): void => {
    const input = apiKeyInputRef.current;
    if (input) input.value = "";
    setHasApiKey(false);
  };

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
      if (recovery) {
        void observeCcSwitchOpenCodeFiles()
          .then((observed) =>
            completeCcSwitchRecovery({
              snapshotId: recovery.snapshotId,
              kind: "cancelled",
              observed,
            }),
          )
          .catch(() =>
            completeCcSwitchRecovery({
              snapshotId: recovery.snapshotId,
              kind: "readFailed",
              observed: null,
            }).catch(() => undefined),
          );
      }
    };
  }, []);

  const canValidate =
    step !== "unavailable" &&
    providerName.trim().length > 0 &&
    endpoint.trim().length > 0 &&
    hasApiKey;

  const validate = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canValidate || submissionRef.current) return;
    const apiKeyInput = apiKeyInputRef.current;
    let apiKey = apiKeyInput?.value ?? "";
    if (!apiKey) return;
    const generation = lifecycleGenerationRef.current;
    submissionRef.current = true;
    setSubmitting(true);
    setStep("validating");
    setError(null);
    try {
      const preparation = validateCcSwitchOpenCodeProvider({
        providerName,
        endpoint,
        apiKey,
      });
      apiKey = "";
      clearApiKeyInput();
      const result = await preparation;
      if (!mountedRef.current || lifecycleGenerationRef.current !== generation) {
        await ignoreAsyncError(cancelCcSwitchSetup(result.selectionId));
        return;
      }
      liveTicketRef.current = result.selectionId;
      setCatalog(result);
      setSelectedModelId(
        result.models.find((model) => model.id === draft?.modelHint)?.id ?? result.models[0]?.id ?? "",
      );
      setStep("model-ready");
    } catch (caught) {
      apiKey = "";
      if (!mountedRef.current || lifecycleGenerationRef.current !== generation) return;
      const ticketId = liveTicketRef.current;
      if (ticketId) await ignoreAsyncError(cancelCcSwitchSetup(ticketId));
      clearApiKeyInput();
      setCatalog(null);
      setPrepared(null);
      liveTicketRef.current = null;
      setError(t.ccSwitchSetupError(errorCode(caught)));
      setStep("invalid");
    } finally {
      submissionRef.current = false;
      if (mountedRef.current && lifecycleGenerationRef.current === generation) {
        setSubmitting(false);
      }
    }
  };

  const selectModel = async (): Promise<void> => {
    const current = catalog;
    if (!current || !selectedModelId || submissionRef.current) return;
    const generation = lifecycleGenerationRef.current;
    submissionRef.current = true;
    setSubmitting(true);
    setStep("validating");
    setError(null);
    try {
      const result = await selectCcSwitchOpenCodeModel({
        selectionId: current.selectionId,
        selectedModel: selectedModelId,
      });
      if (!mountedRef.current || lifecycleGenerationRef.current !== generation) {
        await ignoreAsyncError(cancelCcSwitchSetup(result.receipt.ticketId));
        await ignoreAsyncError(
          completeCcSwitchRecovery({
            snapshotId: result.recovery.snapshotId,
            kind: "cancelled",
            observed: result.recovery.original,
          }),
        );
        return;
      }
      liveTicketRef.current = result.receipt.ticketId;
      setPrepared({
        ticketId: result.receipt.ticketId,
        providerName: result.receipt.providerName,
        endpoint: result.receipt.endpoint,
        selectedModel: result.receipt.selectedModel,
        preImportHash: result.receipt.preImportHash,
        expiresAt: result.receipt.expiresAt,
        models: result.models,
        initial: result.recovery.original,
        recovery: result.recovery,
      });
      recoveryRef.current = result.recovery;
      setRecoveryAvailable(true);
      setCatalog(null);
      setStep("confirming");
    } catch (caught) {
      if (!mountedRef.current || lifecycleGenerationRef.current !== generation) return;
      liveTicketRef.current = null;
      setCatalog(null);
      setPrepared(null);
      setError(t.ccSwitchSetupError(errorCode(caught)));
      setStep("invalid");
    } finally {
      submissionRef.current = false;
      if (mountedRef.current && lifecycleGenerationRef.current === generation) {
        setSubmitting(false);
      }
    }
  };

  const close = async (): Promise<void> => {
    const retention = await cancel();
    if (retention !== "retained") onClose();
  };

  const cancel = async (): Promise<"destroyed" | "retained" | null> => {
    lifecycleGenerationRef.current += 1;
    submissionRef.current = false;
    const current = prepared;
    const handleId = liveTicketRef.current;
    liveTicketRef.current = null;
    if (handleId) await ignoreAsyncError(cancelCcSwitchSetup(handleId));
    let retention: "destroyed" | "retained" | null = null;
    if (current) {
      const observed = await observeCcSwitchOpenCodeFiles().catch(() => null);
      retention = await completeCcSwitchRecovery({
        snapshotId: current.recovery.snapshotId,
        kind: "cancelled",
        observed,
      }).catch(() => "retained" as const);
      if (retention === "destroyed") {
        recoveryRef.current = null;
        setRecoveryAvailable(false);
      }
    }
    clearApiKeyInput();
    setCatalog(null);
    if (retention === "retained") {
      setRecoveryAvailable(true);
      setError(t.ccSwitchSetupGenericFailure);
      setStep("failure");
    } else {
      setPrepared(null);
      setStep("user-cancelled");
    }
    return retention;
  };

  const launch = async (): Promise<void> => {
    const current = prepared;
    if (!current || submissionRef.current) return;
    const generation = lifecycleGenerationRef.current;
    submissionRef.current = true;
    setSubmitting(true);
    setStep("launching");
    setError(null);
    try {
      await launchCcSwitchOpenCodeImport({
        ticketId: current.ticketId,
        providerName: current.providerName,
        endpoint: current.endpoint,
        selectedModel: current.selectedModel,
        preImportHash: current.preImportHash,
        switchImmediately,
        acceptedProcessArgumentDisclosure: true,
      });
      if (!mountedRef.current || lifecycleGenerationRef.current !== generation) return;
      liveTicketRef.current = null;
      setStep("waiting-external-confirmation");
    } catch (caught) {
      if (!mountedRef.current || lifecycleGenerationRef.current !== generation) return;
      setError(t.ccSwitchSetupError(errorCode(caught)));
      setStep("failure");
    } finally {
      submissionRef.current = false;
      if (mountedRef.current && lifecycleGenerationRef.current === generation) {
        setSubmitting(false);
      }
    }
  };

  useEffect(() => {
    if (step !== "waiting-external-confirmation" || !prepared) return;
    let closed = false;
    const started = Date.now();
    let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
    const finishInterrupted = async (
      kind: "timedOut" | "readFailed",
    ): Promise<CcSwitchObservedFiles | null> => {
      const observed = await observeCcSwitchOpenCodeFiles().catch(() => null);
      const retention = await completeCcSwitchRecovery({
        snapshotId: prepared.recovery.snapshotId,
        kind,
        observed,
      }).catch(() => "retained" as const);
      if (retention === "destroyed") {
        recoveryRef.current = null;
        if (!closed) setRecoveryAvailable(false);
      } else if (!closed) {
        setRecoveryAvailable(true);
      }
      return observed;
    };
    const poll = async (): Promise<void> => {
      if (closed) return;
      if (Date.now() - started >= externalWaitTimeoutMs) {
        const observed = await finishInterrupted("timedOut");
        if (!closed) {
          setVerification({
            kind: "timeout",
            changed: observed === null || !observationsMatch(observed, prepared.initial),
            currentHash: observed === null ? undefined : currentConfigHash(observed),
          });
          setStep("external-timeout");
        }
        return;
      }
      const result = await checkCcSwitchOpenCodeImport({
        providerName: prepared.providerName,
        endpoint: prepared.endpoint,
        modelId: prepared.selectedModel,
        initial: prepared.initial,
      }).catch(() => ({ kind: "readFailure" as const }));
      if (closed) return;
      setVerification(result);
      switch (result.kind) {
        case "pending":
          timer = globalThis.setTimeout(() => void poll(), pollIntervalMs);
          return;
        case "verified": {
          const retention = await completeCcSwitchRecovery({
            snapshotId: prepared.recovery.snapshotId,
            kind: "verified",
          }).catch(() => "retained" as const);
          if (closed) return;
          if (retention === "destroyed") {
            recoveryRef.current = null;
            setRecoveryAvailable(false);
            setStep("verified");
          } else {
            setRecoveryAvailable(true);
            setError(t.ccSwitchSetupGenericFailure);
            setStep("failure");
          }
          return;
        }
        case "timeout":
          await finishInterrupted("timedOut");
          if (!closed) setStep("external-timeout");
          return;
        case "changedInvalid":
          await finishInterrupted("readFailed");
          if (!closed) setStep("changed-invalid");
          return;
        case "readFailure":
          await finishInterrupted("readFailed");
          if (!closed) {
            setError(t.ccSwitchSetupGenericFailure);
            setStep("failure");
          }
          return;
      }
    };
    void poll();
    return () => {
      closed = true;
      if (timer) globalThis.clearTimeout(timer);
    };
  }, [externalWaitTimeoutMs, pollIntervalMs, prepared, step, t]);

  const restore = async (): Promise<void> => {
    if (!prepared || submissionRef.current) return;
    submissionRef.current = true;
    setSubmitting(true);
    try {
      await restoreCcSwitchRecovery(prepared.recovery.snapshotId);
      recoveryRef.current = null;
      setRecoveryAvailable(false);
      setPrepared(null);
      setStep("user-cancelled");
    } catch (caught) {
      setError(t.ccSwitchSetupError(errorCode(caught)));
      setStep(
        errorCode(caught) === "ccswitch_recovery_stale_conflict"
          ? "stale-conflict"
          : "failure",
      );
    } finally {
      submissionRef.current = false;
      setSubmitting(false);
    }
  };

  const discard = async (): Promise<void> => {
    if (!prepared || submissionRef.current) return;
    submissionRef.current = true;
    setSubmitting(true);
    try {
      await discardCcSwitchRecovery(prepared.recovery.snapshotId, true);
      recoveryRef.current = null;
      setRecoveryAvailable(false);
      setPrepared(null);
      onClose();
    } catch (caught) {
      setError(t.ccSwitchSetupError(errorCode(caught)));
      setStep("failure");
    } finally {
      submissionRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  };

  return (
    <section className="ccswitch-card" aria-label={t.ccSwitchSetupTitle}>
      <div className="ccswitch-card-head">
        <div>
          <div className="ccswitch-card-title">{t.ccSwitchSetupTitle}</div>
          <div className="ccswitch-card-status" role="status" aria-live="polite">
            {t.ccSwitchSetupState(step)}
          </div>
        </div>
        <button
          type="button"
          className="ccswitch-close"
          onClick={() => void close()}
          aria-label={t.close}
        >
          ×
        </button>
      </div>

      {(step === "draft" || step === "unavailable" || step === "invalid") && (
        <form className="ccswitch-form" onSubmit={(event) => void validate(event)}>
          <label>
            <span>{t.ccSwitchSetupProviderName}</span>
            <input
              value={providerName}
              onChange={(event) => setProviderName(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            <span>{t.baseUrl}</span>
            <input
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="https://api.example.com/v1"
              autoComplete="url"
            />
          </label>
          <label>
            <span>{t.apiKey}</span>
            <input
              ref={apiKeyInputRef}
              onChange={(event) => setHasApiKey(event.target.value.trim().length > 0)}
              type="password"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {error && <p className="ccswitch-error">{error}</p>}
          <button type="submit" className="ccswitch-primary" disabled={!canValidate || submitting}>
            {t.ccSwitchSetupValidate}
          </button>
        </form>
      )}

      {step === "validating" && (
        <div className="ccswitch-state-panel" role="status" aria-live="polite">
          {t.ccSwitchSetupValidating}
        </div>
      )}

      {step === "model-ready" && catalog && (
        <div className="ccswitch-state-panel">
          <p>{t.ccSwitchSetupModelReady(catalog.models.length)}</p>
          <label>
            <span>{t.model}</span>
            <select
              value={selectedModelId}
              onChange={(event) => setSelectedModelId(event.target.value)}
              autoComplete="off"
            >
              {catalog.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ccswitch-check">
            <input
              type="checkbox"
              checked={switchImmediately}
              onChange={(event) => setSwitchImmediately(event.target.checked)}
            />
            {t.ccSwitchSetupSwitchImmediately}
          </label>
          <button
            type="button"
            className="ccswitch-primary"
            onClick={() => void selectModel()}
            disabled={!selectedModelId || submitting}
          >
            {t.ccSwitchSetupContinue}
          </button>
        </div>
      )}

      {step === "confirming" && (
        <div className="ccswitch-state-panel" role="alertdialog">
          <p>{t.ccSwitchSetupDisclosure}</p>
          <p>{t.ccSwitchSetupRecoveryDisclosure}</p>
          <div className="ccswitch-actions">
            <button
              type="button"
              className="ccswitch-primary"
              onClick={() => void launch()}
              disabled={submitting}
            >
              {t.ccSwitchSetupLaunch}
            </button>
            <button type="button" className="ccswitch-secondary" onClick={() => void cancel()}>
              {t.memorySensitiveCancel}
            </button>
          </div>
        </div>
      )}

      {(step === "launching" || step === "waiting-external-confirmation") && (
        <div className="ccswitch-state-panel" role="status" aria-live="polite">
          {step === "launching" ? t.ccSwitchSetupLaunching : t.ccSwitchSetupWaiting}
        </div>
      )}

      {step === "verified" && (
        <div className="ccswitch-state-panel ccswitch-good" role="status">
          {t.ccSwitchSetupVerified}
        </div>
      )}

      {(step === "external-timeout" || step === "changed-invalid" || step === "failure") && (
        <div className="ccswitch-state-panel">
          <p>
            {step === "external-timeout"
              ? t.ccSwitchSetupTimeout
              : step === "changed-invalid"
                ? t.ccSwitchSetupChangedInvalid(verification?.kind === "changedInvalid" ? verification.reason : "unknown")
                : (error ?? t.ccSwitchSetupGenericFailure)}
          </p>
          {recoveryAvailable && <div className="ccswitch-actions">
            <button
              type="button"
              className="ccswitch-secondary"
              onClick={() => {
                recoveryReturnStepRef.current = step;
                setStep("restore-confirmation");
              }}
            >
              {t.ccSwitchSetupRestore}
            </button>
            <button
              type="button"
              className="ccswitch-secondary"
              onClick={() => {
                recoveryReturnStepRef.current = step;
                setStep("discard-confirmation");
              }}
            >
              {t.ccSwitchSetupDiscard}
            </button>
          </div>}
        </div>
      )}

      {step === "restore-confirmation" && (
        <div className="ccswitch-state-panel" role="alertdialog">
          <p>{t.ccSwitchSetupRestoreDisclosure}</p>
          <div className="ccswitch-actions">
            <button type="button" className="ccswitch-primary" onClick={() => void restore()} disabled={submitting}>
              {t.ccSwitchSetupRestore}
            </button>
            <button
              type="button"
              className="ccswitch-secondary"
              onClick={() => setStep(recoveryReturnStepRef.current)}
            >
              {t.memorySensitiveCancel}
            </button>
          </div>
        </div>
      )}

      {step === "discard-confirmation" && (
        <div className="ccswitch-state-panel" role="alertdialog">
          <p>{t.ccSwitchSetupDiscardDisclosure}</p>
          <div className="ccswitch-actions">
            <button
              type="button"
              className="ccswitch-primary"
              onClick={() => void discard()}
              disabled={submitting}
            >
              {t.ccSwitchSetupDiscard}
            </button>
            <button
              type="button"
              className="ccswitch-secondary"
              onClick={() => setStep(recoveryReturnStepRef.current)}
            >
              {t.memorySensitiveCancel}
            </button>
          </div>
        </div>
      )}

      {step === "stale-conflict" && (
        <div className="ccswitch-state-panel ccswitch-error" role="alert">
          {t.ccSwitchSetupStaleConflict}
        </div>
      )}

      {step === "user-cancelled" && (
        <div className="ccswitch-state-panel" role="status">
          {t.ccSwitchSetupCancelled}
        </div>
      )}
    </section>
  );
}
