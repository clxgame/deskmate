// allow: SIZE_OK — legacy chat shell keeps the single render boundary; this fix only adds the deterministic 小著 reply adapter.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  abortSession,
  createSession,
  promptAsync,
  subscribeEvents,
  waitForServer,
  type OpenCodeEvent,
} from "../lib/opencode";
import { broadcastMood } from "../lib/petState";
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
import { memoryForgetConversation } from "../lib/memory";
import {
  getSettings,
  onResourceError,
  onScheduledTask,
  onSettingsChanged,
  type Settings,
} from "../lib/settings";
import type { ThemeId } from "../settings/theme";
import { dict } from "../lib/i18n";
import {
  historyDelete,
  historyList,
  historyLoad,
  historySave,
  type HistorySummary,
} from "../lib/history";
import {
  createPendingAttachment,
  formatAttachmentSize,
  isNcmFile,
  isSupportedAttachment,
  MAX_TOTAL_ATTACHMENT_BYTES,
  readChatAttachment,
  snapshotSelectedFiles,
  toOpenCodeFilePart,
  type ChatAttachment,
} from "./attachments";
import { ChatText } from "./ChatText";
import { CcSwitchSetupCard } from "./CcSwitchSetupCard";
import {
  CCSWITCH_PREPARE_OPENCODE_PROVIDER_TOOL,
  createCcSwitchToolResultTracker,
  recoverCcSwitchToolResultsFromMessages,
  toOpenCodeToolPart,
  type CcSwitchProviderDraft,
  type CcSwitchToolResult,
} from "./ccSwitchSetup";
import "./chat.css";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** live tool activity line, e.g. "bash: npm test" */
  activity?: string;
  attachments?: ChatAttachment[];
}

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

interface BufferedAssistantUpdate {
  messageID: string;
  hasText: boolean;
  text?: string;
  activity?: string;
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

export default function ChatApp() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>("booting");
  const [isPersonaTyping, setIsPersonaTyping] = useState(false);
  const [lang, setLang] = useState("zh-CN");
  const [theme, setTheme] = useState<ThemeId>("dark");
  const [activePersonaId, setActivePersonaId] = useState(DEFAULT_PERSONA_ID);
  const [view, setView] = useState<View>("chat");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [readingAttachments, setReadingAttachments] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
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
  const personaRef = useRef<PersonaData | null>(null);
  const activePersonaIdRef = useRef(DEFAULT_PERSONA_ID);
  const personaLoadRef = useRef<Promise<void>>(Promise.resolve());
  const personaLoadSequenceRef = useRef(0);
  const settingsRef = useRef<Settings | null>(null);
  /** role by server messageID; used to skip user-message parts in SSE. */
  const rolesRef = useRef<Map<string, string>>(new Map());
  const listRef = useRef<HTMLDivElement>(null);
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
        message.activity ? { ...message, activity: undefined } : message,
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
          activity: undefined,
        })),
      );
      return;
    }
    pacing.pendingUpdates.set(messageID, {
      messageID,
      hasText: true,
      text,
      activity: undefined,
    });
  };

  const queueAssistantTool = (messageID: string, activity: string) => {
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
          message.activity ? { ...message, activity: undefined } : message,
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
    broadcastMood("thinking");
    await waitForDelay(FIXED_REPLY_TYPING_DELAY_MS);
    return fixedReplySequenceRef.current === sequence;
  };

  useEffect(() => {
    return () => {
      fixedReplySequenceRef.current += 1;
      clearReplyPacing();
    };
  }, []);

  useEffect(() => {
    const subscription = listen("deskmate://ccswitch-setup-request", () => {
      ccSwitchDraftRef.current = null;
      setCcSwitchDraft(null);
      setCcSwitchSetupOpen(true);
      setView("chat");
    });
    return () => {
      void subscription.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, []);

  const resetSession = useCallback(async (): Promise<void> => {
    fixedReplySequenceRef.current += 1;
    clearReplyPacing();
    setIsPersonaTyping(false);
    const previousSession = sessionRef.current;
    if (previousSession) {
      await abortSession(previousSession).catch(() => {});
    }
    await waitForServer();
    const session = await createSession("YUME chat");
    sessionRef.current = session.id;
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
  }, []);

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
        const opencode = await import("../lib/opencode");
        if (typeof opencode.getSessionMessages !== "function") return;
        const results = recoverCcSwitchToolResultsFromMessages(
          await opencode.getSessionMessages(sessionID),
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
    let unsubscribe: (() => void) | null = null;

    (async () => {
      try {
        settingsRef.current = await getSettings().catch(() => null);
        const initialPersonaId = resolvePersonaId(
          settingsRef.current?.personaId,
        );
        if (settingsRef.current) {
          setLang(settingsRef.current.language);
          setTheme(settingsRef.current.theme);
        }
        await loadPersona(initialPersonaId);
        void onSettingsChanged((s) => {
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
        await resetSession();
        if (closed) return;
        unsubscribe = await subscribeEvents(handleEvent);
        setStatus("ready");
        broadcastMood("idle");
      } catch (error: unknown) {
        console.error(
          error instanceof Error ? error : new Error(String(error)),
        );
        setStatus("error");
        broadcastMood("error");
      }
    })();

    return () => {
      closed = true;
      unsubscribe?.();
    };
  }, [loadPersona, resetSession]);

  const handleEvent = useCallback((e: OpenCodeEvent) => {
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
        // Parts of the user's own message echo back over SSE; skip them.
        if (rolesRef.current.get(part.messageID) === "user") return;

        if (part.type === "text") {
          setIsPersonaTyping(true);
          broadcastMood("talking");
          queueAssistantText(part.messageID, part.text ?? "");
        } else if (part.type === "tool") {
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
        if (typeof props.sessionID === "string") {
          void recoverCcSwitchToolResultsOnIdle(props.sessionID);
        }
        completeReplyPacing();
        break;
      }
      case "session.error": {
        if (props.sessionID && props.sessionID !== sessionRef.current) return;
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

  // Auto-scroll on new content.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  // Mirror messages into a ref for history persistence.
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Persist history when a turn completes (status ready) and messages exist.
  useEffect(() => {
    if (status !== "ready" || messages.length === 0) return;
    const sessionID = sessionRef.current;
    if (!sessionID) return;
    const timer = setTimeout(() => {
      const msgs = messagesRef.current;
      const firstUser = msgs.find((m) => m.role === "user");
      const title = firstUser
        ? firstUser.text.slice(0, 40)
        : tRef.current.historyNewSession;
      void historySave({
        id: sessionID,
        title,
        created: createdRef.current,
        updated: Date.now(),
        messages: msgs
          .filter((m) => m.text.trim().length > 0)
          .map((m) => ({ role: m.role, text: m.text, time: Date.now() })),
      }).catch((e) => console.error("history save failed", e));
    }, 300);
    return () => clearTimeout(timer);
  }, [messages, status]);

  const prepareAttachmentsForSend = async (
    queuedAttachments: ChatAttachment[],
  ): Promise<ChatAttachment[]> => {
    if (!queuedAttachments.some((item) => item.status === "pending")) {
      return queuedAttachments;
    }
    setReadingAttachments(true);
    let lastError: string | null = null;
    const prepared: ChatAttachment[] = [];
    try {
      for (const attachment of queuedAttachments) {
        if (attachment.status !== "pending") {
          prepared.push(attachment);
          continue;
        }
        const file = attachment.file;
        try {
          if (!file) throw new Error(`${attachment.name} 无法访问，请重新添加`);
          let readyAttachment: ChatAttachment;
          if (isNcmFile(file)) {
            if (activePersonaIdRef.current !== "xiaozhu") {
              throw new Error(".ncm 音乐转换是小著的专属能力，请先切换到小著");
            }
            const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
            const converted = await invoke<{
              filename: string;
              mime: string;
              size: number;
              dataUrl: string;
            }>("convert_ncm", {
              personaId: activePersonaIdRef.current,
              filename: file.name,
              bytes,
            });
            readyAttachment = {
              id: attachment.id,
              name: converted.filename,
              mime: converted.mime,
              size: converted.size,
              kind: "audio",
              status: "ready",
              dataUrl: converted.dataUrl,
            };
          } else {
            readyAttachment = {
              ...(await readChatAttachment(file)),
              id: attachment.id,
              status: "ready",
            };
          }
          prepared.push(readyAttachment);
          setAttachments((current) =>
            current.map((item) =>
              item.id === attachment.id ? readyAttachment : item,
            ),
          );
        } catch (error: unknown) {
          const detail = error instanceof Error ? error.message : String(error);
          const message = detail || tRef.current.chatAttachmentReadFailed;
          lastError = message;
          const failedAttachment = {
            ...attachment,
            status: "error" as const,
            error: message,
          };
          prepared.push(failedAttachment);
          setAttachments((current) =>
            current.map((item) =>
              item.id === attachment.id ? failedAttachment : item,
            ),
          );
        }
      }
    } finally {
      setReadingAttachments(false);
    }
    if (lastError) setAttachmentError(lastError);
    return prepared;
  };

  const send = async () => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (status !== "ready" || !sessionRef.current) return;
    if (containsCcSwitchApiKey(text)) {
      setInput("");
      setAttachmentError(null);
      setCcSwitchDraft(null);
      setCcSwitchSetupOpen(true);
      setMemoryNotice(t.ccSwitchSecretRedirect);
      return;
    }
    if (readingAttachments) {
      setAttachmentError(t.chatAttachmentStillReading);
      return;
    }
    if (attachments.some((item) => item.status === "error")) {
      setAttachmentError(t.chatAttachmentFixErrors);
      return;
    }
    const pendingAttachments = await prepareAttachmentsForSend(attachments);
    if (pendingAttachments.some((item) => item.status === "pending")) {
      setAttachmentError(t.chatAttachmentStillReading);
      return;
    }
    if (pendingAttachments.some((item) => item.status === "error")) {
      setAttachmentError(t.chatAttachmentFixErrors);
      return;
    }
    setInput("");
    setAttachments([]);
    setAttachmentError(null);
    await sendText(text, pendingAttachments);
  };

  const queueSelectedFiles = (files: FileList | File[]) => {
    const selected = Array.from(files);
    if (selected.length === 0) return;
    if (readingAttachments) {
      setAttachmentError(t.chatAttachmentStillReading);
      return;
    }
    let totalBytes = attachments.reduce(
      (sum, item) => (item.status === "error" ? sum : sum + item.size),
      0,
    );
    const queued = selected.map((file) => {
      const placeholder = createPendingAttachment(file);
      if (!isNcmFile(file) && !isSupportedAttachment(file)) {
        return {
          ...placeholder,
          status: "error" as const,
          error: `${file.name} 暂不支持读取，请选择图片、PDF、DOCX 或文本文件`,
        };
      }
      if (totalBytes + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
        return {
          ...placeholder,
          status: "error" as const,
          error: `${file.name} 超过 20 MB 限制`,
        };
      }
      totalBytes += file.size;
      return placeholder;
    });
    const firstError = queued.find((item) => item.status === "error");
    setAttachments((current) => [...current, ...queued]);
    setAttachmentError(firstError?.error ?? null);
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
    setAttachmentError(null);
  };

  const sendText = async (
    text: string,
    messageAttachments: ChatAttachment[] = [],
  ) => {
    const sessionID = sessionRef.current;
    if ((!text && messageAttachments.length === 0) || !sessionID) return;
    await personaLoadRef.current;
    const attachmentNames = messageAttachments.map((item) => item.name).join(", ");
    const promptText = text || `请读取我上传的附件：${attachmentNames}`;
    setMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        role: "user",
        text: text || `附件：${attachmentNames}`,
        attachments: messageAttachments,
      },
    ]);
    setStatus("busy");
    setIsPersonaTyping(false);
    broadcastMood("thinking");
    const fixedReplySequence = fixedReplySequenceRef.current + 1;
    fixedReplySequenceRef.current = fixedReplySequence;
    if (
      activePersonaIdRef.current === DEFAULT_PERSONA_ID &&
      messageAttachments.length === 0
    ) {
      if (isXiaozhuNameOriginQuestion(text)) {
        if (!(await waitForFixedReplyStart(fixedReplySequence))) return;
        for (const [index, line] of XIAOZHU_NAME_ORIGIN_LINES.entries()) {
          if (index > 0) {
            setIsPersonaTyping(true);
            broadcastMood("thinking");
            await new Promise<void>((resolve) => {
              globalThis.setTimeout(resolve, 2000);
            });
            if (fixedReplySequenceRef.current !== fixedReplySequence) return;
          }
          setIsPersonaTyping(false);
          setMessages((prev) => [
            ...prev,
            {
              id: `xiaozhu-name-origin-${fixedReplySequence}-${index}`,
              role: "assistant",
              text: line,
            },
          ]);
          broadcastMood("talking");
        }
        setIsPersonaTyping(false);
        setStatus("ready");
        broadcastMood("idle");
        return;
      }
      if (isXiaozhuIdentityQuestion(text)) {
        if (!(await waitForFixedReplyStart(fixedReplySequence))) return;
        setIsPersonaTyping(false);
        setMessages((prev) => [
          ...prev,
          {
            id: `xiaozhu-identity-${fixedReplySequence}`,
            role: "assistant",
            text: XIAOZHU_IDENTITY_REPLY,
          },
        ]);
        broadcastMood("talking");
        setStatus("ready");
        broadcastMood("idle");
        return;
      }
    }
    startReplyPacing();
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
      await promptAsync(sessionID, promptText, {
        system,
        attachments: messageAttachments
          .map(toOpenCodeFilePart)
          .filter((part): part is NonNullable<typeof part> => part !== null),
        model:
          s?.providerId && s.modelId
            ? { providerID: s.providerId, modelID: s.modelId }
            : undefined,
      });
    } catch (error: unknown) {
      console.error(
        error instanceof Error ? error : new Error(String(error)),
      );
      clearReplyPacing();
      setIsPersonaTyping(false);
      setStatus("ready");
      broadcastMood("error");
      if (messageAttachments.length > 0) {
        setAttachments(messageAttachments);
        setAttachmentError(tRef.current.chatAttachmentSendFailed);
      }
    }
  };

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
    async (message: ChatMessage, sensitiveConfirmed = false) => {
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
    const files = snapshotSelectedFiles(event.target.files);
    event.target.value = "";
    if (files.length > 0) queueSelectedFiles(files);
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    queueSelectedFiles(files);
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
    queueSelectedFiles(event.dataTransfer.files);
  };

  // Scheduled tasks fired by the Rust scheduler: auto-send the prompt.
  const sendTextRef = useRef(sendText);
  sendTextRef.current = sendText;
  useEffect(() => {
    const unlisten = onScheduledTask((task) => {
      void sendTextRef.current(
        `[${tRef.current.scheduledTaskPrefix} ${task.time}] ${task.prompt}`,
      );
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

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
    fixedReplySequenceRef.current += 1;
    clearReplyPacing();
    setIsPersonaTyping(false);
    setStatus("ready");
    broadcastMood("idle");
    if (sessionRef.current)
      await abortSession(sessionRef.current).catch(() => {});
  };

  /** Resume a past session: adopt its opencode session id and reload messages. */
  const resumeSession = useCallback(async (id: string) => {
    fixedReplySequenceRef.current += 1;
    clearReplyPacing();
    setIsPersonaTyping(false);
    const rec = await historyLoad(id).catch(() => null);
    if (!rec) return;
    sessionRef.current = id;
    rolesRef.current.clear();
    createdRef.current = rec.created;
    setMessages(
      rec.messages.map((m, i) => ({
        id: `hist-${i}`,
        role: m.role,
        text: m.text,
      })),
    );
    setView("chat");
    setStatus("ready");
    broadcastMood("idle");
  }, []);

  /** Start a fresh session. */
  const newChat = useCallback(async () => {
    try {
      await resetSession();
    } catch (error: unknown) {
      console.error(
        error instanceof Error ? error : new Error(String(error)),
      );
      setStatus("error");
      broadcastMood("error");
    }
  }, [resetSession]);

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
          className={`chat-iconbtn${view === "history" ? " chat-iconbtn-active" : ""}`}
          onClick={() => setView(view === "history" ? "chat" : "history")}
          aria-label={t.tabHistory}
          title={t.tabHistory}
        >
          ◷
        </button>
        <button
          className="chat-settings"
          onClick={() => void invoke("open_settings")}
          aria-label={t.chatSettings}
          title={t.chatSettings}
        >
          ⚙
        </button>
        <button
          className="chat-close"
          onClick={() => void closeChat()}
          aria-label={t.close}
        >
          ×
        </button>
      </header>

      {view === "history" ? (
        <HistoryPanel
          t={t}
          onContinue={resumeSession}
          onNewChat={newChat}
        />
      ) : (
        <>
          <div className="chat-list" ref={listRef}>
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
                <ChatText text={chatEmpty} />
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`chat-msg chat-msg-${m.role}`}>
                {m.activity && (
                  <div className="chat-activity">⚙ {m.activity}</div>
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
                {(m.text.trim().length > 0 || m.role === "user") && (
                  <div className="chat-bubble">
                    <ChatText text={m.text} />
                  </div>
                )}
                {m.text.trim().length > 0 && (
                  <div className="chat-msg-actions">
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
            ))}
            {isPersonaTyping && (
              <div className="chat-typing" role="status" aria-live="polite">
                {t.chatTyping}
              </div>
            )}
          </div>

          {memoryNotice && (
            <div className="chat-memory-notice" role="status" aria-live="polite">
              {memoryNotice}
            </div>
          )}

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
              {(attachments.length > 0 || attachmentError) && (
                <div className="chat-attachment-tray" aria-live="polite">
                  {attachments.map((attachment) => (
                    <div
                      className={`chat-attachment-chip chat-attachment-chip-${attachment.status}`}
                      key={attachment.id}
                    >
                      <span className="chat-attachment-kind">
                        {attachment.kind === "image"
                          ? "图"
                          : attachment.kind === "audio"
                            ? "音"
                            : "文"}
                      </span>
                      <span className="chat-attachment-name" title={attachment.name}>
                        {attachment.name}
                      </span>
                      {attachment.status === "pending" ? (
                        <span className="chat-attachment-status chat-attachment-status-pending">
                          {t.chatAttachmentPending}
                        </span>
                      ) : attachment.status === "error" ? (
                        <span
                          className="chat-attachment-status chat-attachment-status-error"
                          title={attachment.error}
                        >
                          {t.chatAttachmentError}
                        </span>
                      ) : (
                        <span className="chat-attachment-size">
                          {t.chatAttachmentReady} · {formatAttachmentSize(attachment.size)}
                        </span>
                      )}
                      <button
                        className="chat-attachment-remove"
                        type="button"
                        onClick={() => removeAttachment(attachment.id)}
                        disabled={readingAttachments}
                        aria-label={`${t.chatAttachmentRemove} ${attachment.name}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {attachmentError && (
                    <div className="chat-attachment-error">{attachmentError}</div>
                  )}
                </div>
              )}
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
                  disabled={status === "busy" || readingAttachments}
                  aria-label={t.chatAttach}
                  title={t.chatAttachHint}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M8 2.5v11M2.5 8h11" />
                  </svg>
                </button>
              </div>
            </div>
            {status === "busy" ? (
              <button
                className="chat-send chat-abort"
                onClick={() => void abort()}
              >
                {t.chatStop}
              </button>
            ) : (
              <button
                className="chat-send"
                onClick={() => void send()}
                disabled={
                  status !== "ready" ||
                  readingAttachments ||
                  (!input.trim() && attachments.length === 0)
                }
              >
                {t.chatSend}
              </button>
            )}
          </footer>
        </>
      )}
    </div>
  );
}

function AttachmentPreview({
  attachment,
}: {
  attachment: ChatAttachment;
}) {
  if (attachment.status !== "ready" || !attachment.dataUrl) {
    return (
      <div className="chat-attachment-document">
        {attachment.name} · {attachment.error ?? "读取中"}
      </div>
    );
  }
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
  if (attachment.kind === "audio") {
    return (
      <audio
        className="chat-attachment-audio"
        controls
        preload="metadata"
        src={attachment.dataUrl}
        aria-label={attachment.name}
      />
    );
  }
  return <div className="chat-attachment-document">文档 · {attachment.name}</div>;
}

function hasVisibleMessageContent(message: ChatMessage): boolean {
  return (
    message.text.trim().length > 0 ||
    (message.attachments !== undefined && message.attachments.length > 0)
  );
}

/** Update the assistant message with the given id, creating it if missing. */
function upsertAssistant(
  prev: ChatMessage[],
  messageID: string,
  update: (m: ChatMessage) => ChatMessage,
): ChatMessage[] {
  const idx = prev.findIndex((m) => m.id === messageID);
  if (idx >= 0) {
    const next = [...prev];
    next[idx] = update(next[idx]);
    return next;
  }
  return [...prev, update({ id: messageID, role: "assistant", text: "" })];
}

// ------------------------------------------------------------------- 历史

function HistoryPanel({
  t,
  onContinue,
  onNewChat,
}: {
  t: ReturnType<typeof dict>;
  onContinue: (id: string) => void;
  onNewChat: () => void;
}) {
  const [sessions, setSessions] = useState<HistorySummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  /**
   * Deleting a conversation offers to drop the memories that came only from it,
   * enabled by default. Memories with other sources, or that the user saved
   * explicitly elsewhere, always survive.
   */
  const [deleteMemories, setDeleteMemories] = useState(true);

  const refresh = useCallback(() => {
    setFailed(false);
    void historyList()
      .then(setSessions)
      .catch(() => {
        setFailed(true);
        setSessions([]);
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const remove = async (id: string) => {
    await historyDelete(id).catch(() => {});
    if (deleteMemories) {
      // A memory failure must not leave the conversation half-deleted.
      await memoryForgetConversation(id).catch(() => {});
    }
    refresh();
  };

  return (
    <div className="history-panel">
      <div className="history-head">
        <span className="history-title">{t.tabHistory}</span>
        <button className="history-new" onClick={() => void onNewChat()}>
          + {t.historyNewSession}
        </button>
      </div>
      {failed && (
        <p className="history-empty history-error">{t.historyLoadFailed}</p>
      )}
      {sessions !== null && sessions.length > 0 && (
        <label className="history-memory-option">
          <input
            type="checkbox"
            checked={deleteMemories}
            onChange={(event) => setDeleteMemories(event.target.checked)}
          />
          {t.memoryDeleteWithConversation}
        </label>
      )}
      {sessions === null ? (
        <p className="history-empty">{t.loading}</p>
      ) : sessions.length === 0 ? (
        <p className="history-empty">{t.historyEmpty}</p>
      ) : (
        <div className="history-list">
          {sessions.map((s) => (
            <div key={s.id} className="history-item">
              <button
                className="history-main"
                onClick={() => void onContinue(s.id)}
              >
                <span className="history-item-title">
                  {s.title || t.historyNewSession}
                </span>
                <span className="history-item-meta">
                  {formatTime(s.updated)} · {t.historyCount(s.count)}
                </span>
              </button>
              <button
                className="history-del"
                aria-label={t.historyDelete}
                title={t.historyDelete}
                onClick={() => void remove(s.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
  if (d.toDateString() === now.toDateString()) return hm;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
