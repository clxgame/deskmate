import { createContext, memo, useContext, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remend from "remend";
import { Code } from "@phosphor-icons/react/dist/csr/Code";
import { Copy } from "@phosphor-icons/react/dist/csr/Copy";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { WarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle";
import "./chat-markdown.css";

interface ChatTextProps {
  readonly text: string;
  readonly format?: "plain" | "markdown";
  readonly streaming?: boolean;
  readonly lang?: string;
}

const LABELS = {
  "zh-CN": { code: "代码（可横向滚动）", table: "表格（可横向滚动）", linkError: "无法打开，请复制链接" },
  en: { code: "Code (scroll horizontally)", table: "Table (scroll horizontally)", linkError: "Could not open; copy the link" },
  ja: { code: "コード（横スクロール可能）", table: "表（横スクロール可能）", linkError: "開けません。リンクをコピーしてください" },
  ko: { code: "코드 (가로 스크롤 가능)", table: "표 (가로 스크롤 가능)", linkError: "열 수 없습니다. 링크를 복사하세요" },
} as const;
const COPY_LABELS = {
  "zh-CN": { button: "复制", accessible: "复制代码", success: "已复制", failure: "复制失败，请重试" },
  en: { button: "Copy", accessible: "Copy code", success: "Copied", failure: "Copy failed. Retry." },
  ja: { button: "コピー", accessible: "コードをコピー", success: "コピーしました", failure: "コピー失敗。再試行してください" },
  ko: { button: "복사", accessible: "코드 복사", success: "복사됨", failure: "복사 실패. 다시 시도하세요" },
} as const;
const CopyLabelsContext = createContext<{ readonly button: string; readonly accessible: string; readonly success: string; readonly failure: string }>(COPY_LABELS["zh-CN"]);
const LabelsContext = createContext<{ readonly code: string; readonly table: string; readonly linkError: string }>(LABELS["zh-CN"]);
const REMARK_PLUGINS = [remarkGfm];
const COMPONENTS: Components = {
  a: function MarkdownLink({ href, children, title, id }) {
    const [failed, setFailed] = useState(false);
    const labels = useContext(LabelsContext);
    if (!href) return <span>{children}</span>;
    return (
      <>
      <a href={href} id={id} title={title ?? href}
        target={href.startsWith("#") ? undefined : "_blank"} rel="noopener noreferrer"
        onClick={(event) => {
          if (href.startsWith("#") || !isTauri()) return;
          event.preventDefault();
          setFailed(false);
          void invoke("open_chat_link", { url: href }).catch(() => setFailed(true));
        }}>
        {children}
      </a>
      {failed && <span role="alert"> ({labels.linkError}: {href})</span>}
      </>
    );
  },
  img: function MarkdownImage({ alt }) {
    return <span className="chat-markdown-image-alt">{alt}</span>;
  },
  pre: function MarkdownCode({ children, node }) {
    const labels = useContext(LabelsContext);
    const copyLabels = useContext(CopyLabelsContext);
    const codeRef = useRef<HTMLPreElement>(null);
    const [copying, setCopying] = useState(false);
    const [feedback, setFeedback] = useState("");
    const codeNode = node?.children.find((child) => child.type === "element" && child.tagName === "code");
    const classes = codeNode?.type === "element" ? codeNode.properties.className : undefined;
    const languageClass = Array.isArray(classes) ? classes.find((name) => typeof name === "string" && name.startsWith("language-")) : undefined;
    const language = typeof languageClass === "string" ? languageClass.slice(9) : "text";
    useEffect(() => {
      if (!feedback) return;
      const timer = window.setTimeout(() => setFeedback(""), 2000);
      return () => window.clearTimeout(timer);
    }, [feedback]);
    async function copyCode() {
      if (!codeRef.current || copying) return;
      const text = codeRef.current.textContent ?? "";
      setCopying(true);
      setFeedback("");
      try {
        await navigator.clipboard.writeText(text);
        setFeedback(copyLabels.success);
      } catch (error) {
        setFeedback(copyLabels.failure);
        if (!(error instanceof Error)) console.error("Clipboard write failed", error);
      } finally {
        setCopying(false);
      }
    }
    return (
      <div className="chat-code-block">
        <div className="chat-code-toolbar">
          <span className="chat-code-language"><Code size={16} aria-hidden="true" /><span>{language}</span></span>
          <span className="chat-code-status" role="status">{feedback}</span>
          <button type="button" aria-label={copyLabels.accessible} title={feedback || copyLabels.accessible} aria-disabled={copying} onClick={copyCode}>
            {feedback === copyLabels.success ? <Check size={16} aria-hidden="true" /> : feedback === copyLabels.failure ? <WarningCircle size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          </button>
        </div>
        <pre ref={codeRef} tabIndex={0} role="region" aria-label={labels.code}>{children}</pre>
      </div>
    );
  },
  table: function MarkdownTable({ children }) {
    const labels = useContext(LabelsContext);
    return (
      <div className="chat-markdown-table" tabIndex={0} role="region" aria-label={labels.table}>
        <table>{children}</table>
      </div>
    );
  },
};

function chatUrl(url: string): string {
  // Chat content must never navigate to local files, app routes or custom protocols.
  return /^(https?:\/\/|mailto:|#)/iu.test(url) ? defaultUrlTransform(url) : "";
}

export const ChatText = memo(function ChatText({ text, format = "markdown", streaming = false, lang = "zh-CN" }: ChatTextProps) {
  if (format === "plain") return <span className="chat-plain-text">{text}</span>;
  const labels = lang.startsWith("zh") ? LABELS["zh-CN"] : lang.startsWith("ja") ? LABELS.ja : lang.startsWith("ko") ? LABELS.ko : LABELS.en;
  const copyLabels = lang.startsWith("zh") ? COPY_LABELS["zh-CN"] : lang.startsWith("ja") ? COPY_LABELS.ja : lang.startsWith("ko") ? COPY_LABELS.ko : COPY_LABELS.en;
  const source = streaming ? remend(text, { katex: false, inlineKatex: false }) : text;
  return (
    <LabelsContext.Provider value={labels}>
      <CopyLabelsContext.Provider value={copyLabels}>
      <div className="chat-markdown">
        <Markdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS} urlTransform={chatUrl} skipHtml>{source}</Markdown>
      </div>
      </CopyLabelsContext.Provider>
    </LabelsContext.Provider>
  );
});
