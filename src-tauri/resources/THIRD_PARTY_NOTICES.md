# Third-party notices

## OpenCode (embedded native workbench)

- **Project**: OpenCode — https://github.com/anomalyco/opencode
- **License**: MIT License, Copyright (c) 2025 opencode (full text below)
- **Source revision embedded in this build**: commit `826d9ad46a22bef0294998e08daa3c4904fea28f` (tag `v1.18.21`)
- **Embedded component**: `packages/app` (the OpenCode web application), built from the pinned monorepo checkout with its own root `bun.lock` and `bun@1.3.14`. This build does not depend on the end user having any OpenCode development environment installed.

### Local modifications

Per the project's minimal-patch discipline, the embedded app is **not** modified in place. YUME adds only NEW files inside the pinned checkout (no existing upstream file is changed):

| Added file | Purpose |
| --- | --- |
| `packages/app/workbench/index.html` | Workbench page shell (entry script + theme-preload placeholder) |
| `packages/app/workbench/entry.tsx` | YUME platform adapter + Tauri bridge bootstrap (server connection, desktop platform implementation, directory routing) |
| `packages/app/vite.workbench.config.ts` | Vite config for the workbench bundle (`base: "./"`, theme-preload pre-order fix, separate output dir) |
| `packages/app/node_modules/ghostty-web/ghostty-vt.wasm` → staged into the bundle root by `scripts/prepare-workbench.ts` | Terminal renderer WASM kernel (not emitted by vite's asset pipeline; staged next to index.html so ghostty-web's loader finds it) |

The build pipeline for the embedded bundle is `scripts/prepare-workbench.ts` (see `docs/migrations/opencode-native/baseline.md` for the pinned commit, binary fingerprint, and build commands).

### OpenCode license

MIT License

Copyright (c) 2025 opencode

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## ghostty-web (terminal renderer)

- **Project**: ghostty-web — https://github.com/anomalyco/ghostty-web (pinned by the OpenCode lockfile)
- Bundled as a dependency of the OpenCode web app; see its repository for its license.

---

## Playwright MCP (optional isolated browser control)

- **Project**: Playwright MCP — https://github.com/microsoft/playwright-mcp
- **License**: Apache License 2.0 — https://www.apache.org/licenses/LICENSE-2.0
- **Pinned release**: `0.0.82`, commit `f1257a5a67aff872f947fae274759f7d54853862`
- **Use**: Optional local MCP server with an isolated, headless Microsoft Edge profile. YUME exposes only the pinned browser navigation, snapshot, form, click, wait, and close tools, each gated by native approval.

---

## Windows MCP Server (bundled optional Windows UI control)

- **Project**: Windows MCP Server — https://github.com/sbroenne/mcp-windows
- **License**: MIT License
- **Bundled release**: `1.3.24`, commit `b90485c3d1a228fc4f5341bc2bdfc7be7672c6d0`
- **Release archive SHA-256**: `4432e34ac4f7483f1e65e4b118b6995368c6d9c323cc50986200279b95dd903f`
- **Bundled executable SHA-256**: `6415d0a068280fdf3fdbab75904add3ee974422d56f49f17060da14f8b2f8fcb`

MIT License

Copyright (c) 2025 Sbroenne

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
