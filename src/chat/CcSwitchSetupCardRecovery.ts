import {
  cancelCcSwitchSetup,
  completeCcSwitchRecovery,
  discardCcSwitchRecovery,
  launchCcSwitchOpenCodeImport,
  observeCcSwitchOpenCodeFiles,
  restoreCcSwitchRecovery,
} from "../lib/ccswitch";
import { errorCode, ignoreAsyncError } from "./CcSwitchSetupCardLogic";
import type { CcSwitchSetupRuntime } from "./CcSwitchSetupCardTypes";

export async function cancelSetup(
  runtime: CcSwitchSetupRuntime,
): Promise<"destroyed" | "retained" | null> {
  runtime.refs.lifecycleGenerationRef.current += 1;
  runtime.refs.submissionRef.current = false;
  const current = runtime.state.prepared;
  const handleId = runtime.refs.liveTicketRef.current;
  runtime.refs.liveTicketRef.current = null;
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
      runtime.refs.recoveryRef.current = null;
      runtime.setters.setRecoveryAvailable(false);
    }
  }
  runtime.clearApiKeyInput();
  runtime.setters.setCatalog(null);
  if (retention === "retained") {
    runtime.setters.setRecoveryAvailable(true);
    runtime.setters.setError(runtime.t.ccSwitchSetupGenericFailure);
    runtime.setters.setStep("failure");
  } else {
    runtime.setters.setPrepared(null);
    runtime.setters.setStep("user-cancelled");
  }
  return retention;
}

export async function launchSetup(runtime: CcSwitchSetupRuntime): Promise<void> {
  const current = runtime.state.prepared;
  if (!current || runtime.refs.submissionRef.current) return;
  const generation = runtime.refs.lifecycleGenerationRef.current;
  runtime.refs.submissionRef.current = true;
  runtime.setters.setSubmitting(true);
  runtime.setters.setStep("launching");
  runtime.setters.setError(null);
  try {
    await launchCcSwitchOpenCodeImport({
      ticketId: current.ticketId,
      switchImmediately: runtime.state.switchImmediately,
      acceptedProcessArgumentDisclosure: true,
    });
    if (!runtime.refs.mountedRef.current || runtime.refs.lifecycleGenerationRef.current !== generation) return;
    runtime.refs.liveTicketRef.current = null;
    runtime.setters.setStep("waiting-external-confirmation");
  } catch (caught) {
    if (!runtime.refs.mountedRef.current || runtime.refs.lifecycleGenerationRef.current !== generation) return;
    const code = caught instanceof Error ? errorCode(caught) : errorCode(caught);
    runtime.setters.setError(runtime.t.ccSwitchSetupError(code));
    runtime.setters.setStep("failure");
  } finally {
    runtime.refs.submissionRef.current = false;
    if (runtime.refs.mountedRef.current && runtime.refs.lifecycleGenerationRef.current === generation) {
      runtime.setters.setSubmitting(false);
    }
  }
}

export async function restoreSetup(runtime: CcSwitchSetupRuntime): Promise<void> {
  const current = runtime.state.prepared;
  if (!current || runtime.refs.submissionRef.current) return;
  runtime.refs.submissionRef.current = true;
  runtime.setters.setSubmitting(true);
  try {
    await restoreCcSwitchRecovery(current.recovery.snapshotId);
    runtime.refs.recoveryRef.current = null;
    runtime.setters.setRecoveryAvailable(false);
    runtime.setters.setPrepared(null);
    runtime.setters.setStep("user-cancelled");
  } catch (caught) {
    const code = caught instanceof Error ? errorCode(caught) : errorCode(caught);
    runtime.setters.setError(runtime.t.ccSwitchSetupError(code));
    runtime.setters.setStep(
      code === "ccswitch_recovery_stale_conflict" ? "stale-conflict" : "failure",
    );
  } finally {
    runtime.refs.submissionRef.current = false;
    runtime.setters.setSubmitting(false);
  }
}

export async function discardSetup(runtime: CcSwitchSetupRuntime): Promise<void> {
  const current = runtime.state.prepared;
  if (!current || runtime.refs.submissionRef.current) return;
  runtime.refs.submissionRef.current = true;
  runtime.setters.setSubmitting(true);
  try {
    await discardCcSwitchRecovery(current.recovery.snapshotId, true);
    runtime.refs.recoveryRef.current = null;
    runtime.setters.setRecoveryAvailable(false);
    runtime.setters.setPrepared(null);
    runtime.onClose();
  } catch (caught) {
    const code = caught instanceof Error ? errorCode(caught) : errorCode(caught);
    runtime.setters.setError(runtime.t.ccSwitchSetupError(code));
    runtime.setters.setStep("failure");
  } finally {
    runtime.refs.submissionRef.current = false;
    if (runtime.refs.mountedRef.current) runtime.setters.setSubmitting(false);
  }
}
