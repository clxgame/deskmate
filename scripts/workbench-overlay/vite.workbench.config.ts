import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import appPlugin from "./vite"

// Yume workbench entry: a second, self-contained build of the OpenCode web app
// meant to be embedded in a Tauri WebView2 window and served from a /workbench/
// subpath, hence base "./" so every emitted asset URL is relative.
//
// With base "./" Vite rebases absolute public URLs ("/oc-theme-preload.js" ->
// "./oc-theme-preload.js") during build-html processing, which runs BEFORE
// normal-order transformIndexHtml hooks. The appPlugin theme-preload replacement
// matches the absolute-URL tag byte-for-byte, so it must run as an ordered pre
// hook (on the raw html) or it silently misses. Plugin-level "enforce" does not
// affect transformIndexHtml ordering, so wrap the hook itself. The replacement
// logic stays in ./vite.
const plugins = appPlugin.map((plugin) => {
  if (!plugin || plugin.name !== "opencode-desktop:theme-preload") return plugin
  if (typeof plugin.transformIndexHtml !== "function") return plugin
  return { ...plugin, transformIndexHtml: { order: "pre" as const, handler: plugin.transformIndexHtml } }
})

export default defineConfig({
  plugins: [plugins],
  root: "workbench",
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  base: "./",
  build: {
    target: "esnext",
    sourcemap: true,
    outDir: fileURLToPath(new URL("./workbench-dist", import.meta.url)),
    emptyOutDir: true,
  },
})
