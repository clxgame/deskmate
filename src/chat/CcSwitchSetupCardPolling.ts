import { useEffect } from "react";
import {
  checkCcSwitchOpenCodeImport,
  completeCcSwitchRecovery,
  observeCcSwitchOpenCodeFiles,
  type CcSwitchObservedFiles,
} from "../lib/ccswitch";
import { currentConfigHash, observationsMatch } from "./CcSwitchSetupCardLogic";
import type { CcSwitchSetupRuntime, PreparedSetup } from "./CcSwitchSetupCardTypes";

async function completeInterrupted(
  runtime: CcSwitchSetupRuntime,
  current: PreparedSetup,
  kind: "timedOut" | "readFailed",
  closed: boolean,
): Promise<CcSwitchObservedFiles | null> {
  const observed = await observeCcSwitchOpenCodeFiles().catch(() => null);
  const retention = await completeCcSwitchRecovery({
    snapshotId: current.recovery.snapshotId,
    kind,
    observed,
  }).catch(() => "retained" as const);
  if (retention === "destroyed") {
    runtime.refs.recoveryRef.current = null;
    if (!closed) runtime.setters.setRecoveryAvailable(false);
  } else if (!closed) runtime.setters.setRecoveryAvailable(true);
  return observed;
}

async function pollImport(
  runtime: CcSwitchSetupRuntime,
  started: number,
  closed: () => boolean,
): Promise<void> {
  const prepared = runtime.state.prepared;
  if (!prepared || closed()) return;
  if (Date.now() - started >= runtime.externalWaitTimeoutMs) {
    const observed = await completeInterrupted(runtime, prepared, "timedOut", closed());
    if (!closed()) {
      runtime.setters.setVerification({
        kind: "timeout",
        changed: observed === null || !observationsMatch(observed, prepared.initial),
        currentHash: observed === null ? undefined : currentConfigHash(observed),
      });
      runtime.setters.setStep("external-timeout");
    }
    return;
  }
  const result = await checkCcSwitchOpenCodeImport({
    providerName: prepared.providerName,
    endpoint: prepared.endpoint,
    modelId: prepared.selectedModel,
    initial: prepared.initial,
  }).catch(() => ({ kind: "readFailure" as const }));
  if (closed()) return;
  runtime.setters.setVerification(result);
  switch (result.kind) {
    case "pending":
      globalThis.setTimeout(() => void pollImport(runtime, started, closed), runtime.pollIntervalMs);
      return;
    case "verified": {
      const retention = await completeCcSwitchRecovery({
        snapshotId: prepared.recovery.snapshotId,
        kind: "verified",
      }).catch(() => "retained" as const);
      if (closed()) return;
      if (retention === "destroyed") {
        runtime.refs.recoveryRef.current = null;
        runtime.setters.setRecoveryAvailable(false);
        runtime.setters.setPrepared(null);
        runtime.setters.setStep("verified");
      } else {
        runtime.setters.setRecoveryAvailable(true);
        runtime.setters.setError(runtime.t.ccSwitchSetupGenericFailure);
        runtime.setters.setStep("failure");
      }
      return;
    }
    case "timeout":
      await completeInterrupted(runtime, prepared, "timedOut", closed());
      if (!closed()) runtime.setters.setStep("external-timeout");
      return;
    case "changedInvalid":
      await completeInterrupted(runtime, prepared, "readFailed", closed());
      if (!closed()) runtime.setters.setStep("changed-invalid");
      return;
    case "readFailure":
      await completeInterrupted(runtime, prepared, "readFailed", closed());
      if (!closed()) {
        runtime.setters.setError(runtime.t.ccSwitchSetupGenericFailure);
        runtime.setters.setStep("failure");
      }
      return;
  }
}

export function useCcSwitchSetupPolling(runtime: CcSwitchSetupRuntime): void {
  useEffect(() => {
    if (runtime.state.step !== "waiting-external-confirmation" || !runtime.state.prepared) return;
    let closed = false;
    const isClosed = (): boolean => closed;
    void pollImport(runtime, Date.now(), isClosed);
    return () => {
      closed = true;
    };
  }, [
    runtime.externalWaitTimeoutMs,
    runtime.pollIntervalMs,
    runtime.state.prepared,
    runtime.state.step,
  ]);
}
