// allow: SIZE_OK — legacy chat composition root; Agent history behavior lives in useAgentHistoryView and this file only wires existing chat primitives.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import { ToolApprovalCards } from "./ToolApprovalCards";
import { useToolPermissions } from "./useToolPermissions";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  draftFromMessage,
  forgetMemory,
  memoryBlockForTurn,
  saveMemory,
  type MemoryFailure,
  type MemoryReceipt,
} from "./memoryActions";
import {
  getSettings,
  onResourceError,
  onSettingsChanged,
  type Settings,
} from "../lib/settings";
import { memoryForgetConversation } from "../lib/memory";
import type { ThemeId } from "../settings/theme";
import { dict } from "../lib/i18n";
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
import { ChatText } from "./ChatText";
import { ChatNavigation } from "./ChatNavigation";
import { useWorklogChat } from "./useWorklogChat";
import { WorklogReceipt, worklogChatCopy } from "./WorklogReceipt";
import { buildWorklogSystemInstruction, newUserMessageId, registerWorklogTurn, WORKLOG_TOOLS } from "./worklogActions";
import { buildCurrentInformationInstruction } from "./currentInformation";
import { webSearchSites } from "./webSearchSites";
import { CcSwitchSetupCard } from "./CcSwitchSetupCard";
import { WorkspaceTask } from "./WorkspaceTask";
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

/** A pending sensitive-storage confirmation, awaiting the user's decision. */
interface SensitivePrompt {
  messageId: string;
  draft: ReturnType<typeof draftFromMessage>;
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
    role: message.role,
    text: message.text,
  }));
}

export default function ChatApp() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>("booting");
  const [isPersonaTyping, setIsPersonaTyping] = useState(false);
  const [lang, setLang] = useState("zh-CN");
  const [theme, setTheme] = useState<ThemeId>("dark");
  const [activePersonaId, setActivePersonaId] = useState(DEFAULT_PERSONA_ID);
  const [view, setView] = useState<View>("chat");
  const showOrganizer = useCallback(() => setView("history"), []);
  useHistoryOrganizerRequest(showOrganizer);
  const [catalogEntry, setCatalogEntry] = useState<UnifiedHistoryRow | null>(null);
  const catalogEntryRef = useRef<UnifiedHistoryRow | null>(null);
  const viewGenerationRef = useRef(0);
  const nativePersistedRef = useRef(false);
  const localReplySnapshotRef = useRef(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const currentDirectory = catalogEntry?.identity.kind === "native" ? catalogEntry.identity.directory : undefined;
  const sessionDirectory = () => catalogEntryRef.current?.identity.kind === "native" ? catalogEntryRef.current.identity.directory : undefined;

  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
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
  /** Inline memory receipts, keyed by the message they belong to. */
  const [memoryReceipts, setMemoryReceipts] = useState<
    Record<string, MemoryReceipt>
  >({});
  const [memoryNotice, setMemoryNotice] = useState<string | null>(null);
  const [sensitivePrompt, setSensitivePrompt] = useState<SensitivePrompt | null>(
    null,
  );
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
  const {
    viewedId: agentHistoryId,
    archive: agentHistoryArchive,
    open: openHistory,
    openScoped: openScopedAgentHistory,
    adopt: adoptAgentHistory,
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  /** mirror of `messages` for persisting history outside render. */
  const messagesRef = useRef<ChatMessage[]>([]);
  const createdRef = useRef<number>(Date.now());
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
  const attachmentBusy = chatAttachments.items.some((item) => item.kind === "staging");
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

  const resetSession = useCallback(async (): Promise<void> => {
    const generation = ++viewGenerationRef.current;
    const previousSession = sessionRef.current;
    if (previousSession && catalogEntryRef.current?.capabilities.send) {
      await abortSession(previousSession, sessionDirectory());
      await cleanupAttachmentSession(previousSession);
    }
    petActivity.cancel();
    fixedReplySequenceRef.current += 1;
    clearReplyPacing();
    setIsPersonaTyping(false);
    await waitForServer();
    const session = await createSession("YUME chat");
    const registered = await invoke<UnifiedHistoryRow>("history_register_native_session", {
      sessionId: session.id,
      directory: session.directory,
      source: "light_chat",
    });
    if (viewGenerationRef.current !== generation) return;
    let ready = registered;
    let statusUnavailable = false;
    try {
      ready = (await loadSharedConversation(registered)).entry;
    } catch (error: unknown) {
      statusUnavailable = true;
      console.warn("new conversation status unavailable", error instanceof Error ? error.message : String(error));
    }
    if (viewGenerationRef.current !== generation) return;
    catalogEntryRef.current = ready;
    setCatalogEntry(ready);
    setMemoryNotice(statusUnavailable ? tRef.current.sessionStateUnknown : null);
    nativePersistedRef.current = false;
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
    createdRef.current = Date.now();
    setMessages([]);
    setView("chat");
    setStatus("ready");
    broadcastMood("idle");
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
          setLang(s.language);
          setTheme(s.theme);
          const nextPersonaId = resolvePersonaId(s.personaId);
          if (
            shouldResetSessionForPersona(
              activePersonaIdRef.current,
              nextPersonaId,
            )
          ) {
            const switchRequest = loadPersona(nextPersonaId).then(() =>
              activePersonaIdRef.current === nextPersonaId
                ? resetSession()
                : undefined,
            );
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

  const send = async () => {
    const generation = viewGenerationRef.current;
    const text = input.trim();
    if (!text && chatAttachments.items.length === 0) return;
    if (historyLoading || readOnlyHistory || sessionOwnedByWorkbench || status !== "ready" || !sessionRef.current) return;
    if (containsCcSwitchApiKey(text)) {
      setInput("");
      setAttachmentError(null);
      setCcSwitchDraft(null);
      setCcSwitchSetupOpen(true);
      setMemoryNotice(t.ccSwitchSecretRedirect);
      return;
    }
    if (agent.workspace || agentHistoryId || agent.busy) {
      if (!text || agent.busy) return;
      if (chatAttachments.items.length > 0) {
        setAttachmentError(t.agentAttachmentsUnsupported);
        return;
      }
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
      const run = await agent.start(text, agentHistoryId ?? undefined,
        agentHistoryId && catalogEntryRef.current?.identity.kind === "native" ? catalogEntryRef.current.key : undefined);
      if (run) {
        setInput("");
        setAttachmentError(null);
        if (run.sessionId) await adoptAgentHistory(run.sessionId);
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
    if (!prepared.shouldSendToModel || generation !== viewGenerationRef.current) return;
    const sentReadyLocalIds = chatAttachments.items
      .filter((item) => item.kind === "ready")
      .map((item) => item.localId);
    setInput("");
    setAttachmentError(null);
    const sent = await sendText(text, prepared);
    if (!sent && generation === viewGenerationRef.current) setInput(text);
    if (sent) {
      discardSentAttachmentSources(sentReadyLocalIds);
    }
  };

  const sendText = async (
    text: string,
    prepared: PreparedModelAttachments = EMPTY_PREPARED_ATTACHMENTS,
  ): Promise<boolean> => {
    const sessionID = sessionRef.current;
    const generation = viewGenerationRef.current;
    const displayed = catalogEntryRef.current;
    if (!displayed || historyLoading || sessionOwnedByWorkbench || !displayed.capabilities.send) return false;
    if ((!text && !prepared.shouldSendToModel) || !sessionID) return false;
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
    const messageAttachments = prepared.fileParts.map(attachmentPreviewFromPart);
    const attachmentNames = messageAttachments.map((item) => item.name).join(", ");
    const promptText = text || prepared.fallbackPrompt;
    const localOnly = activePersonaIdRef.current === DEFAULT_PERSONA_ID && prepared.fileParts.length === 0
      && (isXiaozhuNameOriginQuestion(text) || isXiaozhuIdentityQuestion(text));
    const userMessageId = localOnly ? `local_${newUserMessageId()}` : newUserMessageId();
    rolesRef.current.set(userMessageId, "user");
    setMessages((prev) => [
      ...prev,
      {
        id: userMessageId,
        role: "user",
        text: text || `附件：${attachmentNames}`,
        attachments: messageAttachments,
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
      prepared.fileParts.length === 0
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
      promptStarted = true;
      nativePersistedRef.current = true;
      await promptAsync(sessionID, promptText, {
        directory: identity.directory,
        messageID: userMessageId,
        system: [system, buildCurrentInformationInstruction(), buildWorklogSystemInstruction()].filter(Boolean).join("\n\n"),
        attachments: [...prepared.fileParts],
        model:
          s?.providerId && s.modelId
            ? { providerID: s.providerId, modelID: s.modelId }
            : undefined,
      });
      nativePersistedRef.current = true;
      return true;
    } catch (error: unknown) {
      if (!petActivity.isCurrent(petScope)) return false;
      if (promptStarted) {
        const submission = await confirmPromptSubmission(sessionID, userMessageId, identity.directory);
        if (submission === "confirmed") { nativePersistedRef.current = true; return true; }
        if (submission === "unknown") {
          nativePersistedRef.current = true;
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
      if (prepared.fileParts.length > 0) {
        setAttachmentError(tRef.current.chatAttachmentSendFailed);
      }
      return false;
    }
  };

  const stageAttachmentFiles = useCallback((files: ArrayLike<File> | null) => {
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
  }, [chatAttachments, resetAttachmentSession, resetSession]);

  /** Turn a memory failure into a user-facing notice. */
  const noticeForMemoryFailure = useCallback(
    (failure: MemoryFailure): string => {
      const dict = tRef.current;
      switch (failure.kind) {
        case "secret-rejected":
          return dict.memorySecretRejected;
        case "conflict":
          return dict.memoryConflictNotice;
        case "disabled":
          return dict.memoryDisabledNotice;
        default:
          return dict.memorySaveFailed;
      }
    },
    [],
  );

  /** "记住这件事" on one message. */
  const rememberMessage = useCallback(
    async (message: TextChatMessage, sensitiveConfirmed = false) => {
      const draft = draftFromMessage({
        text: message.text,
        personaId: activePersonaIdRef.current,
        conversationId: sessionRef.current,
        // History-loaded messages have synthetic ids, so only live server
        // message ids are recorded as provenance.
        messageId: message.id.startsWith("hist-") ? null : message.id,
      });
      const result = await saveMemory(draft, { sensitiveConfirmed });
      if (result.ok) {
        setSensitivePrompt(null);
        setMemoryNotice(null);
        setMemoryReceipts((current) => ({
          ...current,
          [message.id]: result.value,
        }));
        return;
      }
      if (result.failure.kind === "sensitive-confirmation") {
        // Storing this needs the disclosure dialog first.
        setSensitivePrompt({ messageId: message.id, draft: result.failure.draft });
        return;
      }
      setSensitivePrompt(null);
      setMemoryNotice(noticeForMemoryFailure(result.failure));
    },
    [noticeForMemoryFailure],
  );

  /** Undo a just-saved memory, or forget it outright. */
  const dropMemory = useCallback(
    async (messageId: string, memoryId: string, undo: boolean) => {
      const result = await forgetMemory(memoryId);
      if (!result.ok) {
        setMemoryNotice(noticeForMemoryFailure(result.failure));
        return;
      }
      setMemoryReceipts((current) => {
        const next = { ...current };
        delete next[messageId];
        return next;
      });
      setMemoryNotice(
        undo ? tRef.current.memoryUndone : tRef.current.memoryForgotten,
      );
    },
    [noticeForMemoryFailure],
  );

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    event.target.value = "";
    stageAttachmentFiles(files);
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (event.clipboardData.files.length === 0) return;
    event.preventDefault();
    stageAttachmentFiles(event.clipboardData.files);
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
    stageAttachmentFiles(event.dataTransfer.files);
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
      if (loaded.agentDetails) {
        const agentId = entry.identity.kind === "native" ? entry.identity.sessionId : entry.identity.historyId;
        const opened = entry.identity.kind === "native" ? openScopedAgentHistory(loaded) : await openHistory(agentId);
        if (generation !== viewGenerationRef.current || opened.kind !== "agent") return;
        agent.clearSelection();
        catalogEntryRef.current = entry;
        setCatalogEntry(entry);
        sessionRef.current = agentId;
        setCurrentSessionId(agentId);
        nativePersistedRef.current = true;
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
      nativePersistedRef.current = true;
      setCurrentSessionId(id);
      if (id) resetAttachmentSession(id);
      rolesRef.current.clear();
      createdRef.current = entry.created;
      setMessages(loaded.messages.map((message, index) => ({
        id: message.messageId ?? message.partId ?? "history-" + index, role: message.role, text: message.text,
        localOnly: message.localOnly, time: message.time,
      })));
      setInput("");
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
      leaveAgentHistory();
      agent.clearSelection();
      await resetSession();
    } catch (error: unknown) {
      console.error(
        error instanceof Error ? error : new Error(String(error)),
      );
      const unknown = error instanceof SessionAbortError && error.code === "UNKNOWN";
      setMemoryNotice(unknown ? tRef.current.chatStopUnknown : tRef.current.chatStopFailed);
      broadcastMood("error");
    }
  }, [agent, leaveAgentHistory, resetSession]);

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
      <header className="chat-header" data-tauri-drag-region="">
        <span className="chat-title">{activePersonaName}</span>
        <span className={`chat-status chat-status-${status}`}>
          {statusLabel[status]}
        </span>
        <button
          className="chat-iconbtn"
          disabled={!currentSessionId}
          onClick={() => {
            if (currentSessionId) {
              void invoke("workbench_open_session", { sessionId: currentSessionId, directory: currentDirectory });
            }
          }}
          aria-label={t.openInWorkbench}
          title={t.openInWorkbench}
        >
          <AppIcon name="widget" size={18} />
        </button>
        <button
          className={`chat-iconbtn${view === "history" ? " chat-iconbtn-active" : ""}`}
          onClick={() => setView(view === "history" ? "chat" : "history")}
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
      </header>

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
                  {m.localOnly && m.role === "assistant" && <div className="chat-activity">{lang === "zh-CN" ? "本地回复" : "Local reply"}</div>}
                  {(m.text.trim().length > 0 || m.role === "user") && (
                    <div className="chat-bubble">
                      <ChatText text={m.text} format={m.role === "assistant" ? "markdown" : "plain"}
                        streaming={status === "busy" && m.role === "assistant" && m.id === messages.at(-1)?.id}
                        lang={lang} />
                    </div>
                  )}
                  {m.text.trim().length > 0 && (
                    <div className="chat-msg-actions chat-worklog-actions">
                      {m.role === "user" && <>
                        <button type="button" className="chat-memory-action" disabled={worklog.operations.some((operation) => operation.messageId === m.id && !operation.receipt && !operation.error)} onClick={() => void worklog.save(m.id, m.text)}>{worklogChatCopy(lang).save}</button>
                        <button type="button" className="chat-memory-action" disabled={worklog.operations.some((operation) => operation.messageId === m.id && !operation.receipt && !operation.error)} onClick={() => void worklog.schedule(m.id)}>{worklogChatCopy(lang).schedule}</button>
                      </>}
                      <button
                        type="button"
                        className="chat-memory-action"
                        onClick={() => void rememberMessage(m)}
                        title={t.memoryRemember}
                      >
                        {t.memoryRemember}
                      </button>
                      {memoryReceipts[m.id] && (
                        <button
                          type="button"
                          className="chat-memory-action chat-memory-action-danger"
                          onClick={() =>
                            void dropMemory(m.id, memoryReceipts[m.id].memoryId, false)
                          }
                          title={t.memoryForget}
                        >
                          {t.memoryForget}
                        </button>
                      )}
                    </div>
                  )}
                  {memoryReceipts[m.id] && (
                    <div className="chat-memory-receipt" role="status" aria-live="polite">
                      <span className="chat-memory-receipt-text">
                        {t.memorySaved(memoryReceipts[m.id].content)}
                      </span>
                      {memoryReceipts[m.id].undoable && (
                        <button
                          type="button"
                          className="chat-memory-undo"
                          onClick={() =>
                            void dropMemory(m.id, memoryReceipts[m.id].memoryId, true)
                          }
                        >
                          {t.memoryUndo}
                        </button>
                      )}
                    </div>
                  )}
                  {worklog.operations.filter((operation) => operation.messageId === m.id).map((operation) => <WorklogReceipt key={operation.requestId} operation={operation} language={lang} onUndo={worklog.undo} onRefresh={worklog.refresh} />)}
                  {sensitivePrompt?.messageId === m.id && (
                    <div className="chat-memory-confirm" role="alertdialog">
                      <div className="chat-memory-confirm-title">
                        {t.memorySensitiveTitle}
                      </div>
                      <p className="chat-memory-confirm-body">
                        {t.memorySensitiveBody}
                      </p>
                      <div className="chat-memory-confirm-actions">
                        <button
                          type="button"
                          className="chat-memory-action"
                          onClick={() => void rememberMessage(m, true)}
                        >
                          {t.memorySensitiveConfirm}
                        </button>
                        <button
                          type="button"
                          className="chat-memory-action"
                          onClick={() => setSensitivePrompt(null)}
                        >
                          {t.memorySensitiveCancel}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {isPersonaTyping && (
              <div className="chat-typing" role="status" aria-live="polite">
                {t.chatTyping}
              </div>
            )}
            {worklog.operations.filter((operation) => !messages.some((message) => message.id === operation.messageId)).map((operation) => <WorklogReceipt key={operation.requestId} operation={operation} language={lang} onUndo={worklog.undo} onRefresh={worklog.refresh} />)}
          </div>

          <ChatNavigation messages={messages} listRef={listRef} lang={lang} onNavigate={() => { followLatestRef.current = false; }} />
          </div>
          {memoryNotice && (
            <div className="chat-memory-notice" role="status" aria-live="polite">
              {memoryNotice}
            </div>
          )}

          <WorkspaceTask language={lang} agent={agent} historyDetails={agentHistoryArchive?.agentDetails} onWorkspaceSelected={leaveAgentHistory} />
          {sessionOwnedByWorkbench || readOnlyHistory || historyLoading ? (
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
                    void invoke("workbench_open_session", { sessionId: currentSessionId, directory: currentDirectory });
                  }
                }}
              >
                {t.openInWorkbench}
              </button>
            </div>
          ) : (
            <>
              <ToolApprovalCards requests={permissions.requests} error={permissions.error} onReply={permissions.reply} t={t} />
              <footer className="chat-input-row">
            <input
              ref={fileInputRef}
              className="chat-file-input"
              type="file"
              multiple
              accept="image/png,image/jpeg,image/gif,image/webp,.txt,.md,.json,.csv,.pdf,.docx,.ncm,.ts,.tsx,.js,.jsx,.css,.html,.xml,.yaml,.yml,.toml,.log"
              onChange={handleFileInputChange}
            />
            <div className="chat-input-wrap">
              <AttachmentTray
                t={t}
                items={chatAttachments.items}
                error={attachmentError}
                onConfirm={chatAttachments.confirm}
                onCancel={chatAttachments.cancel}
                onRemove={chatAttachments.remove}
                onRetry={chatAttachments.retry}
              />
              <div className="chat-textarea-wrap">
                <textarea
                  className="chat-input"
                  value={input}
                  placeholder={t.chatInputPlaceholder}
                  rows={2}
                  onChange={(e) => {
                    setInput(e.target.value);
                    if (e.target.value.trim()) setAttachmentError(null);
                  }}
                  onPaste={handlePaste}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <button
                  className="chat-attach"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={status === "busy" || !currentSessionId || attachmentBusy}
                  aria-label={t.chatAttach}
                  title={t.chatAttachHint}
                >
                  <AppIcon name="attachment" size={16} />
                </button>
              </div>
            </div>
            {status === "busy" ? (
              <button
                className="chat-send chat-abort"
                onClick={() => void abort()}
                disabled={isCancelling}
              >
                {isCancelling ? t.chatStopping : t.chatStop}
              </button>
            ) : (
              <button
                className="chat-send"
                onClick={() => void send()}
                disabled={
                  agent.workspace || agentHistoryId || agent.busy
                    ? agent.busy || !input.trim()
                    : status !== "ready" ||
                      attachmentBusy ||
                      (!input.trim() && chatAttachments.items.length === 0)
                }
              >
                {t.chatSend}
              </button>
            )}
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











