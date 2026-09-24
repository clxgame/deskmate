# P0 基线：源码、二进制、版本组合、现存问题

记录时间：2026-09-22 · 施工 Agent：Sisyphus（Kimi K3）
基线原则：每条运行证据都记录源码/二进制/配置标识，不跨版本比较结果。

## 1. 仓库状态

| 项 | 值 |
| --- | --- |
| 仓库路径 | `E:/Codex/工作伙伴/deskmate-public-release` |
| HEAD（本地基线） | `6fd1077f3893e91a73ae71eb7792eded44b76026`（`chore(release): bump version to 0.4.3`） |
| ⚠️ 上游分歧（2026-09-22 15:45 发现） | 本地基线落后 `origin/main` **11 个提交**：远端已到 **v0.4.8**（`82d7c13`，含 0.4.4/0.4.6/0.4.7/0.4.8 发布与 frosted-surface UI、updater、settings P0 布局等改动）。本地工作树含并行任务 + 本任务的未提交修改，**不执行 pull/merge/rebase**；P1 验证仍以本地 0.4.3 基线运行（构建回执含全部源文件哈希，可追溯）。后续合并窗口由用户决定。 |
| 应用版本 | 本地 0.4.3（package.json / tauri.conf.json 一致）；QA 配置的 0.3.1 写死版本已删除，改为继承基础配置 |
| 未提交修改 | 22 个已修改文件 + 13 个新增未跟踪路径，属于并行 agent-hang 修复任务（清单见 progress.md），本次只读核对、不触碰 |
| 仓库规则文件 | 根目录无 AGENTS.md；约束来源：README.md、docs/AGENT_HARNESS_ROADMAP_AUDIT.md、施工 Prompt、各 QA 目录 README |
| 既有相关计划 | `.omo/plans/` 24 份历史计划（无本迁移计划）；`docs/` 无 migrations/ 目录，故本记录集采用 `docs/migrations/opencode-native/` |

## 2. 版本组合与二进制指纹

| 组件 | 版本/值 | 证据 |
| --- | --- | --- |
| YUME 应用 | 0.4.3 | package.json:4、tauri.conf.json:4 |
| opencode-ai（npm） | 1.18.21（devDependency 精确固定） | package.json:46 |
| opencode-ai lockfile | `opencode-ai@1.18.21`，integrity `sha512-BxQyxpD0y2X0sXJUKLOooXVmi9QIoeKPtdH68r7QRiqXJ/YulK1MQvSe8KyA8183zoPV0G6JAtgz1OqmE3OGUw==` | bun.lock:959 |
| 平台二进制包 | 12 个 `opencode-<os>-<arch>[-baseline][-musl]@1.18.21`，各自 sha512 锁定 | bun.lock:961–983 |
| 安装清单 | node_modules/opencode-ai/package.json version=1.18.21，bin=`bin/opencode.exe` | 直接读取 |
| 实际打包二进制 | `src-tauri/resources/opencode/opencode.exe`，179,463,208 字节 | Test-Path/Get-Item |
| 二进制 SHA-256 | `EA4F4D4BEC95CD41BAF0FC53ADC4E34B31E1C8676DC5B2507C8797AB1884AF18` | Get-FileHash |
| 二进制自报版本 | `1.18.21`（`opencode.exe --version` 实际执行输出） | 2026-09-22 本机执行 |
| 二进制来源链 | `node_modules/opencode-ai/bin/opencode.exe`（或平台包 bin）→ 复制到 `src-tauri/resources/opencode/` | scripts/prepare-opencode.ts |
| 二进制完整性机制 | opencode 侧：bun.lock sha512 + prepare 脚本核对 installed manifest version == package.json 固定值，并做 PE/MZ 头与机器架构校验；README 所述"pinned SHA-256 下载校验"实际指 ncmdump | prepare-opencode.ts:110–135（注：该文件当前有并行任务的未提交修改，此结论基于当前工作树内容） |
| 上游仓库 | `https://github.com/anomalyco/opencode`（非 fork；旧 `sst/opencode` 由 GitHub 解析到同一仓库；默认分支 dev） | GitHub API /repos/anomalyco/opencode、/repos/sst/opencode |
| 上游 release/tag | `v1.18.21`，npm 1.18.21 发布于 2026-08-21T14:51:28Z，tarball integrity 与 bun.lock sha512 一致 | registry.npmjs.org/opencode-ai/1.18.21 |
| 上游提交（固定基线） | `826d9ad46a22bef0294998e08daa3c4904fea28f`（commit 标题 `release: v1.18.21`，tag 直接指向该提交） | api.github.com/.../git/ref/tags/v1.18.21 |
| app 包 | `@opencode-ai/app@1.18.21`，SolidJS + Vite，`bun --cwd packages/app build` 产出静态资源；**workspace 私有包，npm 上不存在**，必须从 monorepo 固定提交源码构建 | packages/app/package.json@826d9ad |
| SDK 包 | `@opencode-ai/sdk@1.18.21`，路径 `packages/sdk/js`（注意不是 packages/sdk 根） | packages/sdk/js/package.json@826d9ad |
| 插件包 | `@opencode-ai/plugin@1.18.21`，路径 `packages/plugin` | packages/plugin/package.json@826d9ad |
| monorepo 锁文件 | 根 `bun.lock`，`packageManager: bun@1.3.14`；构建必须整仓克隆后用根锁文件 | 根 package.json@826d9ad |
| 人设注入钩子 | **`experimental.chat.system.transform` 在该固定提交存在**：input `{sessionID?, model}`，output `{system: string[]}` 可原地修改；另有机会用到 `experimental.chat.messages.transform`、`experimental.session.compacting` 等约 20 个钩子 | packages/plugin/src/index.ts L291–296；调用点 packages/opencode/src/session/llm/request.ts L60–73 |
| app 运行时连接 | 平台适配层 `packages/app/src/context/platform.tsx`：Platform 接口含 `getDefaultServer/setDefaultServer/fetch/openExternal/restart/notify/目录选择` 等；经 `ServerConnection`/`ServerSDKProvider` 创建 SDK 客户端并维持事件流重连；无 URL query 参数式配置 | platform.tsx、server-sdk.tsx@826d9ad |

## 3. 构建与验证命令（规划时存在，尚未由本任务执行）

```powershell
bun run typecheck        # tsc --noEmit && tsc --noEmit -p tsconfig.test.json
bun test                 # bun test
bun run build            # tsc --noEmit && vite build
cargo test --manifest-path src-tauri/Cargo.toml
bun run prepare:sidecar  # prepare-opencode.ts + prepare-ncmdump.ts
```

注意：`src-tauri/tauri.conf.json` 的 beforeDev/beforeBuild 钩子会自动跑 `prepare:sidecar`。QA 入口：`scripts/agent-qa/`、`scripts/worklog-qa/run.js`（preflight/build/provider/launch/status/stop，provider 独立进程，端口以 receipt 为准）。并行任务的最后测试输出在 `.tmp/final-*.log`（2026-09-22 11:28），本任务未复跑。

## 4. 运行时基线（来自 sidecar.log 2026-09-21 15:05 实际运行）

| 事实 | 证据 |
| --- | --- |
| sidecar 以 `opencode server` 形态运行，监听随机端口 `http://127.0.0.1:62994` | sidecar.log:5 |
| **服务无鉴权**：`Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.` | sidecar.log:1 |
| 隔离 HOME：`opencode-home/`（xdg-config / xdg-data / xdg-cache / .local/state / AppData/*） | 目录调查 + log 加载路径 |
| 全局配置 `opencode-home/xdg-config/opencode/opencode.jsonc` 仅 50 B：`{"$schema": ...}`，无实质配置；config.json / opencode.json 不存在（加载按此顺序尝试） | 直接读取 + sidecar.log:2–4 |
| 项目级配置：每个工作目录可有 `.opencode/opencode.json[c]`（workspace 目录下存在） | sidecar.log:15,19 |
| 同一进程内创建两个 project instance：`workspace/` 与 `scheduled-agent-workspace/`（目录作用域会话） | sidecar.log:6–9 |
| `all LSPs are disabled` / `all formatters are disabled`（--pure 或等效配置的效果，待 lib.rs 核对确认具体机制） | sidecar.log:16–17,20–21 |
| 会话创建事件含 `version=1.18.21 projectID=global title="YUME chat"` | sidecar.log:24 |
| 原生数据库：`opencode-home/xdg-data/opencode/opencode.db`（SQLite，9,179,136 B + 4,161,232 B WAL）；同级有 `log/`、`repos/`、`tool-output/` | 目录调查（仅结构） |

## 5. 数据目录现状（`%APPDATA%\com.deskmate.desktop`，仅结构/统计，未读取私人内容）

| 路径 | 归属（初步） | 大小/备注 |
| --- | --- | --- |
| `deskmate-memory.db(+shm/wal)` | YUME Memory | 114,688 B；README 声明硬删除语义 |
| `history.json` | YUME 旧文本历史（文本投影，完成回合全量重写） | 99,949 B（审计 [E14]） |
| `settings.json` | YUME 设置 | 1,775 B |
| `yume-worklog.db(+shm/wal)` | YUME Worklog/报表 | 4,096 B + 494,432 B WAL |
| `sidecar.log` | 宿主 sidecar 日志 | 4,049 B |
| `opencode-home/` | 受管 OpenCode 隔离 HOME（含原生 opencode.db） | 见 §4 |
| `agent-runs/` | 宿主 run 记录（record_store，schema 待核对） | 目录 |
| `workspace/` | sidecar 固定工作目录；含 `.opencode/tools`（内置工具安装处）、`.codegraph`、`.omo` | 审计 [E9][E19] + 目录调查 |
| `scheduled-agent-workspace/` | 定时任务工作目录（独立 project instance） | 目录 |
| `packs/`（aki/baobao/xiaoxiongchong） | 用户导入角色包 | asset protocol 作用域限于此 |
| `personas/`（25 个内置角色目录） | 内置角色资产 | 目录 |
| `skills/`（xiaozhu 三代） | 角色技能文本 | 目录 |
| `model-catalogs/`、`ccswitch-recovery/`、`worklog-ipc/` | 模型目录缓存 / ccswitch 恢复 / worklog IPC | 目录 |

## 6. 源码表核对（施工 Prompt §2）— 已完成

核对时间 2026-09-22，基于当前工作树（含并行任务未提交修改）。状态含义：✅确认 / 🔀有变化（说明现状）/ 🆕该行为并行任务新增文件。

| 行 | 状态 | 当前事实 |
| --- | --- | --- |
| `package.json`/`bun.lock` 固定版本、未直接依赖 SDK | ✅ | `opencode-ai: 1.18.21` 精确固定（devDependencies，即 sidecar 二进制包）；无 `@opencode-ai/sdk` 依赖，`src/` 无任何 opencode-ai/SDK import |
| `tauri.conf.json` 三窗口、无工作台窗口 | ✅ | pet/chat/settings 三窗口；CSP connect-src 已含 `http://127.0.0.1:*`；resources 含 `resources/opencode/**/*` |
| `capabilities/default.json` | ✅ | 现有权限面向 pet/chat/settings，无工作台 capability（P2 需新增独立最小 capability） |
| `lib.rs` 启动受管 sidecar、隔离目录与 `--pure`、可重启共享服务 | ✅（有未提交修改） | `spawn_sidecar()`→`configure_sidecar_command()`：`<opencode> --pure serve --port <p> --hostname 127.0.0.1 --cors http://tauri.localhost --cors tauri://localhost --print-logs`，cwd=`<appData>/workspace`；`configure_sidecar_environment()` 隔离 HOME/USERPROFILE/APPDATA/LOCALAPPDATA/XDG 三目录到 `opencode-home/`，设 `OPENCODE_ENABLE_EXA=1`、移除继承的 OpenCode/auth/search 凭证，有 provider 时注入 `OPENCODE_CONFIG_CONTENT`+`OPENCODE_AUTH_CONTENT`；`restart_sidecar()` 杀子进程同端口重启（lib.rs:1014–1153） |
| `src/lib/opencode.ts` 手写 HTTP/事件客户端 | 🔀 | 确认手写（248 行：createSession/getSessionMessages/promptAsync/abortSession/subscribeEvents EventSource）；但文件头注释仍写 "v1.17.x"，与实际固定 1.18.21 不符——注释过期 |
| `ChatApp.tsx` 普通聊天与 Agent 历史并存、取消先更新 UI | ✅ | `send()` 按 agent 状态路由；`view === "history"` 切换 HistoryPanel；`abort()` 乐观更新 UI 后才 await `abortSession().catch()` |
| `useAgentRun.ts`/`useAgentHistoryView.ts` 宿主运行状态与历史轮询 | ✅ | 均为 1000ms 轮询（run 投影、pendingAgentPermissions、持久化历史），存在重复状态推导 |
| `agent/opencode.rs` 宿主另有原生客户端 | ✅（有未提交修改） | `OpenCodeClient`：`/global/health`、`POST /session`、`prompt_async`、`abort`、`GET /session/{id}/message`；workspace 端点带 `directory=` query；建会话时下发每会话权限（read/glob/grep/list/write/edit/patch/bash=ask，webfetch/websearch=deny） |
| `permission_policy.rs` 拦截部分能力 | ✅（语义更强） | `decision_with_approvals()`：读类仅限 workspace 内路径；写类需 workspace 安全路径且默认 Ask；shell 恒 Ask 且需命令元数据；webfetch/websearch Ask；`external_directory`/`question`/`task`/`doom_loop`/未知权限一律拒绝；命中已存批准则 Ask→AllowOnce |
| `settings.rs`/`tool_permissions.rs` 多层工具限制 | 🔀 层数比表述更多 | 六层：①sidecar 全局基线（`*`=deny + CONTROLLED_TOOLS=ask + DENIED 列表）；②会话级 OpenCode 权限数组；③持久化 YUME `tool_permissions` 模式（worklog_read/write、web、shell，未知 ID 默认 Deny）；④宿主 run/workspace 策略（workspace 包含性校验）；⑤记忆批准（workspace+permission+pattern）；⑥scoped 传输（/permission 带 directory 参数）。优先级为 restrictive-first。报表会话另有独立 deny-all |
| `opencode_settlement.rs`/`supervision.rs` abort、状态修补、故障重启 | 🆕✅ | 并行任务新增。settlement：`is_busy()`（GET /session/status）、`settle_tools()` 先 abort 确认、再等 not-busy、将 run 下仍 pending/running 的 tool part PATCH 为 error；supervision：in-flight 检测、idle/lost/timeout 监督、`stop_owned_process_tree()`、settlement 失败时才重启 sidecar 并重试 |
| `record_store.rs` 保存 run/session/工作区关联 | ✅ | `RunRecord`（run_id/session_id?/workspace_path/起止/outcome/pending/message-part-call 关联/initial_input）原子写入 `<appData>/agent-runs/<run_id>.json`（JSON 文件，非数据库） |
| `history.rs`/archive/recovery 旧历史文本、删除恢复 | 🔀 | 仍为 `<appData>/history.json` 文本投影，但已新增 `origin_run_id`、`deleted` 墓碑、renderer-owned 与 agent-owned 区分（agent-owned 拒绝编辑、删除走墓碑）；archive 幂等按 message/part ID upsert 文本；recovery 可按 RunRecord 关联从受管服务懒加载快照 |
| `run_commands.rs`/`packs/runtime.rs` 旧发送链路组装人设/技能/记忆 | 🔀（位置更精确） | 注入组装在 `agent_run_start()` 的 `prepared` 闭包（run_commands.rs:40–75）：`packs::persona_files()` 取 persona+placeholders+skills，`memory::retrieval::context_for_turn()` 取记忆块，拼接为 `system` 传给 `client.prompt()` |
| `worklog/runner_runtime.rs`/`model_client.rs` 报表共享受管服务、受限权限 | ✅ | `DesktopEnvironment::endpoint()` 取当前 sidecar 端口/PID（epoch 检测替换）；报表会话 `permission:[{"permission":"*","pattern":"*","action":"deny"}]` 且 generate() 显式禁用全部工具——比普通会话更严 |
| `scripts/agent-qa/`、`tool_lifecycle_live_tests.rs` 真实二进制与工具生命周期 QA | ✅（环境变量名需更正） | agent-qa 入口：`tool-lifecycle.ts`（顶层可执行）、`runtime.ts`（harness，用 `findSourceBinary()` 找真实二进制、要求 1.18.21）、`contract.ts`、`lifecycle.ts`；环境变量 `YUME_AGENT_TEST_BINARY`（tool-lifecycle.ts 用它拉起 Rust 测试二进制）与 `AGENT_QA_OMIT_TRUSTED`。Rust 侧 `tool_lifecycle_live_tests.rs`（🆕）要求 `YUME_AGENT_TEST_BASE`/`YUME_AGENT_TEST_WORKSPACE`（+孤儿场景两个变量），`#[ignore]`。**施工 Prompt 提到的 `YUME_AGENT_TEST_BINARY` 在 agent-qa 脚本侧使用，Rust live 测试本身用 BASE/WORKSPACE** |
| `scripts/worklog-qa/README.md` 隔离 QA | ✅ | 命令序列与施工 Prompt §12 一致（preflight/build/provider/launch -FixtureBaseUrl/status/stop）；launch 拒绝陈旧构建/生产身份/非回环 fixture/未拥有的既有数据/存活的前序 QA 进程/reparse-point 数据根；stop 只杀记录的子进程；provider 独立前台进程、按句柄终止；另有 purge、verify-report.js、readback.js |
| `petActivity.ts` 由消息与状态驱动桌宠 | ✅ | 消费 start/cancel/success/error/sessionError/idle/mood + message/part 事件；文本 part→talking，工具 part→working，按 session/request 归属判定终态 |

## 7. 现存问题与已知风险（基线时刻）

| 问题 | 来源 | 对迁移的影响 |
| --- | --- | --- |
| 另一任务正在修复 agent tool hang（ses_f3c975e80 有两个 running bash 调用无结果，/permission=[]、/session/status={}） | .debug-journal.md | 取消/权限语义基线可能被并行修改；P1 取消验收前需确认该任务结论 |
| 受管服务无鉴权（OPENCODE_SERVER_PASSWORD 未设置） | sidecar.log:1 | 施工 Prompt §3.3 要求凭证由宿主管理并证明 HTTP/事件流/WS 三通道认证；这是必须补齐的缺口 |
| 消息契约风险：前端 getSessionMessages 用扁平 `{id, role, parts}`，Rust 报表客户端解析 `{info, parts}`，官方文档为后者；未经真实 sidecar 确认 | 审计 [E20][E21][O1] | P1/P3 会话接续与恢复必须对固定版本真实响应做契约检查 |
| 1.18.21 权限列表编码问题存在 SSE 回退兼容（tool_permissions/events.rs:88） | 审计 [E15] | 统一原生授权时不能误删该回退 |
| 当前策略默认 deny，显式禁用 edit/write/patch/external_directory/task | 审计 [E4] | "完整原生能力"需要按固定版本真实规则恢复，而非 allow-all（§3.4） |
| LSP/formatter 全禁用、全局配置为空 | sidecar.log | P3 恢复插件/MCP/技能加载前需查明 --pure 与隔离环境真实影响 |
| 固定版本原生 UI 可嵌入性、取消保证、人设扩展接口、历史完整度、桌面工具兼容性均未实测 | 施工 Prompt §2 末 | P0 能力矩阵必须标注"未验证"，P1 验证 |

## 8. 未知项清单（P0 通过条件要求明确列出）

已解决（2026-09-22）：

- [x] npm 1.18.21 对应上游 commit：anomalyco/opencode @ `826d9ad46a22bef0294998e08daa3c4904fea28f`（tag v1.18.21），npm integrity 与 bun.lock 一致
- [x] packages/app 构建方式：SolidJS+Vite，`bun --cwd packages/app build`，静态产物；workspace 私有，必须整仓固定提交构建
- [x] SDK/plugin 对应版本：`@opencode-ai/sdk@1.18.21`（packages/sdk/js）、`@opencode-ai/plugin@1.18.21`（packages/plugin），根 bun.lock + bun@1.3.14
- [x] `experimental.chat.system.transform` 钩子在固定提交存在（input sessionID?/model，output system[] 可变）
- [x] app 运行时连接方式：Platform 适配层（getDefaultServer/setDefaultServer/fetch/...）+ ServerConnection/ServerSDKProvider

仍未知（影响路线者标 ⚠️，进入 P1 前需闭合或显式接受）：

- [x] ⚠️→已解决 Web 应用能力面：capabilities.md §1 逐项核实（25 项能力中 22 项 ✅、插件管理与技能/agent 编写 ⚠️ 属原生功能边界、PTY 终端走 WebSocket）
- [x] ⚠️→已解决 CLI/TUI 独有能力：capabilities.md §5 逐项给出 Yume 入口或明确不支持理由
- [x] ⚠️→已解决 传输与鉴权：HTTP + SSE(/event) + PTY WebSocket 三通道；Basic 鉴权（OPENCODE_SERVER_PASSWORD），app 从 ServerConnection 发凭证、自身不读环境变量（capabilities.md §3）
- [x] ⚠️→已解决 serve 完整性：`serve` 与 `web` 同一 Server/OpenCodeHttpApi，根 API 含全部路由分组；当前 sidecar 形态 API 面兼容；目录路由中间件存在（app 侧 header vs Yume 现有 query 参数的差异需 P1 实测对齐）
- [ ] 未经修改的官方 Web 应用行为基准运行记录（属 P1 任务 1 的构建后验证，P0 只做来源与构建方式确认——不阻塞 P0 放行）
- [ ] 并行 agent-hang 任务的最终结论（其取消/settlement 改动影响 P1 取消验收基线；P1 取消门槛实验前必须读取该任务结论——P1 内部前置，不阻塞 P0 放行）

**阻塞判定**：影响路线的未知项（app 可构建性、连接机制、注入钩子、serve 兼容、传输/鉴权机制）已全部闭合且支持既定路线。剩余两项为 P1 内部任务/前置，不构成 P0 放行障碍。

## 9. P6 本地 Windows 候选构建指纹（2026-09-23）

- 上游固定源：[`anomalyco/opencode@826d9ad46a22bef0294998e08daa3c4904fea28f`](https://github.com/anomalyco/opencode/tree/826d9ad46a22bef0294998e08daa3c4904fea28f)，tag `v1.18.21`；本地克隆 HEAD 核对为该提交，既有上游文件零修改，叠加仍限新增 `packages/app/workbench/index.html`、`entry.tsx`、`vite.workbench.config.ts` 和构建输出。上游 `bun.lock` SHA-256 `334AC7FB44E967944973C979ECAA218ACA96FD19028EAB36A89EA3F2BCBA1029`，Bun 1.3.14、Rust 1.94.1。
- `src-tauri/tauri.conf.json` 和 QA overlay 的 `beforeBuildCommand` 现均包含 `bun run prepare:workbench`；每次 NSIS 构建重新生成工作台，避免从旧的 ignored `public/workbench/` 打包。完整生产链为 `prepare:workbench && prepare:sidecar && build`，QA 链为 `prepare:workbench && build`；QA 编译需同时带 `--features worklog-qa` 与 overlay，只有 overlay 不构成数据/密钥隔离。
- 生产身份仅构建未安装：`bun run tauri build -- --no-sign`，`YUME_0.4.3_x64-setup.exe` SHA-256 `CBDB3755BD044270015A83501F96C8ADE83BF91F5A0DDC7007775978E20DB387`，176,946,272 B。
- 隔离身份构建并安装：`bun run tauri build -- --features worklog-qa --config scripts/worklog-qa/tauri.qa.conf.json --bundles nsis --no-sign`，`YUME Worklog QA_0.4.3_x64-setup.exe` SHA-256 `A3D31B9058FD53B7F6FE98E261811383E60AA99FF8A60A652EF27AAB1C51D30F`，176,945,386 B。安装位置仅 `artifacts/opencode-native/p6-qa-install/current/`，与生产 `YUME` v0.4.8 身份和路径分离。
- 工作台静态指纹：`dist/workbench/index.html` SHA-256 `217880BC800DEDDE45AB24E6535283E21DDA5C681A19B2DB13E7E36B94A51AE3`；`ghostty-vt.wasm` 967,563 B，SHA-256 `B9579E2993A3FC6EDDE73121141AD6B2EAA94BDC3E43D46FD496177D12E503AF`。两者是嵌入的 frontend 资源，安装后 WebView 已实测加载工作台。安装版 sidecar `--version` 为 1.18.21、SHA-256 `EA4F4D4BEC95CD41BAF0FC53ADC4E34B31E1C8676DC5B2507C8797AB1884AF18`；Windows MCP 1.3.24 为 `6415D0A068280FDF3FDBAB75904ADD3EE974422D56F49F17060DA14F8B2F8FCB`；`THIRD_PARTY_NOTICES.md` 为 `C9B4AD52C99E387380A038613CC1B07A7060532CC34146FD8902B609B50F0356`。
- P5 第三方链：Playwright MCP 0.0.82 / [`f1257a5a67aff872f947fae274759f7d54853862`](https://github.com/microsoft/playwright-mcp/tree/f1257a5a67aff872f947fae274759f7d54853862) / Apache-2.0；Windows MCP 1.3.24 / [`b90485c3d1a228fc4f5341bc2bdfc7be7672c6d0`](https://github.com/sbroenne/mcp-windows/tree/b90485c3d1a228fc4f5341bc2bdfc7be7672c6d0) / MIT。许可证全文与补丁清单以随包 `THIRD_PARTY_NOTICES.md` 为准。
- 正式 `scripts/release.ps1` 需要签名私钥密码。当前只有本地未签名构建；未运行正式链，`.sig` / `latest.json` 均缺失，无可核验哈希。不能把本节指纹当作可发布构建。升级回归清单及限制见 `verification.md` P6、`decisions.md` D6、`data-and-rollback.md` §7。
