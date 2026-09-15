import { describe, expect, test } from "bun:test";
import type { ToolPart } from "../lib/opencode";
import { webSearchSites } from "./webSearchSites";

function completedPart(input: unknown, output: string): ToolPart {
  return {
    id: "part-websearch",
    sessionID: "session-websearch",
    messageID: "message-websearch",
    type: "tool",
    callID: "call-websearch",
    tool: "websearch",
    state: { status: "completed", input, output },
  };
}

describe("web search site extraction", () => {
  test("collects real domains in order and removes URL paths, www, and duplicates", () => {
    const sites = webSearchSites(
      completedPart(
        { query: "compare platform.openai.com/docs and https://anthropic.com/news" },
        "URL: https://developers.openai.com/api/docs/models\nURL: https://www.anthropic.com/research\nURL: https://github.com/openai/openai-node",
      ),
    );

    expect(sites).toEqual([
      "platform.openai.com",
      "anthropic.com",
      "developers.openai.com",
      "github.com",
    ]);
  });

  test("does not treat technology names or source and document paths as websites", () => {
    const sites = webSearchSites(
      completedPart(
        { query: "Node.js src/chat/ChatApp.tsx notes.md" },
        "Read src/chat/ChatApp.tsx and release-notes.md before visiting the documentation.",
      ),
    );

    expect(sites).toEqual([]);
  });

  test("keeps real absolute URLs even when their domain uses a language-like suffix", () => {
    const sites = webSearchSites(
      completedPart({}, "URL: https://docs.rs/serde/latest/serde/"),
    );

    expect(sites).toEqual(["docs.rs"]);
  });

  test("limits long result sets to eight unique sites", () => {
    const output = Array.from(
      { length: 10 },
      (_, index) => `URL: https://site${index}.example.com/result`,
    ).join("\n");

    expect(webSearchSites(completedPart({}, output))).toHaveLength(8);
  });
});
