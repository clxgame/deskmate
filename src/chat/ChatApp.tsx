import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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
  personaDisplayName,
  personalizePersonaCopy,
  resolvePersonaId,
  shouldResetSessionForPersona,
} from "./chatPersona";
import {
  getSettings,
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
  type HistorySession,
  type HistorySummary,
} from "../lib/history";
import "./chat.css";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** live tool activity line, e.g. "bash: npm test" */
  activity?: string;
}

interface PersonaData {
  persona: string;
  placeholders: {
    streaming?: string;
    completed?: string;
    error?: string;
  } | null;
}

type Status = "booting" | "ready" | "busy" | "error";

type View = "chat" | "history";

export default function ChatApp() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>("booting");
  const [lang, setLang] = useState("zh-CN");
  const [theme, setTheme] = useState<ThemeId>("dark");
  const [activePersonaId, setActivePersonaId] = useState(DEFAULT_PERSONA_ID);
  const [view, setView] = useState<View>("chat");
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
  /** mirror of `messages` for persisting history outside render. */
  const messagesRef = useRef<ChatMessage[]>([]);
  const createdRef = useRef<number>(Date.now());

  const resetSession = useCallback(async (): Promise<void> => {
    const previousSession = sessionRef.current;
    if (previousSession) {
      await abortSession(previousSession).catch(() => {});
    }
    await waitForServer();
    const session = await createSession("deskmate chat");
    sessionRef.current = session.id;
    rolesRef.current.clear();
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
      } catch (e) {
        console.error(e);
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
          broadcastMood("talking");
          setMessages((prev) =>
            upsertAssistant(prev, part.messageID, (m) => ({
              ...m,
              text: part.text ?? "",
              activity: undefined,
            })),
          );
        } else if (part.type === "tool") {
          broadcastMood("working");
          const label = part.state?.title || part.tool || "tool";
          setMessages((prev) =>
            upsertAssistant(prev, part.messageID, (m) => ({
              ...m,
              activity: label,
            })),
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
        setStatus("ready");
        broadcastMood("idle");
        setMessages((prev) =>
          prev.map((m) => (m.activity ? { ...m, activity: undefined } : m)),
        );
        break;
      }
      case "session.error": {
        if (props.sessionID && props.sessionID !== sessionRef.current) return;
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

  const send = async () => {
    const text = input.trim();
    if (!text || status === "busy" || status === "booting") return;
    setInput("");
    await sendText(text);
  };

  /** Shared send path for user input and scheduled tasks. */
  const sendText = async (text: string) => {
    const sessionID = sessionRef.current;
    if (!text || !sessionID) return;
    await personaLoadRef.current;
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: "user", text },
    ]);
    setStatus("busy");
    broadcastMood("thinking");
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
      const system = persona
        ? langName
          ? `${persona}\n\n# 回复语言\n\n- 使用 ${langName} 回复(用户界面语言已切换)`
          : persona
        : undefined;
      await promptAsync(sessionID, text, {
        system,
        model:
          s?.providerId && s.modelId
            ? { providerID: s.providerId, modelID: s.modelId }
            : undefined,
      });
    } catch (e) {
      console.error(e);
      setStatus("ready");
      broadcastMood("error");
    }
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

  const abort = async () => {
    if (sessionRef.current)
      await abortSession(sessionRef.current).catch(() => {});
  };

  /** Resume a past session: adopt its opencode session id and reload messages. */
  const resumeSession = useCallback(async (id: string) => {
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
    } catch (e) {
      console.error(e);
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
    <div className="chat-root" data-theme={theme}>
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
          assistantName={activePersonaName}
          onContinue={resumeSession}
          onNewChat={newChat}
        />
      ) : (
        <>
          <div className="chat-list" ref={listRef}>
            {messages.length === 0 && (
              <div className="chat-empty">{chatEmpty}</div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`chat-msg chat-msg-${m.role}`}>
                {m.activity && (
                  <div className="chat-activity">⚙ {m.activity}</div>
                )}
                <div className="chat-bubble">{m.text || "…"}</div>
              </div>
            ))}
          </div>

          <footer className="chat-input-row">
            <textarea
              className="chat-input"
              value={input}
              placeholder={t.chatInputPlaceholder}
              rows={2}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
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
                disabled={status !== "ready"}
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
  assistantName,
  onContinue,
  onNewChat,
}: {
  t: ReturnType<typeof dict>;
  assistantName: string;
  onContinue: (id: string) => void;
  onNewChat: () => void;
}) {
  const [sessions, setSessions] = useState<HistorySummary[] | null>(null);
  const [open, setOpen] = useState<HistorySession | null>(null);
  const [failed, setFailed] = useState(false);

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

  const openSession = async (id: string) => {
    const s = await historyLoad(id).catch(() => null);
    setOpen(s);
  };

  const remove = async (id: string) => {
    await historyDelete(id).catch(() => {});
    refresh();
  };

  if (open) {
    return (
      <div className="history-panel">
        <div className="history-head">
          <button className="history-back" onClick={() => setOpen(null)}>
            ← {t.historyBack}
          </button>
          <span className="history-title" title={open.title}>
            {open.title || t.historyNewSession}
          </span>
          <button
            className="history-continue"
            onClick={() => onContinue(open.id)}
          >
            {t.historyContinue}
          </button>
        </div>
        <div className="history-msgs">
          {open.messages.map((m, i) => (
            <div key={i} className={`history-msg history-msg-${m.role}`}>
              <div className="history-role">
                {m.role === "user" ? t.historyYou : assistantName}
              </div>
              <div className="history-text">{m.text}</div>
            </div>
          ))}
          {open.messages.length === 0 && (
            <p className="history-empty">{t.historyEmpty}</p>
          )}
        </div>
      </div>
    );
  }

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
                onClick={() => void openSession(s.id)}
              >
                <span className="history-item-title">
                  {s.title || t.historyNewSession}
                </span>
                <span className="history-item-meta">
                  {formatTime(s.updated)} · {t.historyCount(s.count)}
                </span>
              </button>
              <button
                className="history-continue history-continue-sm"
                onClick={() => onContinue(s.id)}
                title={t.historyContinue}
              >
                →
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
