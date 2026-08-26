import type { ReactNode } from "react";

const EMPHASIZED_TERMS = new Set(["著名", "小著"]);
const EMPHASIZED_TEXT_PATTERN = /(著名|小著)/gu;

interface ChatTextProps {
  readonly text: string;
}

export function ChatText({ text }: ChatTextProps): ReactNode {
  return text.split(EMPHASIZED_TEXT_PATTERN).map((part, index) =>
    EMPHASIZED_TERMS.has(part) ? (
      <strong className="chat-emphasis" key={`${part}-${index}`}>
        {part}
      </strong>
    ) : (
      part
    ),
  );
}
