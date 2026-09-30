// allow: SIZE_OK — legacy chat composition root; Agent history behavior lives in useAgentHistoryView and this file only wires existing chat primitives.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import { ToolApprovalCards } from "./ToolApprovalCards";
import { useToolPermissions } from "./useToolPermissions";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDirectory } from "@tauri-apps/plugin-dialog";
import {
  abortSession,
  confirmPromptSubmission,
  createSession,
  getSessionMessages,
  promptAsync,
  subscribeEvents,
  waitForServer,
  SessionAbortError,
  type OpenCodeEvent,
} from "../lib/opencode";
import { broadcastMood, broadcastPetActivity } from "../lib/petState";
import { recordCompletedAiUsage } from "../lib/localAiUsage";
import { createChatPetActivity } from "./petActivity";
import { DEFAULT_PERSONA_ID } from "../pet/personaCatalog";
import {
  XIAOZHU_IDENTITY_REPLY,
  XIAOZHU_NAME_ORIGIN_LINES,
  isXiaozhuIdentityQuestion,
  isXiaozhuNameOriginQuestion,
  personaDisplayName,
  personalizePersonaCopy,
  resolvePersonaId,
  shouldResetSessionForPersona,
  userNameInstruction,
} from "./chatPersona";
import {
  composeSystemPrompt,
  memoryBlockForTurn,
} from "./memoryActions";
import {
  getSettings,
  onResourceError,
  onSettingsChanged,
  type Settings,
} from "../lib/settings";
import { memoryForgetConversation } from "../lib/memory";
import type { ThemeId } from "../settings/theme";
import { dict, type Lang } from "../lib/i18n";
import { AppIcon } from "../ui/AppIcon";
import {
  type HistorySession,
} from "../lib/history";
import {
  type ModelReadyAttachment,
  type OpenCodeFilePart,
} from "./attachments";
import { ArtifactCard } from "./ArtifactCard";
import { AttachmentTray } from "./AttachmentTray";
import { LocalResourceTray } from "./LocalResourceTray";
import { MessageLocalResources } from "./MessageLocalResources";
import { useLocalResources } from "./useLocalResources";
import { isMediaFile, prepareChatResources, stripLocalResourceContext, type LocalResource } from "./localResources";
import { localResourceError } from "./localResourceCopy";
import { ChatText } from "./ChatText";
import { ChatNavigation } from "./ChatNavigation";
import { useWorklogChat } from "./useWorklogChat";
import { WorklogReceipt, worklogChatCopy } from "./WorklogReceipt";
import { buildWorklogSystemInstruction, newUserMessageId, registerWorklogTurn, WORKLOG_TOOLS } from "./worklogActions";
import { buildCurrentInformationInstruction } from "./currentInformation";
import { webSearchSites } from "./webSearchSites";
import { CcSwitchSetupCard } from "./CcSwitchSetupCard";
import { WorkspaceTask } from "./WorkspaceTask";
import { ModelPicker, WorkspacePicker } from "./ComposerPickers";
import { composerCopy, folderErrorCopy, modelErrorCopy } from "./composerCopy";
import { INHERIT_MODEL, getConversationModel, resolveConversationModel, setConversationModel, type ChatModelChoice, type ConversationModelSelection } from "../lib/conversationModel";
import { useAgentRun } from "./useAgentRun";
import { useAgentHistoryView } from "./useAgentHistoryView";
import { HistoryOrganizer } from "./HistoryOrganizer";
import { catalogLoad, saveLocalMessages, type UnifiedHistoryRow } from "../lib/unifiedHistory";
import { validateSharedConversation, loadSharedConversation, conversationReadOnlyReason } from "./sharedConversation";
import { useHistoryOrganizerRequest } from "./useHistoryOrganizerRequest";
import {
  CCSWITCH_PREPARE_OPENCODE_PROVIDER_TOOL,
  createCcSwitchToolResultTracker,
  recoverCcSwitchToolResultsFromMessages,
  toOpenCodeToolPart,
  type CcSwitchProviderDraft,
  type CcSwitchToolResult,
} from "./ccSwitchSetup";
import { useChatAttachments, type LocalAttachmentArtifact } from "./useChatAttachments";
import type { PreparedModelAttachments } from "./useChatAttachmentsUtils";
import "./chat.css";

interface TextChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  activity?: ToolActivity;
  attachments?: ModelReadyAttachment[];
  resources?: readonly LocalResource[];
  readonly nativeMessageId?: string;
  readonly localOnly?: boolean;
  readonly time?: number;
}

interface ArtifactChatMessage {
  id: string;
  role: "artifact";
  text: "";
  artifactId: string;
}

interface CcSwitchSetupRequestPayload {
  readonly source?: string;
}

type ChatMessage = TextChatMessage | ArtifactChatMessage;

type WebSearchActivity = {
  readonly kind: "websearch";
  readonly running: boolean;
  readonly sites: readonly string[];
};

type ToolActivity = string | WebSearchActivity;

export function containsCcSwitchApiKey(text: string): boolean {
  if (!/(cc\s*switch|opencode)/iu.test(text)) return false;
  return (
    /\bsk-[a-z0-9_-]{8,}/iu.test(text) ||
    /\bbearer\s+[a-z0-9._-]{8,}/iu.test(text) ||
    /["']?(?:api[\s_-]?key|token|secret)["']?\s*[:=]\s*["']?[a-z0-9._-]{8,}/iu.test(
      text,
    )
  );
}

interface PersonaData {
  persona: string;
  skills?: string;
  placeholders: {
    streaming?: string;
    completed?: string;
    error?: string;
  } | null;
}

type Status = "booting" | "ready" | "busy" | "error";

type View = "chat" | "history";

const MIN_REPLY_PRESENTATION_MS = 2_000;
const FIXED_REPLY_TYPING_DELAY_MS = MIN_REPLY_PRESENTATION_MS / 2;
const EMPTY_PREPARED_ATTACHMENTS: PreparedModelAttachments = {
  fileParts: [],
  fallbackPrompt: null,
  shouldSendToModel: false,
};

interface BufferedAssistantUpdate {
  messageID: string;
  hasText: boolean;
  text?: string;
  activity?: ToolActivity;
}

interface ReplyPacing {
  id: number;
  released: boolean;
  completed: boolean;
  pendingUpdates: Map<string, BufferedAssistantUpdate>;
  releaseTimer: ReturnType<typeof globalThis.setTimeout> | null;
}

function waitForDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });
}

function settleToolActivity(activity: ToolActivity | undefined): ToolActivity | undefined {
  return typeof activity === "object" ? { ...activity, running: false } : undefined;
}

function preserveWebSearchActivity(activity: ToolActivity | undefined): ToolActivity | undefined {
  return typeof activity === "object" ? activity : undefined;
}

function historyChatMessages(session: HistorySession): ChatMessage[] {
  return session.messages.map((message, index) => ({
    id: message.partId ?? message.messageId ?? `history-${index}`,
    nativeMessageId: message.messageId,
    role: message.role,
    text: message.text,
  }));
}

function runMatchesConversation(run: { sessionId: string | null; workspacePath: string } | null, entry: UnifiedHistoryRow | null): boolean {
  if (!run || entry?.identity.kind !== "native" || run.sessionId !== entry.identity.sessionId) return false;
  const normalize = (path: string) => {
    const slash = path.replace(/\\/g, "/").replace(/\/+$/, "");
    return /^[A-Za-z]:/.test(slash) || slash.startsWith("//") ? slash.toLowerCase() : slash;
  };
  return normalize(run.workspacePath) === normalize(entry.identity.directory);
}

export default function ChatApp() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>("booting");
  const [isPersonaTyping, setIsPersonaTyping] = useState(false);
  const [lang, setLang] = useState("zh-CN");
  const resourceLanguage: Lang = lang === "en-US" || lang === "ja-JP" || lang === "ko-KR" ? lang : "zh-CN";
  const [theme, setTheme] = useState<ThemeId>("dark");
  const [activePersonaId, setActivePersonaId] = useState(DEFAULT_PERSONA_ID);
  const [view, setView] = useState<View>("chat");
  const showOrganizer = useCallback(() => setView("history"), []);
  useHistoryOrganizerRequest(showOrganizer);
  const [catalogEntry, setCatalogEntry] = useState<UnifiedHistoryRow | null>(null);
  const [modelSelection, setModelSelection] = useState<ConversationModelSelection>(INHERIT_MODEL);
  const modelSelectionRef = useRef<ConversationModelSelection>(INHERIT_MODEL);
  const [resolvedModel, setResolvedModel] = useState<ChatModelChoice | null>(null);
  const [modelNotice, setModelNotice] = useState<string | null>(null);
  const modelRequestRef = useRef(0);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [pendingWorkspace, setPendingWorkspace] = useState<{ path: string; generation: number } | null>(null);
  const [openPicker, setOpenPicker] = useState<"folder" | "model" | null>(null);
  const composerAnchor = useRef<HTMLElement>(null);
  const folderLockedRef = useRef(true);
  const catalogEntryRef = useRef<UnifiedHistoryRow | null>(null);
  const viewGenerationRef = useRef(0);
  const localReplySnapshotRef = useRef(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const currentDirectory = catalogEntry?.identity.kind === "native" ? catalogEntry.identity.directory : undefined;
  const sessionDirectory = () => catalogEntryRef.current?.identity.kind === "native" ? catalogEntryRef.current.identity.directory : undefined;

  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [workbenchOpenError, setWorkbenchOpenError] = useState<{
    readonly sessionId: string;
    readonly reason: "missing" | "failed";
  } | null>(null);
  const openInWorkbench = useCallback(async (sessionId: string, directory?: string) => {
    setWorkbenchOpenError(null);
    try {
      await invoke("workbench_open_session", { sessionId, directory });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setWorkbenchOpenError({
        sessionId,
        reason: message === "history_native_missing" ? "missing" : "failed",
      });
    }
  }, []);
  const [isCancelling, setIsCancelling] = useState(false);
  /** Whether the current session's input is owned by the workbench (§8.1):
   * the light chat then defers its send/approve/cancel handlers for it. */
  const [sessionOwnedByWorkbench, setSessionOwnedByWorkbench] = useState(false);
  const [workbenchSessionStateUnknown, setWorkbenchSessionStateUnknown] =
    useState(false);
  useEffect(() => {
    let cancelled = false;
    let checking = false;
    let ownershipObserved = false;
    const check = async () => {
      if (!currentSessionId) {
        setSessionOwnedByWorkbench(false);
        setWorkbenchSessionStateUnknown(false);
        return;
      }
      if (checking) return;
      checking = true;
      try {
        const owned = await invoke<boolean>("workbench_session_owned", {
          sessionId: currentSessionId,
          directory: currentDirectory,
        });
        if (cancelled) return;
        if (owned) {
          ownershipObserved = true;
          setSessionOwnedByWorkbench(true);
          setWorkbenchSessionStateUnknown(false);
          return;
        }
        if (!ownershipObserved) {
          setSessionOwnedByWorkbench(false);
          setWorkbenchSessionStateUnknown(false);
          return;
        }
        const snapshot = await invoke<{ state: "busy" | "idle" | "unavailable" }>(
          "workbench_session_status",
          { sessionId: currentSessionId, directory: currentDirectory },
        );
        if (cancelled) return;
        if (snapshot.state === "unavailable") {
          setSessionOwnedByWorkbench(true);
          setWorkbenchSessionStateUnknown(true);
          return;
        }
        ownershipObserved = false;
        setSessionOwnedByWorkbench(false);
        setWorkbenchSessionStateUnknown(false);
        setStatus((current) => {
          if (snapshot.state === "busy") return "busy";
          return current === "busy" ? "ready" : current;
        });
      } catch {
        if (cancelled) return;
        if (ownershipObserved) {
          setSessionOwnedByWorkbench(true);
          setWorkbenchSessionStateUnknown(true);
        } else {
          setSessionOwnedByWorkbench(false);
        }
      } finally {
        checking = false;
      }
    };
    void check();
    // Ownership can change while we are already on this session (handoff from
    // this window, or the workbench hiding); re-check on every such change.
    const unlisten = listen("workbench://ownership-changed", () => void check());
    const timer = window.setInterval(() => void check(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      void unlisten.then((off) => off());
    };
  }, [currentSessionId, currentDirectory]);
  const worklog = useWorklogChat(currentSessionId);
  const [memoryNotice, setMemoryNotice] = useState<string | null>(null);
  const [ccSwitchDraft, setCcSwitchDraft] = useState<CcSwitchProviderDraft | null>(
    null,
  );
  const [ccSwitchSetupOpen, setCcSwitchSetupOpen] = useState(false);
  const t = dict(lang);
  // Latest dict for use inside stable callbacks (SSE handler, task listener).
  const tRef = useRef(t);
  tRef.current = t;
  const sessionRef = useRef<string | null>(null);
  const permissions = useToolPermissions(currentSessionId, status === "busy");
  const agent = useAgentRun(lang);
  useEffect(() => {
    if (status === "busy" || agent.busy) return;
    const token = ++modelRequestRef.current;
    void resolveConversationModel(modelSelection).then(model => {
      if (token !== modelRequestRef.current) return;
      setResolvedModel(model); setModelNotice(null);
    }).catch(cause => {
      if (token !== modelRequestRef.current) return;
      setResolvedModel(null);
      setModelNotice(modelErrorCopy(lang, cause));
    });
  }, [modelSelection, settingsRevision, status, agent.busy, lang]);
  const {
    viewedId: agentHistoryId,
    archive: agentHistoryArchive,
    open: openHistory,
    openScoped: openScopedAgentHistory,
    leave: leaveAgentHistory,
  } = useAgentHistoryView(agent.projection.active?.sessionId ?? null);
  const canContinueAgentHistory = agentHistoryId !== null && agentHistoryArchive?.agentDetails?.status !== "active"
    && catalogEntry?.ownership === "agent" && !catalogEntry.archived && catalogEntry.availability === "available";
  const readOnlyHistory = catalogEntry !== null && !catalogEntry.capabilities.send && !canContinueAgentHistory;
  const refreshSelectedConversation = useCallback(async (key: string) => {
    const displayed = catalogEntryRef.current;
    const generation = viewGenerationRef.current;
    if (!displayed || displayed.key !== key) return;
    try {
      const loaded = await loadSharedConversation(displayed);
      if (generation !== viewGenerationRef.current || catalogEntryRef.current?.key !== key) return;
      catalogEntryRef.current = loaded.entry;
      setCatalogEntry(loaded.entry);
    } catch (cause) {
      if (generation !== viewGenerationRef.current || catalogEntryRef.current?.key !== key) return;
      const unavailable: UnifiedHistoryRow = { ...displayed, availability: "unavailable", runtime: "unknown",
        capabilities: { ...displayed.capabilities, send: false, readOnlyReason: "native_unavailable" } };
      catalogEntryRef.current = unavailable;
      setCatalogEntry(unavailable);
      console.warn("selected conversation unavailable", cause instanceof Error ? cause.message : String(cause));
    }
  }, []);
  useEffect(() => {
    const key = catalogEntry?.key;
    if (!key) return;
    let disposed = false;
    const subscription = listen("history-catalog-changed", () => {
      if (!disposed) void refreshSelectedConversation(key);
    }).catch(cause => {
      console.warn("history listener unavailable", cause instanceof Error ? cause.message : String(cause));
      return () => undefined;
    });
    return () => {
      disposed = true;
      void subscription.then(stop => stop());
    };
  }, [catalogEntry?.key, refreshSelectedConversation]);
  const agentHistoryActiveRef = useRef(agentHistoryId !== null);
  useLayoutEffect(() => {
    agentHistoryActiveRef.current = agentHistoryId !== null;
  }, [agentHistoryId]);
  const [petActivity] = useState(() => createChatPetActivity(broadcastPetActivity));
  const personaRef = useRef<PersonaData | null>(null);
  const activePersonaIdRef = useRef(DEFAULT_PERSONA_ID);
  const personaLoadRef = useRef<Promise<void>>(Promise.resolve());
  const personaLoadSequenceRef = useRef(0);
  const settingsRef = useRef<Settings | null>(null);
  /** role by server messageID; used to skip user-message parts in SSE. */
  const rolesRef = useRef<Map<string, string>>(new Map());
  const listRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const lastScrollUserRef = useRef<string | undefined>(undefined);
  const dragDepthRef = useRef(0);
  /** mirror of `messages` for persisting history outside render. */
  const messagesRef = useRef<ChatMessage[]>([]);
  const fixedReplySequenceRef = useRef(0);
  const replyPacingRef = useRef<ReplyPacing | null>(null);
  const replyPacingSequenceRef = useRef(0);
  const ccSwitchDraftRef = useRef<CcSwitchProviderDraft | null>(null);
  const ccSwitchToolTrackerRef = useRef(createCcSwitchToolResultTracker());

  const appendArtifactMessage = useCallback((artifact: LocalAttachmentArtifact) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `artifact-${artifact.state.artifact.id}-${Date.now()}`,
        role: "artifact",
        text: "",
        artifactId: artifact.state.artifact.id,
      },
    ]);
  }, []);

  const reportAttachmentBackgroundError = useCallback((message: string) => {
    setAttachmentError(message);
  }, []);

  const chatAttachments = useChatAttachments({
    sessionId: currentSessionId ?? "",
    personaId: activePersonaId,
    onArtifact: appendArtifactMessage,
    onBackgroundError: reportAttachmentBackgroundError,
  });
  const cleanupAttachmentSession = chatAttachments.cleanupSession;
  const discardSentAttachmentSources = chatAttachments.discardSentSources;
  const resetAttachmentSession = chatAttachments.resetSession;
  const localResources = useLocalResources({
    scopeKey: `${currentSessionId ?? ""}:${agent.workspace ?? ""}:${agentHistoryId ?? ""}`,
    active: view === "chat" && status === "ready" && !!currentSessionId && !isSubmitting && !agent.busy && !historyLoading && !readOnlyHistory && !sessionOwnedByWorkbench,
    useLegacyFiles: !agent.workspace && !agentHistoryId,
    onLegacyFiles: files => stageAttachmentFiles(files),
    onError: message => reportAttachmentBackgroundError(localResourceError(resourceLanguage, message)),
  });
  const attachmentBusy = localResources.pending || chatAttachments.items.some((item) => item.kind === "staging");
  const attachmentBlocked = chatAttachments.items.some(
    (item) => item.kind === "failed" && item.phase === "staging",
  );

  const clearReplyPacing = () => {
    const pacing = replyPacingRef.current;
    if (pacing?.releaseTimer !== null && pacing?.releaseTimer !== undefined) {
      globalThis.clearTimeout(pacing.releaseTimer);
    }
    replyPacingRef.current = null;
  };

  const finishPacedReply = (pacing: ReplyPacing) => {
    if (replyPacingRef.current !== pacing) return;
    clearReplyPacing();
    setIsPersonaTyping(false);
    setStatus("ready");
    broadcastMood("idle");
    setMessages((prev) =>
      prev.map((message) =>
        isTextChatMessage(message) && message.activity
          ? { ...message, activity: settleToolActivity(message.activity) }
          : message,
      ),
    );
  };

  const releaseReplyPacing = (id: number) => {
    const pacing = replyPacingRef.current;
    if (!pacing || pacing.id !== id) return;
    pacing.released = true;
    pacing.releaseTimer = null;
    const pendingUpdates = Array.from(pacing.pendingUpdates.values());
    pacing.pendingUpdates.clear();
    const visibleUpdates = pendingUpdates.filter(
      (update) => update.hasText || update.activity !== undefined,
    );
    if (visibleUpdates.length > 0) {
      setMessages((prev) =>
        visibleUpdates.reduce(
          (next, update) =>
            upsertAssistant(next, update.messageID, (message) =>
              update.hasText
                ? {
                    ...message,
                    text: update.text ?? "",
                    activity: update.activity,
                  }
                : { ...message, activity: update.activity },
            ),
          prev,
        ),
      );
    }
    if (pacing.completed) finishPacedReply(pacing);
  };

  const startReplyPacing = (): number => {
    clearReplyPacing();
    const id = replyPacingSequenceRef.current + 1;
    replyPacingSequenceRef.current = id;
    const pacing: ReplyPacing = {
      id,
      released: false,
      completed: false,
      pendingUpdates: new Map(),
      releaseTimer: null,
    };
    replyPacingRef.current = pacing;
    pacing.releaseTimer = globalThis.setTimeout(() => {
      releaseReplyPacing(id);
    }, MIN_REPLY_PRESENTATION_MS);
    return id;
  };

  const queueAssistantText = (messageID: string, text: string) => {
    const pacing = replyPacingRef.current;
    if (!pacing || pacing.released) {
      setMessages((prev) =>
        upsertAssistant(prev, messageID, (message) => ({
          ...message,
          text,
          activity: preserveWebSearchActivity(message.activity),
        })),
      );
      return;
    }
    const current = pacing.pendingUpdates.get(messageID);
    pacing.pendingUpdates.set(messageID, {
      messageID,
      hasText: true,
      text,
      activity: preserveWebSearchActivity(current?.activity),
    });
  };

  const queueAssistantTool = (messageID: string, activity: ToolActivity) => {
    const pacing = replyPacingRef.current;
    if (!pacing || pacing.released) {
      setMessages((prev) =>
        upsertAssistant(prev, messageID, (message) => ({
          ...message,
          activity,
        })),
      );
      return;
    }
    const current = pacing.pendingUpdates.get(messageID);
    pacing.pendingUpdates.set(messageID, {
      messageID,
      hasText: current?.hasText ?? false,
      text: current?.text,
      activity,
    });
  };

  const clearAssistantTool = (messageID: string) => {
    const pacing = replyPacingRef.current;
    if (!pacing || pacing.released) {
      setMessages((prev) =>
        prev.flatMap((message) => {
          if (message.id !== messageID) return [message];
          const next = { ...message, activity: undefined };
          return next.role === "assistant" && !hasVisibleMessageContent(next)
            ? []
            : [next];
        }),
      );
      return;
    }
    const current = pacing.pendingUpdates.get(messageID);
    if (!current) return;
    if (!current.hasText) {
      pacing.pendingUpdates.delete(messageID);
      return;
    }
    pacing.pendingUpdates.set(messageID, { ...current, activity: undefined });
  };

  const completeReplyPacing = () => {
    const pacing = replyPacingRef.current;
    if (!pacing) {
      setIsPersonaTyping(false);
      setStatus("ready");
      broadcastMood("idle");
      setMessages((prev) =>
        prev.map((message) =>
          isTextChatMessage(message) && message.activity
            ? { ...message, activity: settleToolActivity(message.activity) }
            : message,
        ),
      );
      return;
    }
    pacing.completed = true;
    if (pacing.released) finishPacedReply(pacing);
  };

  const waitForFixedReplyStart = async (sequence: number): Promise<boolean> => {
    await waitForDelay(FIXED_REPLY_TYPING_DELAY_MS);
    if (fixedReplySequenceRef.current !== sequence) return false;
    setIsPersonaTyping(true);
    petActivity.mood("thinking");
    broadcastMood("thinking");
    await waitForDelay(FIXED_REPLY_TYPING_DELAY_MS);
    return fixedReplySequenceRef.current === sequence;
  };

  useEffect(() => {
    return () => {
      petActivity.cancel();
      fixedReplySequenceRef.current += 1;
      clearReplyPacing();
    };
  }, []);

  useEffect(() => {
    const subscription = listen<CcSwitchSetupRequestPayload | null>(
      "deskmate://ccswitch-setup-request",
      ({ payload }) => {
        if (payload?.source !== "settings") {
          const draft: CcSwitchProviderDraft = {
            callID: "manual",
            credentialMode: "manual",
          };
          ccSwitchDraftRef.current = draft;
          setCcSwitchDraft(draft);
          setCcSwitchSetupOpen(true);
          setView("chat");
          return;
        }
        void (async () => {
          const settings =
            settingsRef.current ?? (await getSettings().catch(() => null));
          const activeProvider =
            settings?.providers.find(
              (provider) => provider.id === settings.activeProviderId,
            ) ?? settings?.providers[0];
          const draft: CcSwitchProviderDraft = {
            callID: "settings",
            credentialMode: "saved-settings",
            providerName: "YUME OpenCode",
            baseUrl: activeProvider?.baseUrl ?? settings?.baseUrl,
            modelHint: settings?.modelId,
          };
          ccSwitchDraftRef.current = draft;
          setCcSwitchDraft(draft);
          setCcSwitchSetupOpen(true);
          setView("chat");
        })();
      },
    );
    return () => {
      void subscription.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, []);

  const resetSession = useCallback(async (preserveComposer = false): Promise<boolean> => {
    const generation = ++viewGenerationRef.current;
    const previousSession = sessionRef.current;
    const carriedSelection = modelSelectionRef.current;
    await waitForServer();
    const session = await createSession("YUME chat");
    const registered = await invoke<UnifiedHistoryRow>("history_register_native_session", {
      sessionId: session.id,
      directory: session.directory,
      source: "light_chat",
    });
    if (viewGenerationRef.current !== generation) return false;
    let ready = registered;
    let statusUnavailable = false;
    try {
      ready = (await loadSharedConversation(registered)).entry;
    } catch (error: unknown) {
      statusUnavailable = true;
      console.warn("new conversation status unavailable", error instanceof Error ? error.message : String(error));
    }
    if (viewGenerationRef.current !== generation) return false;
    if (preserveComposer && carriedSelection.mode === "override") {
      await setConversationModel(ready.key, carriedSelection);
    }
    if (previousSession && catalogEntryRef.current?.capabilities.send) {
      await abortSession(previousSession, sessionDirectory()).catch(() => undefined);
      await cleanupAttachmentSession(previousSession);
    }
    petActivity.cancel();
    fixedReplySequenceRef.current += 1;
    clearReplyPacing();
    setIsPersonaTyping(false);
    const nextSelection = preserveComposer ? carriedSelection : INHERIT_MODEL;
    modelSelectionRef.current = nextSelection;
    setModelSelection(nextSelection);
    setResolvedModel(null);
    setSettingsRevision(value => value + 1);
    catalogEntryRef.current = ready;
    setCatalogEntry(ready);
    setMemoryNotice(statusUnavailable ? tRef.current.sessionStateUnknown : null);
    localReplySnapshotRef.current = false;
    setHistoryLoading(false);
    sessionRef.current = session.id;
    setCurrentSessionId(session.id);
    resetAttachmentSession(session.id);
    rolesRef.current.clear();
    ccSwitchDraftRef.current = null;
    ccSwitchToolTrackerRef.current = createCcSwitchToolResultTracker();
    setCcSwitchDraft(null);
    setCcSwitchSetupOpen(false);
    setMessages([]);
    if (!preserveComposer) setInput("");
    setView("chat");
    setStatus("ready");
    broadcastMood("idle");
    return true;
  }, [cleanupAttachmentSession, resetAttachmentSession, petActivity]);

  const loadPersona = useCallback((id: string): Promise<void> => {
    const resolvedId = resolvePersonaId(id);
    const sequence = ++personaLoadSequenceRef.current;
    const request = invoke<PersonaData>("load_persona", { id: resolvedId })
      .then((data) => {
        if (sequence !== personaLoadSequenceRef.current) return;
        personaRef.current = data;
        activePersonaIdRef.current = resolvedId;
        setActivePersonaId(resolvedId);
      })
      .catch((error: unknown) => {
        console.error(
          "persona load failed",
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    personaLoadRef.current = request;
    return request;
  }, []);

  const noticeForCcSwitchResult = useCallback(
    (result: CcSwitchToolResult): string | null => {
      const dict = tRef.current;
      switch (result.kind) {
        case "draft":
          return `${dict.ccSwitchStatusTitle}: ${dict.ccSwitchSetupOpen}`;
        case "notice":
          return result.reason === "secret_field"
            ? dict.memorySecretRejected
            : `${dict.chatErrorPrefix}: ${dict.ccSwitchStatusTitle}`;
        case "ordinary_tool":
        case "ignored":
          return null;
      }
    },
    [],
  );

  const applyCcSwitchToolResult = useCallback(
    (messageID: string, result: CcSwitchToolResult) => {
      switch (result.kind) {
        case "draft":
          ccSwitchDraftRef.current = result.draft;
          setCcSwitchDraft(result.draft);
          setCcSwitchSetupOpen(true);
          clearAssistantTool(messageID);
          setMemoryNotice(noticeForCcSwitchResult(result));
          return;
        case "notice":
          clearAssistantTool(messageID);
          setMemoryNotice(noticeForCcSwitchResult(result));
          return;
        case "ordinary_tool":
          broadcastMood("working");
          queueAssistantTool(messageID, result.label);
          return;
        case "ignored":
          return;
      }
    },
    [noticeForCcSwitchResult],
  );

  const recoverCcSwitchToolResultsOnIdle = useCallback(
    async (sessionID: string) => {
      try {
        const results = recoverCcSwitchToolResultsFromMessages(
          await getSessionMessages(sessionID, sessionDirectory()),
          ccSwitchToolTrackerRef.current,
        );
        results.forEach((result, index) => {
          applyCcSwitchToolResult(`ccswitch-recovery-${index}`, result);
        });
      } catch {
        setMemoryNotice(`${tRef.current.chatErrorPrefix}: ${tRef.current.ccSwitchStatusTitle}`);
      }
    },
    [applyCcSwitchToolResult],
  );

  // Boot: wait for sidecar, load persona, create session, subscribe SSE.
  useEffect(() => {
    let closed = false;
    let stopSettingsListener: (() => void) | null = null;

    (async () => {
      try {
        settingsRef.current = await getSettings().catch(() => null);
        if (closed) return;
        const initialPersonaId = resolvePersonaId(
          settingsRef.current?.personaId,
        );
        if (settingsRef.current) {
          setLang(settingsRef.current.language);
          setTheme(settingsRef.current.theme);
        }
        await loadPersona(initialPersonaId);
        const settingsListener = await onSettingsChanged((s) => {
          settingsRef.current = s;
          setSettingsRevision(value => value + 1);
          setLang(s.language);
          setTheme(s.theme);
          const nextPersonaId = resolvePersonaId(s.personaId);
          if (
            shouldResetSessionForPersona(
              activePersonaIdRef.current,
              nextPersonaId,
            )
          ) {
            const switchRequest = loadPersona(nextPersonaId).then(async () => {
              if (activePersonaIdRef.current === nextPersonaId) await resetSession();
            });
            personaLoadRef.current = switchRequest;
            void switchRequest.catch((error: unknown) => {
              console.error(
                "persona session reset failed",
                error instanceof Error ? error : new Error(String(error)),
              );
            });
          }
        });
        // Unmounting while the listener was still being registered must still
        // detach it, otherwise it outlives the component.
        if (closed) {
          settingsListener();
          return;
        }
        stopSettingsListener = settingsListener;
        await resetSession();
        if (closed) return;
        setStatus("ready");
        broadcastMood("idle");
      } catch (error: unknown) {
        if (closed) return;
        console.error(
          error instanceof Error ? error : new Error(String(error)),
        );
        setStatus("error");
        broadcastMood("error");
      }
    })();

    return () => {
      closed = true;
      personaLoadSequenceRef.current += 1;
      stopSettingsListener?.();
    };
  }, [loadPersona, resetSession]);

  const handleEvent = useCallback((e: OpenCodeEvent) => {
    if (agentHistoryActiveRef.current) return;
    const props = e.properties ?? {};

    switch (e.type) {
      case "message.updated": {
        const info = props.info as {
          id: string;
          sessionID: string;
          role: string;
        };
        if (info.sessionID === sessionRef.current) {
          rolesRef.current.set(info.id, info.role);
          petActivity.message(props.info);
          void recordCompletedAiUsage(props.info).catch(() => {});
        }
        break;
      }
      case "message.part.updated": {
        const part = props.part as {
          sessionID: string;
          messageID: string;
          type: string;
          text?: string;
          tool?: string;
          state?: { title?: string; status?: string };
        };
        if (part.sessionID !== sessionRef.current) return;
        petActivity.part(props.part);
        // Parts of the user's own message echo back over SSE; skip them.
        if (rolesRef.current.get(part.messageID) === "user") return;

        if (part.type === "text") {
          setIsPersonaTyping(true);
          broadcastMood("talking");
          queueAssistantText(part.messageID, part.text ?? "");
        } else if (part.type === "tool") {
          if (WORKLOG_TOOLS.some((tool) => tool === part.tool)) {
            worklog.acceptTool(part);
            clearAssistantTool(part.messageID);
            return;
          }
          const toolPart = toOpenCodeToolPart(part);
          if (!toolPart) {
            if (part.tool === CCSWITCH_PREPARE_OPENCODE_PROVIDER_TOOL) {
              clearAssistantTool(part.messageID);
              setMemoryNotice(`${tRef.current.chatErrorPrefix}: ${tRef.current.ccSwitchStatusTitle}`);
              return;
            }
            broadcastMood("working");
            queueAssistantTool(part.messageID, part.state?.title || part.tool || "tool");
            return;
          }
          if (toolPart.tool === "websearch") {
            const running =
              toolPart.state.status === "pending" || toolPart.state.status === "running";
            if (running) broadcastMood("working");
            queueAssistantTool(toolPart.messageID, {
              kind: "websearch",
              running,
              sites: webSearchSites(toolPart),
            });
            return;
          }
          applyCcSwitchToolResult(
            toolPart.messageID,
            ccSwitchToolTrackerRef.current.acceptToolPart(toolPart, {
              role: rolesRef.current.get(toolPart.messageID),
            }),
          );
        }
        break;
      }
      case "session.status": {
        if (props.sessionID !== sessionRef.current) return;
        const s = (props.status as { type: string } | undefined)?.type;
        if (s === "busy") {
          setStatus("busy");
          broadcastMood("thinking");
        }
        break;
      }
      case "session.idle": {
        if (props.sessionID !== sessionRef.current) return;
        petActivity.idle(props.sessionID);
        if (typeof props.sessionID === "string") {
          void recoverCcSwitchToolResultsOnIdle(props.sessionID);
          void worklog.recover(props.sessionID);
        }
        completeReplyPacing();
        break;
      }
      case "session.error": {
        if (props.sessionID && props.sessionID !== sessionRef.current) return;
        petActivity.sessionError(props.sessionID);
        clearReplyPacing();
        setIsPersonaTyping(false);
        setStatus("ready");
        broadcastMood("error");
        const err = props.error as
          { name?: string; data?: { message?: string } } | undefined;
        const detail = err?.data?.message || err?.name || "unknown error";
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "assistant",
            text: `${personaRef.current?.placeholders?.error ?? tRef.current.chatErrorPrefix}: ${detail}`,
          },
        ]);
        break;
      }
    }
  }, []);

  useEffect(() => {
    if (!currentSessionId || !currentDirectory) return;
    let closed = false;
    const subscription = subscribeEvents((event) => {
      const identity = catalogEntryRef.current?.identity;
      if (!closed && identity?.kind === "native" && identity.directory === currentDirectory && identity.sessionId === currentSessionId) handleEvent(event);
    }, currentDirectory);
    return () => {
      closed = true;
      void subscription.then((stop) => stop());
    };
  }, [currentSessionId, currentDirectory, handleEvent]);

  useEffect(() => {
    const lastUser = messages.filter((message) => message.role === "user").at(-1)?.id;
    if (lastUser !== lastScrollUserRef.current) followLatestRef.current = true;
    lastScrollUserRef.current = lastUser;
    if (followLatestRef.current) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, view]);

  // Mirror messages into a ref for history persistence.
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Persist only YUME-local messages; native text remains owned by OpenCode.
  useEffect(() => {
    if (agentHistoryId || !localReplySnapshotRef.current || status !== "ready" || messages.length === 0) return;
    const sessionID = sessionRef.current;
    if (!sessionID) return;
    const timer = setTimeout(() => {
      if (agentHistoryActiveRef.current || !localReplySnapshotRef.current || sessionRef.current !== sessionID) return;
      const msgs = messagesRef.current;
      const localMessages = msgs.flatMap(message => isTextChatMessage(message) && message.localOnly && message.text.trim()
        ? [{ role: message.role, text: message.text, time: message.time ?? Date.now(), messageId: message.id, localOnly: true }]
        : []);
      const entry = catalogEntryRef.current;
      if (!entry || !localMessages.length) return;
      void saveLocalMessages(entry.key, localMessages)
        .catch(error => console.error("local reply save failed", error instanceof Error ? error.message : String(error)));
    }, 300);
    return () => clearTimeout(timer);
  }, [agentHistoryId, messages, status]);

  useEffect(() => {
    if (agentHistoryArchive) setMessages(historyChatMessages(agentHistoryArchive));
  }, [agentHistoryArchive]);

  const sendCurrentDraft = async () => {
    const generation = viewGenerationRef.current;
    const roundSelection = modelSelectionRef.current;
    const text = input.trim();
    const roundResources = localResources.resources;
    if (!text && chatAttachments.items.length === 0 && roundResources.length === 0) return;
    if (historyLoading || readOnlyHistory || sessionOwnedByWorkbench || status !== "ready" || !sessionRef.current) return;
    if (attachmentBusy) { setAttachmentError(t.chatAttachmentStillReading); return; }
    if (containsCcSwitchApiKey(text)) {
      setInput("");
      setAttachmentError(null);
      setCcSwitchDraft(null);
      setCcSwitchSetupOpen(true);
      setMemoryNotice(t.ccSwitchSecretRedirect);
      return;
    }
    if (agent.workspace || agentHistoryId || agent.busy) {
      if ((!text && roundResources.length === 0) || agent.busy) return;
      if (chatAttachments.items.length > 0) {
        setAttachmentError(t.agentAttachmentsUnsupported);
        return;
      }
      let roundModel: ChatModelChoice;
      try {
        roundModel = await resolveConversationModel(roundSelection);
      } catch (cause) {
        if (generation === viewGenerationRef.current) setModelNotice(modelErrorCopy(lang, cause));
        return;
      }
      if (generation !== viewGenerationRef.current || roundSelection !== modelSelectionRef.current) return;
      setResolvedModel(roundModel);
      if (agentHistoryId && catalogEntryRef.current?.identity.kind === "native") {
        const displayed = catalogEntryRef.current;
        try {
          const loaded = await loadSharedConversation(displayed);
          if (generation !== viewGenerationRef.current) return;
          catalogEntryRef.current = loaded.entry;
          setCatalogEntry(loaded.entry);
          if (loaded.entry.archived || loaded.entry.tombstone || loaded.entry.availability !== "available"
            || loaded.entry.runtime === "unknown" || loaded.entry.runtime === "running" || loaded.agentDetails?.status === "active") return;
        } catch (cause) {
          await refreshSelectedConversation(displayed.key);
          if (generation !== viewGenerationRef.current) return;
          setMemoryNotice(tRef.current.sessionStateUnknown);
          console.warn("agent conversation access unavailable", cause instanceof Error ? cause.message : String(cause));
          return;
        }
      }
      if (generation !== viewGenerationRef.current || roundSelection !== modelSelectionRef.current) return;
      const run = await agent.start(text || `附件：${roundResources.map(resource => resource.name).join(", ")}`, agentHistoryId ?? undefined,
        agentHistoryId && catalogEntryRef.current?.identity.kind === "native" ? catalogEntryRef.current.key : undefined,
        roundSelection, roundModel, roundResources.map(resource => resource.id));
      if (generation !== viewGenerationRef.current) return;
      if (run) {
        localResources.clearSent(roundResources.map(resource => resource.id));
        setInput("");
        setAttachmentError(null);
        if (run.sessionId) {
          try {
            const key = await invoke<string>("history_catalog_native_key", { directory: run.workspacePath, sessionId: run.sessionId });
            const loaded = await catalogLoad(key);
            if (generation !== viewGenerationRef.current) return;
            openScopedAgentHistory(loaded);
            catalogEntryRef.current = loaded.entry;
            setCatalogEntry(loaded.entry);
            sessionRef.current = run.sessionId;
            setCurrentSessionId(run.sessionId);
            setMessages(historyChatMessages({
              id: run.sessionId, title: loaded.entry.displayTitle, created: loaded.entry.created,
              updated: loaded.entry.updated, messages: loaded.messages, originRunId: run.runId,
              agentDetails: loaded.agentDetails,
            }));
          } catch (cause) {
            setMemoryNotice(tRef.current.historyLoadFailed);
            console.warn("agent catalog adoption failed", cause instanceof Error ? cause.message : String(cause));
          }
        }
      }
      return;
    }
    if (attachmentBusy) {
      setAttachmentError(t.chatAttachmentStillReading);
      return;
    }
    if (attachmentBlocked) {
      setAttachmentError(t.chatAttachmentFixErrors);
      return;
    }
    let prepared: PreparedModelAttachments;
    try {
      prepared = await chatAttachments.prepareModelAttachments(text);
    } catch (error: unknown) {
      setAttachmentError(error instanceof Error ? error.message : t.chatAttachmentReadFailed);
      return;
    }
    if ((!prepared.shouldSendToModel && roundResources.length === 0) || generation !== viewGenerationRef.current) return;
    const sentReadyLocalIds = chatAttachments.items
      .filter((item) => item.kind === "ready")
      .map((item) => item.localId);
    setInput("");
    setAttachmentError(null);
    const sent = await sendText(text, prepared, roundSelection, roundResources);
    if (!sent && generation === viewGenerationRef.current) setInput(text);
    if (sent) {
      discardSentAttachmentSources(sentReadyLocalIds);
      if (generation === viewGenerationRef.current) localResources.clearSent(roundResources.map(resource => resource.id));
    }
  };

  const send = async () => {
    // Resource preparation crosses IPC before status becomes busy. Lock synchronously
    // so repeated Enter/click events cannot submit or discard the same draft twice.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    try { await sendCurrentDraft(); }
    finally { submittingRef.current = false; setIsSubmitting(false); }
  };

  const sendText = async (
    text: string,
    prepared: PreparedModelAttachments = EMPTY_PREPARED_ATTACHMENTS,
    roundSelection: ConversationModelSelection = modelSelectionRef.current,
    resources: readonly LocalResource[] = [],
  ): Promise<boolean> => {
    const sessionID = sessionRef.current;
    const generation = viewGenerationRef.current;
    const displayed = catalogEntryRef.current;
    if (!displayed || historyLoading || sessionOwnedByWorkbench || !displayed.capabilities.send) return false;
    if ((!text && !prepared.shouldSendToModel && resources.length === 0) || !sessionID) return false;
    await personaLoadRef.current;
    if (sessionRef.current !== sessionID || generation !== viewGenerationRef.current) return false;
    let fresh: UnifiedHistoryRow;
    try {
      fresh = (await catalogLoad(displayed.key)).entry;
    } catch (error: unknown) {
      setMemoryNotice(tRef.current.sessionStateUnknown);
      console.error("conversation access unavailable", error instanceof Error ? error.message : String(error));
      return false;
    }
    if (generation !== viewGenerationRef.current) return false;
    catalogEntryRef.current = fresh;
    setCatalogEntry(fresh);
    const identity = validateSharedConversation(displayed, fresh);
    if (!identity) return false;
    let roundModel: ChatModelChoice;
    try {
      roundModel = await resolveConversationModel(roundSelection);
    } catch (cause) {
      if (generation === viewGenerationRef.current) setModelNotice(modelErrorCopy(lang, cause));
      return false;
    }
    if (generation !== viewGenerationRef.current || roundSelection !== modelSelectionRef.current) return false;
    setResolvedModel(roundModel);
    setModelNotice(null);
    const messageAttachments = prepared.fileParts.map(attachmentPreviewFromPart);
    const attachmentNames = [...messageAttachments, ...resources].map((item) => item.name).join(", ");
    let promptText = text || prepared.fallbackPrompt || (resources.length ? `附件：${attachmentNames}` : null);
    let resourceParts: readonly OpenCodeFilePart[] = [];
    const localOnly = activePersonaIdRef.current === DEFAULT_PERSONA_ID && prepared.fileParts.length === 0 && resources.length === 0
      && (isXiaozhuNameOriginQuestion(text) || isXiaozhuIdentityQuestion(text));
    const userMessageId = localOnly ? `local_${newUserMessageId()}` : newUserMessageId();
    if (resources.length) {
      try {
        const references = await prepareChatResources(identity.directory, sessionID, userMessageId, resources.map(resource => resource.id));
        if (generation !== viewGenerationRef.current || sessionRef.current !== sessionID) return false;
        resourceParts = references.parts;
        promptText = [promptText, references.text].filter(Boolean).join("\n\n");
      } catch (cause) {
        if (generation === viewGenerationRef.current) setAttachmentError(localResourceError(resourceLanguage, cause));
        return false;
      }
    }
    rolesRef.current.set(userMessageId, "user");
    setMessages((prev) => [
      ...prev,
      {
        id: userMessageId,
        role: "user",
        text: text || `附件：${attachmentNames}`,
        attachments: messageAttachments,
        resources,
        localOnly, time: Date.now(),
      },
    ]);
    if (!promptText) return false;
    const petScope = { sessionId: sessionID, requestId: userMessageId };
    petActivity.start(petScope);
    setStatus("busy");
    setIsPersonaTyping(false);
    broadcastMood("thinking");
    const fixedReplySequence = fixedReplySequenceRef.current + 1;
    fixedReplySequenceRef.current = fixedReplySequence;
    if (
      activePersonaIdRef.current === DEFAULT_PERSONA_ID &&
      prepared.fileParts.length === 0 && resources.length === 0
    ) {
      if (isXiaozhuNameOriginQuestion(text)) {
        localReplySnapshotRef.current = true;
        if (!(await waitForFixedReplyStart(fixedReplySequence))) return false;
        for (const [index, line] of XIAOZHU_NAME_ORIGIN_LINES.entries()) {
          if (index > 0) {
            setIsPersonaTyping(true);
            broadcastMood("thinking");
            await new Promise<void>((resolve) => {
              globalThis.setTimeout(resolve, 2000);
            });
            if (fixedReplySequenceRef.current !== fixedReplySequence) return false;
          }
          setIsPersonaTyping(false);
          setMessages((prev) => [
            ...prev,
            {
              id: `${userMessageId}_origin_${index}`,
              role: "assistant",
              text: line, localOnly: true, time: Date.now(),
            },
          ]);
          broadcastMood("talking");
          petActivity.mood("talking");
        }
        setIsPersonaTyping(false);
        setStatus("ready");
        broadcastMood("idle");
        petActivity.success(petScope);
        return true;
      }
      if (isXiaozhuIdentityQuestion(text)) {
        localReplySnapshotRef.current = true;
        if (!(await waitForFixedReplyStart(fixedReplySequence))) return false;
        setIsPersonaTyping(false);
        setMessages((prev) => [
          ...prev,
          {
            id: `${userMessageId}_identity`,
            role: "assistant",
            text: XIAOZHU_IDENTITY_REPLY, localOnly: true, time: Date.now(),
          },
        ]);
        broadcastMood("talking");
        setStatus("ready");
        broadcastMood("idle");
        petActivity.success(petScope);
        return true;
      }
    }
    startReplyPacing();
    let promptStarted = false;
    try {
      const s = settingsRef.current;
      // Persona defaults to Chinese; add a reply-language override otherwise.
      const langNames: Record<string, string> = {
        "en-US": "English",
        "ja-JP": "日本語",
        "ko-KR": "한국어",
      };
      const langName = s ? langNames[s.language] : undefined;
      const persona = personaRef.current?.persona;
      const personaPrompt = persona
        ? langName
          ? `${persona}${personaRef.current?.skills ? `\n\n${personaRef.current.skills}` : ""}\n\n# 回复语言\n\n- 使用 ${langName} 回复(用户界面语言已切换)`
          : `${persona}${personaRef.current?.skills ? `\n\n${personaRef.current.skills}` : ""}`
        : undefined;
      // Relevant confirmed memories, appended after the persona so they can
      // only add context to the instructions above them. A memory failure
      // yields an empty block rather than blocking the turn.
      const memoryBlock = await memoryBlockForTurn({
        personaId: activePersonaIdRef.current,
        userText: promptText,
        enabled: s?.memoryAiUse ?? true,
        directory: identity.directory,
      });
      const system = composeSystemPrompt({
        personaPrompt,
        memoryBlock,
        userNameInstruction: userNameInstruction(s?.userName ?? ""),
      });
      try {
        await registerWorklogTurn(sessionID, userMessageId, text);
      } catch (error: unknown) {
        setMemoryNotice(`${worklogChatCopy(lang).failed}: ${error instanceof Error ? error.message : "BRIDGE_UNAVAILABLE"}`);
      }
      if (!petActivity.isCurrent(petScope) || generation !== viewGenerationRef.current) return false;
      const finalAccess = (await catalogLoad(displayed.key)).entry;
      if (generation !== viewGenerationRef.current || !validateSharedConversation(displayed, finalAccess)) {
        if (generation === viewGenerationRef.current) {
          catalogEntryRef.current = finalAccess;
          setCatalogEntry(finalAccess);
          clearReplyPacing();
          setStatus("ready");
        }
        return false;
      }
      // Persist identity before submission; the host validates native completion.
      await invoke("memory_register_turn", { registration: {
        directory: identity.directory, sessionId: sessionID, messageId: userMessageId,
        providerId: roundModel.sidecarId, modelId: roundModel.modelId,
      } }).catch(() => { /* The managed plugin also registers the native turn. */ });
      promptStarted = true;
      await promptAsync(sessionID, promptText, {
        directory: identity.directory,
        messageID: userMessageId,
        system: [system, buildCurrentInformationInstruction(), buildWorklogSystemInstruction()].filter(Boolean).join("\n\n"),
        attachments: [...prepared.fileParts, ...resourceParts],
        model: { providerID: roundModel.sidecarId, modelID: roundModel.modelId },
      });
      return true;
    } catch (error: unknown) {
      if (!petActivity.isCurrent(petScope)) return false;
      if (promptStarted) {
        const submission = await confirmPromptSubmission(sessionID, userMessageId, identity.directory);
        if (submission === "confirmed") return true;
        if (submission === "unknown") {
          setMemoryNotice(tRef.current.chatSubmissionUnknown);
          broadcastMood("thinking");
          return true;
        }
      }
      petActivity.error(petScope);
      console.error(
        error instanceof Error ? error : new Error(String(error)),
      );
      clearReplyPacing();
      setIsPersonaTyping(false);
      setStatus("ready");
      broadcastMood("error");
      if (prepared.fileParts.length > 0 || resources.length > 0) {
        setAttachmentError(tRef.current.chatAttachmentSendFailed);
      }
      return false;
    }
  };

  const stageAttachmentFiles = useCallback((files: ArrayLike<File> | null) => {
    if (agent.workspace || agentHistoryId) {
      setAttachmentError(tRef.current.agentAttachmentsUnsupported);
      return;
    }
    if (catalogEntryRef.current && !catalogEntryRef.current.capabilities.send) return;
    const selected = Array.from(files ?? []);
    if (selected.length === 0) return;
    void (async () => {
      let sessionID = sessionRef.current;
      if (!sessionID) {
        await resetSession();
        sessionID = sessionRef.current;
      }
      if (!sessionID) {
        setAttachmentError(tRef.current.chatAttachmentStillReading);
        return;
      }
      resetAttachmentSession(sessionID);
      setCurrentSessionId(sessionID);
      chatAttachments.stageFromPicker(selected);
    })().catch((error: unknown) => {
      setAttachmentError(error instanceof Error ? error.message : tRef.current.chatAttachmentReadFailed);
    });
  }, [agent.workspace, agentHistoryId, chatAttachments, resetAttachmentSession, resetSession]);

  const pickAttachmentFiles = async () => {
    if (submittingRef.current || attachmentBusy || status !== "ready" || !currentSessionId || agent.busy) return;
    setOpenPicker(null);
    setAttachmentError(null);
    await localResources.pick(t.chatAttach);
  };

  const stageInputFiles = (files: ArrayLike<File>) => {
    const selected = Array.from(files);
    const media = selected.filter(isMediaFile);
    const legacy = selected.filter(file => !isMediaFile(file));
    if (media.length) void localResources.addMediaFiles(media);
    if (legacy.length) stageAttachmentFiles(legacy);
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (event.clipboardData.files.length === 0) return;
    event.preventDefault();
    stageInputFiles(event.clipboardData.files);
  };

  const hasFiles = (event: DragEvent<HTMLDivElement>): boolean =>
    Array.from(event.dataTransfer.types).includes("Files");

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragActive(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event) && dragDepthRef.current === 0) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragActive(false);
    if (event.dataTransfer.files.length === 0) {
      setAttachmentError(t.chatAttachmentDropFailed);
      return;
    }
    stageInputFiles(event.dataTransfer.files);
  };

  // Bundled personas/skills failed to unpack: tell the user why instead of
  // letting it look like an empty persona list.
  useEffect(() => {
    const unlisten = onResourceError((reason) => {
      console.error("resource sync failed", reason);
      setAttachmentError(tRef.current.resourceSyncFailed);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const abort = async () => {
    const sessionID = sessionRef.current;
    if (!sessionID || isCancelling || sessionOwnedByWorkbench || readOnlyHistory || historyLoading) return;
    setIsCancelling(true);
    setMemoryNotice(null);
    try {
      await abortSession(sessionID, sessionDirectory());
      petActivity.cancel();
      fixedReplySequenceRef.current += 1;
      clearReplyPacing();
      setIsPersonaTyping(false);
      setStatus("ready");
      broadcastMood("idle");
    } catch (error: unknown) {
      const unknown = error instanceof SessionAbortError && error.code === "UNKNOWN";
      setMemoryNotice(unknown ? t.chatStopUnknown : t.chatStopFailed);
      broadcastMood("error");
    } finally {
      setIsCancelling(false);
    }
  };

  /** Load actual native messages via the host, preserving the composite identity. */
  const resumeSession = useCallback(async (row: UnifiedHistoryRow) => {
    const generation = ++viewGenerationRef.current;
    setHistoryLoading(true);
    petActivity.cancel();
    fixedReplySequenceRef.current += 1;
    clearReplyPacing();
    setIsPersonaTyping(false);
    try {
      const loaded = await loadSharedConversation(row);
      if (generation !== viewGenerationRef.current) return;
      const entry = loaded.entry;
      if (entry.key !== row.key) throw new Error("history identity changed");
      const restoredSelection = await getConversationModel(entry.key);
      if (generation !== viewGenerationRef.current) return;
      modelSelectionRef.current = restoredSelection;
      setModelSelection(restoredSelection);
      setResolvedModel(null);
      if (loaded.agentDetails) {
        const agentId = entry.identity.kind === "native" ? entry.identity.sessionId : entry.identity.historyId;
        const opened = entry.identity.kind === "native" ? openScopedAgentHistory(loaded) : await openHistory(agentId);
        if (generation !== viewGenerationRef.current || opened.kind !== "agent") return;
        agent.clearSelection();
        catalogEntryRef.current = entry;
        setCatalogEntry(entry);
        sessionRef.current = agentId;
        setCurrentSessionId(agentId);
        setView("chat");
        setStatus("ready");
        return;
      }
      agent.clearSelection();
      leaveAgentHistory();
      const id = entry.identity.kind === "native" ? entry.identity.sessionId : null;
      const previousSession = sessionRef.current;
      if (previousSession && previousSession !== id) await cleanupAttachmentSession(previousSession);
      if (generation !== viewGenerationRef.current) return;
      sessionRef.current = id;
      catalogEntryRef.current = entry;
      setCatalogEntry(entry);
      setCurrentSessionId(id);
      if (id) resetAttachmentSession(id);
      rolesRef.current.clear();
      setMessages(loaded.messages.map((message, index) => ({
        id: message.messageId ?? message.partId ?? "history-" + index, role: message.role, text: message.text,
        localOnly: message.localOnly, time: message.time,
      })));
      setInput("");
      setPendingWorkspace(null);
      setMemoryNotice(null);
      setView("chat");
      setStatus("ready");
      broadcastMood("idle");
    } catch (error: unknown) {
      if (generation !== viewGenerationRef.current) return;
      setMemoryNotice(tRef.current.historyLoadFailed);
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      if (generation === viewGenerationRef.current) setHistoryLoading(false);
    }
  }, [agent, cleanupAttachmentSession, leaveAgentHistory, openHistory, openScopedAgentHistory, resetAttachmentSession, petActivity]);

  /** Start a fresh session. */
  const newChat = useCallback(async () => {
    try {
      if (!(await resetSession())) return;
      leaveAgentHistory();
      agent.clearSelection();
    } catch (error: unknown) {
      console.error(
        error instanceof Error ? error : new Error(String(error)),
      );
      const unknown = error instanceof SessionAbortError && error.code === "UNKNOWN";
      setMemoryNotice(unknown ? tRef.current.chatStopUnknown : tRef.current.chatStopFailed);
      broadcastMood("error");
    }
  }, [agent, leaveAgentHistory, resetSession]);

  const selectModel = async (selection: ConversationModelSelection): Promise<void> => {
    if (status === "busy" || agent.busy || historyLoading || sessionOwnedByWorkbench || readOnlyHistory) throw new Error("model selection locked");
    const key = catalogEntryRef.current?.key;
    const generation = viewGenerationRef.current;
    if (!key) throw new Error("conversation unavailable");
    if (selection.mode === "override") await resolveConversationModel(selection);
    await setConversationModel(key, selection);
    if (generation !== viewGenerationRef.current || catalogEntryRef.current?.key !== key) return;
    modelSelectionRef.current = selection;
    setModelSelection(selection);
    setResolvedModel(null);
  };

  const folderLocked = status !== "ready" || agent.busy || agent.isStopping || historyLoading || sessionOwnedByWorkbench || readOnlyHistory;
  folderLockedRef.current = folderLocked;
  const commitFolder = async (path: string, expectedGeneration = viewGenerationRef.current): Promise<void> => {
    if (folderLockedRef.current) throw new Error(composerCopy(lang).folderLocked);
    const canonical = await invoke<string>("history_validate_workspace", { directory: path });
    if (expectedGeneration !== viewGenerationRef.current || folderLockedRef.current) throw new Error(composerCopy(lang).folderLocked);
    const current = agent.workspace ?? agentHistoryArchive?.agentDetails?.workspacePath ?? null;
    if (current === canonical) { setPendingWorkspace(null); return; }
    if (messagesRef.current.length > 0 || agentHistoryId || chatAttachments.items.length > 0 || localResources.resources.length > 0) {
      if (!(await resetSession(true))) return;
      leaveAgentHistory();
      for (const item of chatAttachments.items) chatAttachments.remove(item.localId);
    }
    if (folderLockedRef.current) throw new Error(composerCopy(lang).folderLocked);
    agent.selectWorkspace(canonical);
    setPendingWorkspace(null);
    await invoke("history_remember_workspace", { directory: canonical }).catch(cause => {
      console.warn("recent workspace unavailable", cause instanceof Error ? cause.message : String(cause));
    });
  };

  const chooseFolder = async (path?: string): Promise<void> => {
    if (folderLocked) throw new Error(composerCopy(lang).folderLocked);
    const generation = viewGenerationRef.current;
    const selected = path ?? await openDirectory({ directory: true, multiple: false, title: t.agentPickerTitle });
    if (typeof selected !== "string") return;
    if (generation !== viewGenerationRef.current) return;
    if (chatAttachments.items.length > 0 || localResources.resources.length > 0) {
      setPendingWorkspace({ path: selected, generation });
      return;
    }
    await commitFolder(selected, generation);
  };

  const leaveFolder = async (): Promise<void> => {
    if (folderLocked) throw new Error(composerCopy(lang).folderLocked);
    if (messagesRef.current.length > 0 || agentHistoryId) {
      if (!(await resetSession(true))) return;
    }
    leaveAgentHistory();
    agent.clearSelection();
    setPendingWorkspace(null);
  };
  const returnToAgentTask = async (): Promise<void> => {
    const run = agent.projection.active;
    if (!run?.sessionId) return;
    try {
      const key = await invoke<string>("history_catalog_native_key", { directory: run.workspacePath, sessionId: run.sessionId });
      const loaded = await catalogLoad(key);
      await resumeSession(loaded.entry);
    } catch (cause) {
      setMemoryNotice(tRef.current.historyLoadFailed);
      console.warn("agent task return failed", cause instanceof Error ? cause.message : String(cause));
    }
  };

  const closeChat = async (): Promise<void> => {
    try {
      await invoke("hide_chat");
    } catch (error: unknown) {
      console.error(
        "chat close failed",
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  };

  const activePersonaName = personaDisplayName(activePersonaId, lang);
  const chatBooting = personalizePersonaCopy(t.chatBooting, activePersonaName);
  const chatEmpty = personalizePersonaCopy(t.chatEmpty, activePersonaName);
  const statusLabel: Record<Status, string> = {
    booting: chatBooting,
    ready: t.chatReady,
    busy: personaRef.current?.placeholders?.streaming ?? t.chatThinking,
    error: t.chatError,
  };

  return (
    <div
      className={`chat-root${isDragActive ? " chat-drag-active" : ""}`}
      data-theme={theme}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragActive && (
        <div className="chat-dropzone" role="status" aria-live="polite">
          {t.chatDropHere}
        </div>
      )}
      {view !== "history" && <header className="chat-header" data-tauri-drag-region="">
        <span className="chat-title">{activePersonaName}</span>
        <span className={`chat-status chat-status-${status}`}>
          {statusLabel[status]}
        </span>
        <button
          className="chat-iconbtn"
          disabled={!currentSessionId}
          onClick={() => {
            if (currentSessionId) {
              void openInWorkbench(currentSessionId, currentDirectory);
            }
          }}
          aria-label={t.openInWorkbench}
          title={t.openInWorkbench}
        >
          <AppIcon name="widget" size={18} />
        </button>
        <button
          className="chat-iconbtn"
          onClick={() => setView("history")}
          aria-label={t.tabHistory}
          title={t.tabHistory}
        >
          <AppIcon name="history" size={18} />
        </button>
        <button
          className="chat-settings"
          onClick={() => void invoke("open_settings")}
          aria-label={t.chatSettings}
          title={t.chatSettings}
        >
          <AppIcon name="general" size={18} />
        </button>
        <button
          className="chat-close"
          onClick={() => void closeChat()}
          aria-label={t.close}
        >
          <AppIcon name="close" size={18} />
        </button>
      </header>}
      {view !== "history" && workbenchOpenError?.sessionId === currentSessionId && (
        <div className="chat-memory-notice" role="alert">
          {workbenchOpenError.reason === "missing" ? t.workbenchSessionMissing : t.workbenchOpenFailed}
        </div>
      )}

      {view === "history" ? (
        <HistoryOrganizer language={lang} onOpen={resumeSession} onClose={() => setView("chat")} onNewChat={newChat} onChanged={refreshSelectedConversation}
          onDeleted={async (row, forgetMemories) => {
            const id = row.identity.kind === "native" ? row.identity.sessionId : row.identity.historyId;
            await cleanupAttachmentSession(id);
            if (forgetMemories) await memoryForgetConversation(id, row.key);
          }} />
      ) : (
        <>
          <div className="chat-timeline">
          <div className="chat-list" ref={listRef} onScroll={(event) => {
            const list = event.currentTarget;
            followLatestRef.current = list.scrollHeight - list.clientHeight - list.scrollTop < 48;
          }}>
            {ccSwitchSetupOpen && (
              <CcSwitchSetupCard
                t={t}
                draft={ccSwitchDraft}
                onClose={() => {
                  ccSwitchDraftRef.current = null;
                  setCcSwitchDraft(null);
                  setCcSwitchSetupOpen(false);
                }}
              />
            )}
            {messages.length === 0 && (
              <div className="chat-empty">
                <ChatText text={chatEmpty} format="plain" />
              </div>
            )}
            {messages.map((m) => {
              if (m.role === "artifact") {
                const artifactState = chatAttachments.artifacts.find(
                  (item) => item.artifact.id === m.artifactId,
                );
                if (artifactState === undefined) return null;
                return (
                  <ArtifactCard
                    key={m.id}
                    t={t}
                    state={artifactState}
                    onDownload={chatAttachments.download}
                    onRetry={chatAttachments.retryDownload}
                  />
                );
              }
              return (
                <div key={m.id} data-message-id={m.id} className={`chat-msg chat-msg-${m.role}`}>
                  {m.activity && (
                    <div
                      className={`chat-activity${typeof m.activity === "object" ? ` chat-activity-websearch${m.activity.running ? " chat-activity-running" : ""}` : ""}`}
                      role={typeof m.activity === "object" ? "status" : undefined}
                      aria-live={typeof m.activity === "object" ? "polite" : undefined}
                    >
                      {typeof m.activity === "object" ? (
                        <>
                          <AppIcon
                            name="network"
                            size={16}
                            className="chat-activity-icon app-icon-network"
                          />
                          <span>{t.chatWebSearch}</span>
                          {m.activity.sites.length > 0 && (
                            <>
                              <span className="chat-websearch-divider" aria-hidden="true">
                                ·
                              </span>
                              <span
                                className={`chat-websearch-sites${m.activity.sites.length > 1 ? " chat-websearch-sites-scrolling" : ""}`}
                                title={m.activity.sites.join(" · ")}
                              >
                                <span className="chat-websearch-sites-track">
                                  <span className="chat-websearch-sites-group">
                                    {m.activity.sites.join(" · ")}
                                  </span>
                                  {m.activity.sites.length > 1 && (
                                    <span
                                      className="chat-websearch-sites-group"
                                      aria-hidden="true"
                                    >
                                      {m.activity.sites.join(" · ")}
                                    </span>
                                  )}
                                </span>
                              </span>
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          <AppIcon name="general" size={16} className="chat-activity-icon" />{" "}
                          {m.activity}
                        </>
                      )}
                    </div>
                  )}
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="chat-message-attachments">
                      {m.attachments.map((attachment) => (
                        <AttachmentPreview
                          key={attachment.id}
                          attachment={attachment}
                        />
                      ))}
                    </div>
                  )}
                  {m.role === "user" && (m.resources?.length || m.text.includes("<yume-local-resources>")) ? (
                    <MessageLocalResources directory={currentDirectory ?? ""} sessionId={currentSessionId ?? ""}
                      messageId={m.nativeMessageId ?? m.id} resources={m.resources} lang={resourceLanguage} />
                  ) : null}
                  {m.localOnly && m.role === "assistant" && <div className="chat-activity">{lang === "zh-CN" ? "本地回复" : "Local reply"}</div>}
                  {(m.text.trim().length > 0 || m.role === "user") && (
                    <div className="chat-bubble">
                      <ChatText text={m.role === "user" ? stripLocalResourceContext(m.text) : m.text} format={m.role === "assistant" ? "markdown" : "plain"}
                        streaming={status === "busy" && m.role === "assistant" && m.id === messages.at(-1)?.id}
                        lang={lang} />
                    </div>
                  )}
                  {worklog.operations.filter((operation) => operation.messageId === m.id).map((operation) => <WorklogReceipt key={operation.requestId} operation={operation} language={lang} onUndo={worklog.undo} onRefresh={worklog.refresh} />)}
                </div>
              );
            })}
            {isPersonaTyping && (
              <div className="chat-typing" role="status" aria-live="polite">
                {t.chatTyping}
              </div>
            )}
            {worklog.operations.filter((operation) => !messages.some((message) => message.id === operation.messageId)).map((operation) => <WorklogReceipt key={operation.requestId} operation={operation} language={lang} onUndo={worklog.undo} onRefresh={worklog.refresh} />)}
            <WorkspaceTask language={lang} agent={agent} historyDetails={agentHistoryArchive?.agentDetails} compact sessionId={currentSessionId} directory={currentDirectory} />
          </div>

          <ChatNavigation messages={messages} listRef={listRef} lang={lang} onNavigate={() => { followLatestRef.current = false; }} />
          </div>
          {memoryNotice && (
            <div className="chat-memory-notice" role="status" aria-live="polite">
              {memoryNotice}
            </div>
          )}

          {agent.projection.active && !runMatchesConversation(agent.projection.active, catalogEntry) && (
            <div className="chat-memory-notice" role="status">{t.agentBusy}
              <button type="button" className="chat-memory-action" onClick={() => void returnToAgentTask()}>{composerCopy(lang).returnTask}</button>
            </div>
          )}
          {runMatchesConversation(agent.projection.active, catalogEntry) && agent.requests.length > 0 && (
            <div className="chat-agent-approval-dock"><ToolApprovalCards requests={agent.requests} error={false} onReply={agent.reply} t={t} /></div>
          )}
          {sessionOwnedByWorkbench || (readOnlyHistory && !runMatchesConversation(agent.projection.active, catalogEntry)) || historyLoading ? (
            <div className="chat-memory-notice" role="status" aria-live="polite">
              {historyLoading ? t.loading : readOnlyHistory
                ? (catalogEntry ? conversationReadOnlyReason(catalogEntry, lang) : t.sessionStateUnknown)
                : workbenchSessionStateUnknown ? t.sessionStateUnknown : t.sessionOwnedByWorkbench}
              <button type="button" className="chat-memory-action" onClick={() => void newChat()}>{t.historyNewSession}</button>
              <button
                type="button"
                className="chat-memory-action"
                disabled={!currentSessionId}
                onClick={() => {
                  if (currentSessionId) {
                    void openInWorkbench(currentSessionId, currentDirectory);
                  }
                }}
              >
                {t.openInWorkbench}
              </button>
            </div>
          ) : (
            <>
              <ToolApprovalCards requests={permissions.requests} error={permissions.error} onReply={permissions.reply} t={t} />
              <footer ref={composerAnchor} className="chat-input-row">
              <LocalResourceTray resources={localResources.resources} lang={resourceLanguage} onRemove={localResources.remove}
                disabled={isSubmitting || status === "busy" || agent.busy} />
              <AttachmentTray
                t={t}
                disabled={isSubmitting}
                items={chatAttachments.items}
                error={attachmentError}
                onConfirm={chatAttachments.confirm}
                onCancel={chatAttachments.cancel}
                onRemove={chatAttachments.remove}
                onRetry={chatAttachments.retry}
              />
            <div className="chat-input-wrap">
              <div className="chat-textarea-wrap">
                <textarea
                  className="chat-input"
                  value={input}
                  disabled={isSubmitting}
                  placeholder={t.chatInputPlaceholder}
                  rows={2}
                  onChange={(e) => {
                    setInput(e.target.value);
                    if (e.target.value.trim()) setAttachmentError(null);
                  }}
                  onPaste={handlePaste}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
              </div>
              <div className="chat-composer-tools">
                <button
                  className="chat-attach"
                  type="button"
                  onClick={() => void pickAttachmentFiles()}
                  disabled={isSubmitting || status !== "ready" || !currentSessionId || attachmentBusy || agent.busy}
                  aria-label={t.chatAttach}
                  title={t.chatAttach}
                >
                  <AppIcon name="add" size={16} />
                </button>
                <WorkspacePicker language={lang} theme={theme} anchor={composerAnchor} workspace={agent.workspace ?? agentHistoryArchive?.agentDetails?.workspacePath ?? null}
                  locked={isSubmitting || folderLocked} onSelect={chooseFolder} onLeave={leaveFolder}
                  open={openPicker === "folder"} onOpenChange={open => setOpenPicker(open ? "folder" : null)} />
                <div className="chat-composer-spacer" />
                <ModelPicker language={lang} theme={theme} anchor={composerAnchor} selection={modelSelection} resolved={resolvedModel}
                  locked={isSubmitting || status === "busy" || agent.busy || historyLoading || readOnlyHistory || sessionOwnedByWorkbench}
                  onSelect={selectModel} onManage={() => void invoke("open_ai_model_settings")}
                  open={openPicker === "model"} onOpenChange={open => setOpenPicker(open ? "model" : null)} />
                {status === "busy" || runMatchesConversation(agent.projection.active, catalogEntry) ? (
                  <button className="chat-send chat-abort" type="button"
                    onClick={() => status === "busy" ? void abort() : void agent.stop()}
                    disabled={isCancelling || agent.isStopping} aria-label={t.chatStop}>
                    {isCancelling || agent.isStopping ? t.chatStopping : t.chatStop}
                  </button>
                ) : (
                  <button className="chat-send" type="button" onClick={() => void send()}
                    disabled={isSubmitting || agent.busy || status !== "ready" || attachmentBusy || !resolvedModel ||
                      (!input.trim() && localResources.resources.length === 0 && (agent.workspace || agentHistoryId ? true : chatAttachments.items.length === 0))}>
                    {t.chatSend}
                  </button>
                )}
              </div>
            </div>
            {modelNotice && <p className="chat-composer-notice" role="alert">{modelNotice}</p>}
            {pendingWorkspace && <div className="chat-folder-conflict" role="alertdialog" aria-label={composerCopy(lang).attachmentConflict}>
              <span>{composerCopy(lang).attachmentConflict}</span>
              <button type="button" onClick={() => setPendingWorkspace(null)}>{composerCopy(lang).keepAttachments}</button>
              <button type="button" onClick={() => void commitFolder(pendingWorkspace.path, pendingWorkspace.generation).catch(cause => setAttachmentError(folderErrorCopy(lang, cause)))}>{composerCopy(lang).removeAttachments}</button>
            </div>}
          </footer>
        </>
      )}
      </>
    )}
    </div>
  );
}

function AttachmentPreview({
  attachment,
}: {
  attachment: ModelReadyAttachment;
}) {
  if (attachment.kind === "image") {
    return (
      <img
        className="chat-attachment-image"
        src={attachment.dataUrl}
        alt={attachment.name}
        title={attachment.name}
      />
    );
  }
  return <div className="chat-attachment-document">文档 · {attachment.name}</div>;
}

function attachmentPreviewFromPart(part: OpenCodeFilePart): ModelReadyAttachment {
  switch (part.mime) {
    case "image/gif":
    case "image/jpeg":
    case "image/png":
    case "image/webp":
      return {
        id: part.filename,
        name: part.filename,
        mime: part.mime,
        size: 0,
        kind: "image",
        status: "ready",
        dataUrl: part.url,
      };
    default:
      return {
        id: part.filename,
        name: part.filename,
        mime: "text/plain",
        size: 0,
        kind: "text",
        status: "ready",
        dataUrl: part.url,
        truncated: false,
      };
  }
}

function isTextChatMessage(message: ChatMessage): message is TextChatMessage {
  return message.role === "user" || message.role === "assistant";
}

function hasVisibleMessageContent(message: ChatMessage): boolean {
  if (message.role === "artifact") return true;
  return (
    message.text.trim().length > 0 ||
    (message.attachments !== undefined && message.attachments.length > 0)
  );
}

/** Update the assistant message with the given id, creating it if missing. */
function upsertAssistant(
  prev: ChatMessage[],
  messageID: string,
  update: (m: TextChatMessage) => TextChatMessage,
): ChatMessage[] {
  const idx = prev.findIndex((m) => m.id === messageID);
  if (idx >= 0) {
    return prev.map((message, index) => (
      index === idx && isTextChatMessage(message) ? update(message) : message
    ));
  }
  return [
    ...prev,
    update({ id: messageID, role: "assistant", text: "" }),
  ];
}


