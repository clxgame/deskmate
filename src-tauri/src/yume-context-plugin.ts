/**
 * YUME managed context injector (host-written; do not edit by hand).
 *
 * Loaded by the managed OpenCode sidecar through OPENCODE_CONFIG_CONTENT's
 * `plugin` field. On every model request it reads the host-written context
 * file (path from YUME_CONTEXT_FILE) and appends the YUME persona/memory block
 * as a separate system entry — unless the request already carries it
 * (fingerprint present in the head system entry, meaning the host's own send
 * path injected it) or the request belongs to an excluded flow (reports).
 *
 * The file is re-read on every hook call so persona/memory updates apply
 * without a sidecar restart.
 */

type ContextFile = {
  version: number
  block: string
  fingerprint: string
  excludeSessions: string[]
  skipWhenHeadIncludes: string[]
}

const contextPath = process.env.YUME_CONTEXT_FILE

async function readContext(): Promise<ContextFile | undefined> {
  if (!contextPath) return undefined
  try {
    const value: unknown = await Bun.file(contextPath).json()
    if (typeof value !== "object" || value === null) return undefined
    return value as ContextFile
  } catch {
    return undefined
  }
}

export default {
  id: "yume-context",
  server: async () => ({
    "experimental.chat.system.transform": async (
      input: { sessionID?: string },
      output: { system: string[] },
    ) => {
      const context = await readContext()
      if (!context?.block || !context.fingerprint) return
      // Only inject into real conversation sessions. A missing sessionID means
      // a non-conversation call (e.g. internal/utility invocations); excluded
      // sessions (registered report runs) never get the companion block (§8.2).
      if (!input.sessionID) return
      if (context.excludeSessions?.includes(input.sessionID)) return
      const head = output.system[0] ?? ""
      if (context.skipWhenHeadIncludes?.some((marker) => marker && head.includes(marker))) return
      if (head.includes(context.fingerprint)) return
      output.system.push(context.block)
    },
  }),
}
