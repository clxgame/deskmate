// @refresh reload

import {
  AppBaseProviders,
  AppInterface,
  type Platform,
  PlatformProvider,
  ServerConnection,
} from "@opencode-ai/app"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { createMemoryHistory, MemoryRouter, type BaseRouterProps } from "@solidjs/router"
import { onCleanup } from "solid-js"
import { render } from "solid-js/web"
import { loadInitialLocale } from "@/context/language"
import { createBrowserDraftStore } from "@/utils/draft-store"
import pkg from "../package.json"

declare global {
  interface Window {
    __TAURI__?: {
      core: {
        invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>
      }
    }
  }
}

type WorkbenchBootstrap = {
  url: string
  username?: string
  password?: string
  directory?: string
  sessionId?: string
}

const LAST_ACTIVE_URL_KEY = "yume.workbench.last-active-url"

const tauri = () => window.__TAURI__

async function bootstrap(): Promise<WorkbenchBootstrap> {
  const bridge = tauri()
  if (bridge) return bridge.core.invoke<WorkbenchBootstrap>("workbench_connection")
  const url = import.meta.env.VITE_YUME_SIDECAR_URL
  if (typeof url === "string" && url) return { url }
  throw new Error("yume workbench: no sidecar connection (window.__TAURI__ missing and VITE_YUME_SIDECAR_URL unset)")
}

// The host creates this window at app start, while the managed sidecar may
// still be booting; wait for a real health answer before mounting the app so
// the first paint is not the error boundary. A timeout still renders and lets
// the app's own connection gate surface the failure.
async function waitForServer(connection: WorkbenchBootstrap, timeoutMs = 15_000) {
  const headers = connection.password
    ? { Authorization: `Basic ${btoa(`${connection.username ?? "opencode"}:${connection.password}`)}` }
    : undefined
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${connection.url}/global/health`, { headers })
      if (res.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}

function getLastActiveUrl() {
  if (typeof localStorage !== "object") return "/"
  try {
    const value = localStorage.getItem(LAST_ACTIVE_URL_KEY)
    if (value?.startsWith("/") && !value.startsWith("//")) return value
  } catch {}
  return "/"
}

function setLastActiveUrl(value: string) {
  if (typeof localStorage !== "object") return
  try {
    localStorage.setItem(LAST_ACTIVE_URL_KEY, value)
  } catch {}
}

// The memory history lives at module scope so the handoff listener (host →
// this window) can navigate the already-loaded page in place, without a full
// reload and without re-running bootstrap (§8.1).
let activeHistory: ReturnType<typeof createMemoryHistory> | undefined
let syncWorkbenchOwnership: ((url: string) => void) | undefined

function WorkbenchMemoryRouter(props: BaseRouterProps & { initialUrl: string }) {
  const history = createMemoryHistory()
  activeHistory = history
  if (props.initialUrl !== "/") history.set({ value: props.initialUrl, replace: true, scroll: false })
  onCleanup(
    history.listen((value) => {
      setLastActiveUrl(value)
      syncWorkbenchOwnership?.(value)
    }),
  )
  return <MemoryRouter {...props} history={history} />
}

function sessionIdFromUrl(value: string) {
  const segments = value.split("/").filter(Boolean)
  const marker = segments.lastIndexOf("session")
  const encoded = marker >= 0 ? segments[marker + 1] : undefined
  if (!encoded) return undefined
  try {
    return decodeURIComponent(encoded)
  } catch {
    return undefined
  }
}

const notify: Platform["notify"] = async (title, description, onClick) => {
  if (!("Notification" in window)) return

  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission().catch(() => "denied")
      : Notification.permission

  if (permission !== "granted") return

  const inView = document.visibilityState === "visible" && document.hasFocus()
  if (inView) return

  const notification = new Notification(title, {
    body: description ?? "",
    icon: "https://opencode.ai/favicon-96x96-v3.png",
  })

  notification.onclick = () => {
    window.focus()
    onClick?.()
    notification.close()
  }
}

async function main() {
  const connection = await bootstrap()
  const localePromise = loadInitialLocale()
  await waitForServer(connection)
  const locale = await localePromise
  const bridge = tauri()

  const attachmentPaths = new WeakMap<File, string>()
  const os = (() => {
    const ua = navigator.userAgent
    if (ua.includes("Mac")) return "macos" as const
    if (ua.includes("Windows")) return "windows" as const
    if (ua.includes("Linux")) return "linux" as const
    return undefined
  })()

  const platform: Platform = {
    platform: "desktop",
    os,
    version: pkg.version,
    draftStore: createBrowserDraftStore(),
    getDefaultServer: async () => ServerConnection.Key.make("sidecar"),
    setDefaultServer: () => {},
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      const match = request.method === "POST" ? /^\/session\/([^/]+)\/abort$/.exec(url.pathname) : null
      const sessionId = match?.[1]
      if (bridge && sessionId) {
        try {
          await bridge.core.invoke("workbench_abort_session", { sessionId: decodeURIComponent(sessionId) })
          return Response.json(true)
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          return Response.json({ error: message }, { status: 409 })
        }
      }
      const response = await fetch(input, init)
      if (bridge && request.method === "POST" && url.pathname === "/session" && response.ok) {
        const session = await response.clone().json().catch(() => null)
        const createdSessionId = session && typeof session === "object" && "id" in session
          ? String(session.id)
          : ""
        if (createdSessionId) {
          await bridge.core.invoke("history_register_native_session", {
            sessionId: createdSessionId,
            source: "workbench",
          }).catch(() => undefined)
        }
      }
      return response
    },
    openExternal: (url) => {
      if (!bridge) {
        window.open(url, "_blank", "noopener,noreferrer")
        return
      }
      void bridge.core.invoke("workbench_open_external", { url })
    },
    openPath: async (path) => {
      if (bridge) await bridge.core.invoke("workbench_open_path", { path })
    },
    openLocalFile: (url) => {
      if (bridge) void bridge.core.invoke("workbench_open_path", { path: url })
    },
    revealPath: async (path) => {
      if (!bridge) return false
      return bridge.core.invoke<boolean>("workbench_reveal_path", { path })
    },
    openDirectoryPickerDialog: async (opts) => {
      if (!bridge) return null
      const paths = await bridge.core.invoke<string[]>("workbench_pick_directory", { title: opts?.title })
      if (paths.length === 0) return null
      return opts?.multiple ? paths : paths[0]
    },
    openAttachmentPickerDialog: async (opts, onFile) => {
      if (!bridge) return
      const picked = await bridge.core.invoke<Array<{ name: string; path: string; size: number }>>(
        "workbench_pick_files",
        { title: opts?.title, extensions: opts?.extensions },
      )
      for (const item of picked) {
        const b64 = await bridge.core.invoke<string>("workbench_read_file", { path: item.path })
        const bytes = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0))
        const file = new File([bytes], item.name)
        attachmentPaths.set(file, item.path)
        await onFile(file)
      }
    },
    getPathForFile: (file) => attachmentPaths.get(file) ?? "",
    saveFilePickerDialog: async (opts) => {
      if (!bridge) return null
      return bridge.core.invoke<string | null>("workbench_save_file", {
        title: opts?.title,
        defaultPath: opts?.defaultPath,
      })
    },
    notify,
    restart: async () => window.location.reload(),
    // WebView2 delivers clipboard images through paste events; no host fallback.
    readClipboardImage: async () => null,
  }

  // Credentials live only for the lifetime of this page and are never persisted.
  const http: ServerConnection.HttpBase = {
    url: connection.url,
    ...(connection.username ? { username: connection.username } : {}),
    ...(connection.password ? { password: connection.password } : {}),
  }

  const server: ServerConnection.Any = {
    displayName: "YUME",
    type: "sidecar",
    variant: "base",
    http,
  }

  // The default server key must equal ServerConnection.key(our connection):
  // for sidecar connections that is the literal "sidecar", not the URL —
  // key-based lookups (permission context, scoped state) miss otherwise.
  const defaultServer = ServerConnection.Key.make("sidecar")

  // Route priority: an explicit session handoff (light chat → workbench) wins
  // over the directory draft, which wins over the last-visited route (§8.1).
  const initialUrl = connection.sessionId
    ? `/server/${base64Encode("sidecar")}/session/${connection.sessionId}`
    : connection.directory
      ? `/${base64Encode(connection.directory)}/session`
      : getLastActiveUrl()
  const router = (props: BaseRouterProps) => <WorkbenchMemoryRouter {...props} initialUrl={initialUrl} />

  if (bridge) {
    let routedSessionId = sessionIdFromUrl(initialUrl)
    let ownedSessionId: string | undefined
    let ownershipQueue = Promise.resolve()

    const reconcileOwnership = () => {
      ownershipQueue = ownershipQueue.then(async () => {
        const next = document.visibilityState === "visible" ? routedSessionId : undefined
        if (ownedSessionId === next) return
        const previous = ownedSessionId
        ownedSessionId = undefined
        if (previous) {
          await bridge.core.invoke("workbench_release_session", { sessionId: previous }).catch(() => undefined)
        }
        if (!next) return
        await bridge.core.invoke("workbench_claim_session", { sessionId: next })
        if (document.visibilityState === "visible" && routedSessionId === next) {
          ownedSessionId = next
          return
        }
        await bridge.core.invoke("workbench_release_session", { sessionId: next }).catch(() => undefined)
      }).catch(() => undefined)
    }

    syncWorkbenchOwnership = (url) => {
      routedSessionId = sessionIdFromUrl(url)
      reconcileOwnership()
    }
    syncWorkbenchOwnership(initialUrl)

    const heartbeat = window.setInterval(() => {
      const sessionId = ownedSessionId
      if (!sessionId || document.visibilityState !== "visible") return
      void bridge.core.invoke<boolean>("workbench_heartbeat", { sessionId }).then((alive) => {
        if (alive) return
        ownedSessionId = undefined
        reconcileOwnership()
      }).catch(() => undefined)
    }, 2_000)

    document.addEventListener("visibilitychange", reconcileOwnership)
    window.addEventListener("pagehide", () => {
      window.clearInterval(heartbeat)
      const sessionId = ownedSessionId
      ownedSessionId = undefined
      if (sessionId) void bridge.core.invoke("workbench_release_session", { sessionId }).catch(() => undefined)
    })
  }

  // In-place navigation for session handoffs after the page has already
  // bootstrapped (host emits `workbench://handoff` from the light chat / pet;
  // the same pending value is also honored on fresh bootstraps via
  // connection.sessionId above).
  if (bridge) {
    void bridge.event.listen<string>("workbench://handoff", (event) => {
      const sessionId = event.payload
      if (!sessionId || !activeHistory) return
      activeHistory.set({ value: `/server/${base64Encode("sidecar")}/session/${sessionId}`, replace: false })
    })
  }

  const root = document.getElementById("root")
  if (!(root instanceof HTMLElement)) throw new Error("yume workbench: #root element missing")

  render(
    () => (
      <PlatformProvider value={platform}>
        <AppBaseProviders locale={locale}>
          <AppInterface defaultServer={defaultServer} servers={[server]} router={router} />
        </AppBaseProviders>
      </PlatformProvider>
    ),
    root,
  )
}

void main()
