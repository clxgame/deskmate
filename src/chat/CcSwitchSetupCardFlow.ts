import type { FormEvent } from "react";
import {
  cancelCcSwitchSetup,
  completeCcSwitchRecovery,
  selectCcSwitchOpenCodeModel,
  validateCcSwitchOpenCodeProvider,
} from "../lib/ccswitch";
import { errorCode, ignoreAsyncError } from "./CcSwitchSetupCardLogic";
import type { CcSwitchSetupRuntime, PreparedSetup } from "./CcSwitchSetupCardTypes";

export async function validateSetup(
  runtime: CcSwitchSetupRuntime,
  event: FormEvent<HTMLFormElement>,
  canValidate: boolean,
): Promise<void> {
  event.preventDefault();
  if (!canValidate || runtime.refs.submissionRef.current) return;
  const apiKeyInput = runtime.refs.apiKeyInputRef.current;
  let apiKey = apiKeyInput?.value ?? "";
  if (!apiKey) return;
  const generation = runtime.refs.lifecycleGenerationRef.current;
  runtime.refs.submissionRef.current = true;
  runtime.setters.setSubmitting(true);
  runtime.setters.setStep("validating");
  runtime.setters.setError(null);
  try {
    const preparation = validateCcSwitchOpenCodeProvider({
      providerName: runtime.state.providerName,
      endpoint: runtime.state.endpoint,
      apiKey,
    });
    apiKey = "";
    runtime.clearApiKeyInput();
    const result = await preparation;
    if (!runtime.refs.mountedRef.current || runtime.refs.lifecycleGenerationRef.current !== generation) {
      await ignoreAsyncError(cancelCcSwitchSetup(result.selectionId));
      return;
    }
    runtime.refs.liveTicketRef.current = result.selectionId;
    runtime.setters.setCatalog(result);
    runtime.setters.setSelectedModelId(
      result.models.find((model) => model.id === runtime.draft?.modelHint)?.id ??
        result.models[0]?.id ??
        "",
    );
    runtime.setters.setStep("model-ready");
  } catch (caught) {
    apiKey = "";
    if (!runtime.refs.mountedRef.current || runtime.refs.lifecycleGenerationRef.current !== generation) return;
    const ticketId = runtime.refs.liveTicketRef.current;
    const code = caught instanceof Error ? errorCode(caught) : errorCode(caught);
    if (ticketId) await ignoreAsyncError(cancelCcSwitchSetup(ticketId));
    runtime.clearApiKeyInput();
    runtime.setters.setCatalog(null);
    runtime.setters.setPrepared(null);
    runtime.refs.liveTicketRef.current = null;
    runtime.setters.setError(runtime.t.ccSwitchSetupError(code));
    runtime.setters.setStep("invalid");
  } finally {
    runtime.refs.submissionRef.current = false;
    if (runtime.refs.mountedRef.current && runtime.refs.lifecycleGenerationRef.current === generation) {
      runtime.setters.setSubmitting(false);
    }
  }
}

function preparedFromSelection(result: Awaited<ReturnType<typeof selectCcSwitchOpenCodeModel>>): PreparedSetup {
  return {
    ticketId: result.receipt.ticketId,
    providerName: result.receipt.providerName,
    endpoint: result.receipt.endpoint,
    selectedModel: result.receipt.selectedModel,
    expiresAt: result.receipt.expiresAt,
    initial: result.recovery.original,
    recovery: result.recovery,
  };
}

export async function selectModel(runtime: CcSwitchSetupRuntime): Promise<void> {
  const current = runtime.state.catalog;
  if (!current || !runtime.state.selectedModelId || runtime.refs.submissionRef.current) return;
  const generation = runtime.refs.lifecycleGenerationRef.current;
  runtime.refs.submissionRef.current = true;
  runtime.setters.setSubmitting(true);
  runtime.setters.setStep("validating");
  runtime.setters.setError(null);
  try {
    const result = await selectCcSwitchOpenCodeModel({
      selectionId: current.selectionId,
      selectedModel: runtime.state.selectedModelId,
    });
    if (!runtime.refs.mountedRef.current || runtime.refs.lifecycleGenerationRef.current !== generation) {
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
    runtime.refs.liveTicketRef.current = result.receipt.ticketId;
    const prepared = preparedFromSelection(result);
    runtime.setters.setPrepared(prepared);
    runtime.refs.recoveryRef.current = result.recovery;
    runtime.setters.setRecoveryAvailable(true);
    runtime.setters.setCatalog(null);
    runtime.setters.setStep("confirming");
  } catch (caught) {
    if (!runtime.refs.mountedRef.current || runtime.refs.lifecycleGenerationRef.current !== generation) return;
    const code = caught instanceof Error ? errorCode(caught) : errorCode(caught);
    runtime.refs.liveTicketRef.current = null;
    runtime.setters.setCatalog(null);
    runtime.setters.setPrepared(null);
    runtime.setters.setError(runtime.t.ccSwitchSetupError(code));
    runtime.setters.setStep("invalid");
  } finally {
    runtime.refs.submissionRef.current = false;
    if (runtime.refs.mountedRef.current && runtime.refs.lifecycleGenerationRef.current === generation) {
      runtime.setters.setSubmitting(false);
    }
  }
}
