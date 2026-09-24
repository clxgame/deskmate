# 决策记录（已验证决策、兼容补丁与移除条件）

记录时间：2026-09-22 · 阶段：P0
格式：每条决策含依据与移除/重审条件。P0 为只读调查，以下均为"路线确认"级决策，无代码改动。

## D0-1：上游固定基线采用 anomalyco/opencode @ 826d9ad4

- **决策**：P1 起，原生工作台源码固定为 `https://github.com/anomalyco/opencode` 提交 `826d9ad46a22bef0294998e08daa3c4904fea28f`（tag v1.18.21）。
- **依据**：npm opencode-ai@1.18.21 的 integrity 与仓库 bun.lock 一致；GitHub tag 直接指向该提交且标题为 `release: v1.18.21`；sst/opencode 经 GitHub API 解析为同一仓库（非 fork）；packages/app|plugin|sdk/js 与根 bun.lock 均存在于该提交。
- **移除/重审条件**：仅当该提交被证实与已发布二进制行为不一致（用二进制指纹与运行时契约比对），才启动 §5.4 的联合升级子阶段；禁止混用 latest/dev。

## D0-2：`@opencode-ai/app` 不可作为 npm 依赖，必须整仓构建

- **决策**：工作台静态资源从固定提交整仓克隆（保留根 bun.lock、workspace 结构、bun@1.3.14）构建，不尝试 npm 安装 @opencode-ai/app。
- **依据**：npm registry 无该包（workspace 私有）；package.json exports 指向上游 workspace 内部消费（如 packages/desktop）。
- **重审条件**：上游开始正式发布可独立安装的 app 包且版本与引擎匹配时。

## D0-3：人设/记忆注入首选 `experimental.chat.system.transform` 插件钩子

- **决策**：P1 验证以该钩子作为原生链路注入点（两种入口共用），替代旧发送链路的 `system` 拼装。
- **依据**：钩子在固定提交存在（plugin/src/index.ts L291–296），由 packages/opencode/src/session/llm/request.ts L60–73 在构建系统提示时调用，可拿到 sessionID——满足 §8.2 按会话作用域与幂等替换的前提。
- **重审条件**：P1 实测钩子在该版本运行时不触发、时序不对或作用域语义不符；届时评估 `experimental.chat.messages.transform` 或最小版本化补丁，无验证路径则阻断正式切换（§8.2 末条）。

## D0-4：工作台经 Platform 适配层接入受管服务，不用 URL 参数/远程网站/iframe

- **决策**：实现 `packages/app/src/context/platform.tsx` 的 Platform 接口（desktop/windows），以 `getDefaultServer` 返回受管服务身份，`fetch` 走受限桥接。
- **依据**：该提交无 URL query 配置机制；ServerSDKProvider 以 platform.fetch 创建 SDK/事件客户端——这是唯一稳定的鉴权与连接注入点。施工 Prompt §3.1 同时禁止远程最新版网站/iframe/外挂桌面程序。
- **重审条件**：上游在后续受控升级中引入官方桌面嵌入机制时。

## D0-5：现有六层权限链不简化，迁移目标是"统一原生授权"而非 allow-all

- **决策**：保留 restrictive-first 六层（sidecar 全局基线/会话级/YUME 模式/宿主 workspace 策略/记忆批准/scoped 传输），P3 恢复扩展加载时按固定版本真实规则逐层核对，不机械删除保护。
- **依据**：settings.rs:1588–1605、permission_policy.rs:10–135、tool_permissions.rs:12–41 现状；审计 K2；施工 Prompt §3.4。
- **重审条件**：某层被证实与原生授权重复且无额外保护价值时，先列保护场景与替代证据再移除（§9.1 同原则）。

## D0-6：P0 不执行真实数据迁移与破坏性验证

- **决策**：P0 仅结构/统计核查；报表、历史、记忆的内容级验证留待对应阶段用合成样本。
- **依据**：施工 Prompt §4 安全边界与 §5 任务 7。

## D1-7：`defaultServer` 必须用 `ServerConnection.Key.make("sidecar")`，不能用 URL

- **决策**：工作台入口的 `defaultServer`/`getDefaultServer` 固定为 `Key.make("sidecar")`。
- **依据**：`ServerConnection.key()` 对 `{type:"sidecar", variant:"base"}` 连接返回字面量 `"sidecar"`（server.tsx:227-230）；permission context 等按 key 在 servers 列表里查找连接，URL 作为 key 会查找失败抛 "Permission server not found"（permission.tsx:80，实测命中）。这与 upstream desktop 的 `availableStartupServer` 行为一致（桌面端同样以 "sidecar" 为默认 key）。
- **教训记录**：P1 委派任务规格里我曾写 `Key.make(bootstrap.url)`，子代理按规格实现并在报告中指出了该风险；实测确认规格错误，以此条为准修正。
- **重审条件**：多服务器并存（远程 server 列表）时再评估 key 策略。

## D1-8：P1 验收使用 `tauri build --debug --no-bundle` 二进制，不是 dev server，也不是安装包

- **决策**：P1 的"打包后验证"以 `src-tauri/target/debug/yume.exe`（frontendDist 内嵌、tauri 协议加载、无 vite dev server）为准；NSIS 安装包留到 P6。
- **依据**：施工 Prompt 只禁止"开发服务器页面通过算打包通过"；debug 二进制满足"真实打包 UI"的语义且迭代快。既有 worklog-qa 即此模式。
- **重审条件**：P6 制作安装包时重验全部场景。

## D1-12：不退役轻聊旧 system 参数注入（修订 P1 预留的"退役"计划）

- **决策**：轻聊保留逐回合 system 参数注入（persona+skills+逐回合关键词记忆）；工作台经 yume-context 插件注入（persona+skills+锚点记忆）；插件经指纹去重保证**每次模型请求全局恰好一份** Yume 上下文。
- **依据**：§8.2 硬性要求——原生扩展链路注入、两种入口都能经过、每次请求恰好一份、幂等不 append——现行方案全部满足。轻聊的逐回合关键词记忆检索（`memory::retrieval::context_for_turn(真实用户输入)`）是 README 明示的产品契约（"相关记忆随消息注入"）；插件的 `experimental.chat.system.transform` 拿不到用户消息文本，只能提供锚点级静态记忆，强行退役旧链路会造成记忆功能真实回退。双路径经指纹去重收敛到一份，无重复注入、无双引擎。
- **后续路径**：若日后以 `experimental.chat.messages.transform`（可访问消息内容）实现插件侧逐回合记忆检索并验证等价，再评估退役旧链路；届时双入口人设块将统一为插件独立 system 条目形态。

## D1-9：工作台窗口改为代码创建（导航门控 + 关闭即隐藏），不再配置声明

- **决策**：从 `tauri.conf.json`/`tauri.qa.conf.json` 移除 workbench 窗口条目，改由 `workbench::create_window` 用 `WebviewWindowBuilder` 在 setup 时创建：`on_navigation` 仅放行 tauri/asset/customprotocol 与 tauri.localhost/ipc.localhost/asset.localhost/127.0.0.1/localhost，其余一律拦截；`CloseRequested` → `prevent_close + hide`。
- **依据**：配置声明的窗口无法挂 `on_navigation`（Tauri 2.11.5 该 API 只在 builder 上）。边界场景"打开外部网页不能调用 Yume 宿主 IPC"需要导航门控：外部页面永远进不了工作台窗口，桥命令另有窗口标签校验兜底（D1-4）。代码创建对三个配置文件（base/qa/dev）天然一致；CDP 远程调试经 `YUME_CDP_PORT` 环境变量门控（生产不开）。
- **重审条件**：上游 Tauri 支持配置式导航规则时。

## D1-10：CSP 增加 `script-src 'self' 'wasm-unsafe-eval'`，终端 WASM 手工暂存

- **决策**：①两处配置 CSP 增加 `script-src 'self' 'wasm-unsafe-eval'`；②`prepare-workbench.ts` 把 `node_modules/ghostty-web/ghostty-vt.wasm` 复制到工作台包根（vite 不把该 wasm 当资产输出）。
- **依据**：`wasm-diagnose.js` 实证 `WebAssembly.instantiate()` 被 CSP 拦（页面 script-src 无 wasm-unsafe-eval）；`replace_csp_nonce`（tauri-2.11.5/src/manager/mod.rs:126-151）确认 Tauri 把自动 nonce/哈希**追加**到既有 script-src，不会覆盖我加的指令，主题预加载等内联脚本不受影响。ghostty-web 加载器按 `[模块 href, ./ghostty-vt.wasm, /ghostty-vt.wasm]` 顺序取 wasm，页面相对路径命中即工作。
- **移除条件**：上游 ghostty-web 改为内嵌 wasm 或 vite 资产化；届时从 prepare-workbench.ts 移除暂存步骤。

## D1-11：模型默认值的单一生效源——设置页写回到 sidecar 全局配置

- **决策**：`set_settings` 保存后调用 `sync_workbench_default_model`：`provider_id/model_id` 非空且 sidecar 运行时，PATCH `/global/config {"model":"{provider_id}/{model_id}"}`（Basic 头，3s 超时，失败不阻断保存）。
- **依据**：§3.4 要求原生模型设置与 Yume 设置页共用一个生效来源。现状三处模型相关写入各有归属：providers/权限策略=Yume 设置（`OPENCODE_CONFIG_CONTENT` 环境注入，重启重注、优先于文件）；工作台默认模型=sidecar 全局配置文件；轻聊=设置页 `settings.model_id` 逐请求显式传参。写回后，设置页与工作台默认模型收敛到同一个 sidecar `model` 字段，消除"两套值互相覆盖"。
- **遗留**：①工作台内改模型不会回写 Yume `settings.model_id`（轻聊不受影响，因轻聊总是显式带参；如未来轻聊改读 sidecar 默认，再评估反向同步）；②写回仅覆盖设置页发起的变更。

## 待决（进入 P1 前由证据决定）——更新于 P1 施工中

- 轻聊 SDK 化：`@opencode-ai/sdk@1.18.21` 替换 `src/lib/opencode.ts` 手写客户端的范围与时机（仍待决；SDK 的 SSE 订阅在 P1 工作台已实证走 fetch 流式，轻聊侧改造窗口在鉴权批次一并处理）。
- ~~服务形态~~（已决）：`opencode serve` 与 `opencode web` 同一 Server 实现，app 所需路由全在（capabilities.md §4）；当前 sidecar 形态兼容。
- ~~鉴权启用方式~~（已决）：D1-3。

---

# P1 设计决策（2026-09-22，基于固定提交源码核实）

## D1-1：工作台打包形态——上游树内新增入口，独立构建，产物随 Yume 打包

- **决策**：在上游克隆（E:/Codex/工作伙伴/opencode-v1.18.21，detached @ 826d9ad4）内以**纯新增文件**建立 Yume 工作台入口：`packages/app/workbench/index.html`、`packages/app/workbench/entry.tsx`、`packages/app/vite.workbench.config.ts`；构建产物复制到 Yume `public/workbench/`（gitignore），经现有 frontendDist 提供给 Tauri `workbench` 窗口。
- **依据**：packages/app 是 workspace 私有包（D0-2）；@opencode-ai/app 的 package exports（`.`→src/index.ts 导出 AppInterface/AppBaseProviders/PlatformProvider/ServerConnection/createDraftStore 等）即为官方嵌入接口；packages/desktop 的 renderer（electron.vite.config.ts 以 `@opencode-ai/app/vite` 插件 + 自有 root 构建）证明"自带入口 + appPlugin"是受支持模式。新增文件不触碰任何上游既有文件，满足 §3.3 最小版本化补丁要求（连补丁都不是，是叠加文件）。
- **不采用的方案**：直接用 packages/app 默认 web 构建产物——其 entry 的 platform 为 "web"、生产环境默认服务器取 location.origin（在 Tauri 中是 tauri://localhost，指向错误），且凭证只能走 auth_token URL 参数（§3.3 禁止凭证入 URL）。
- **关键构建参数**：`base: "./"`（页面位于 /workbench/ 子路径，资源必须相对引用）；`root: workbench/`；`publicDir` 指回 packages/app/public（favicon/theme-preload 等）；theme-preload 插件要求 index.html 保留 `<script id="oc-theme-preload-script" src="/oc-theme-preload.js"></script>` 原样占位。
- **重审条件**：上游发布可独立安装的 app 包，或上游引入官方 Tauri/嵌入式入口模板。

## D1-2：平台适配首版声明 `platform: "web"` + 服务器引导成员

- **决策**：P1 工作台 Platform 实现为 `{ platform: "web", version, getDefaultServer, setDefaultServer(空操作), openExternal, notify, restart }` + `createBrowserDraftStore()`；不声明 "desktop"。
- **依据**：Platform 类型的 desktop 变体强制要求 `openDirectoryPickerDialog` 等原生选择器（P2 范围）；web 基线已在 app.opencode.ai 生产使用，附件/通知等有 web 回退。P1 目标是"最小贯通"，desktop 升级在 P2 平台适配阶段进行。
- **移除条件**：P2 实现目录选择/附件选择/剪贴板图片后，切换为 `platform: "desktop", os: "windows"`。

## D1-3：凭证流——宿主生成、IPC 内存交付、SDK 头部携带、WS 走连接令牌

- **决策**：①宿主在 spawn sidecar 时生成随机 `OPENCODE_SERVER_PASSWORD`（每次启动新随机值，不落盘）；②工作台窗口通过专用 IPC `workbench_connection` 一次性取回 `{url, username, password, directory}`，仅存 JS 内存（不进 URL/日志/截图/localStorage）；③app 的 SDK 层自动带 `Authorization: Basic`（utils/server.ts:27-41, createApiForServer 同理）；④SSE 经 SDK fetch 实现天然带头（无需 EventSource）；⑤PTY WebSocket 用上游既有 connect-token 机制（terminal-websocket-url.ts）。
- **依据**：server/auth.ts（Basic 校验，username 默认 opencode）；server-sdk.tsx:191-200（eventFetch 对 loopback 置 undefined → 事件流走 SDK 默认 fetch，仍含 auth 头）；app 不持久化含密码的 ServerConnection（desktop 模式：内存重建）。
- **连带改动（必须同批完成，否则破坏现有轻聊）**：`src/lib/opencode.ts` 的 fetch 与 **EventSource 需改造**（原生 EventSource 不能加请求头 → 换 fetch 流式解析或 SDK）；Rust `OpenCodeClient`（agent/opencode.rs）与 worklog `model_client.rs` 所有请求加 Authorization 头。这些文件中 opencode.rs 正被并行任务修改，编辑时只加头部参数、不动其逻辑。
- **遗留验证项**：启用后检查工作台 localStorage/IndexedDB 不含密码字符串（P1 验收记录）。
- **重审条件**：上游引入更细粒度 token 机制时改用之。

## D1-4：工作台窗口的宿主桥——标签校验 + 最小面

- **决策**：新增 `src-tauri/src/workbench.rs`（新文件，不碰并行任务的 agent 模块），命令：`workbench_connection`（返回连接信息）、`workbench_open_external`（校验 http/https/mailto 后 shell open）、`workbench_notify`。每个命令首行校验 `window.label() == "workbench"`，其他窗口调用一律拒绝——Tauri 应用自定义命令不受 capability ACL 约束，必须进程内自校验（§3.3 "不把网页内容当宿主控制指令"）。
- **lib.rs 触点**：仅 `mod workbench;` + `generate_handler!` 注册两处追加，不改并行任务的既有逻辑。
- **依据**：default.json 无应用命令条目可证应用命令默认放行；CSP connect-src 已含 `http://127.0.0.1:*`（需补 `ws://127.0.0.1:*` 供 PTY）。

## D1-5：工作台窗口配置

- **决策**：`workbench` 窗口：1280×800、resizable、有装饰、非置顶、初始隐藏（由宠物/轻聊入口唤起）；独立 capability 文件仅声明最小窗口权限；CSP 在现有基础上为 connect-src 增加 `ws://127.0.0.1:*`。
- **依据**：§3.1（独立可调整大小窗口）；§3.3（独立最小 capability）；capabilities.md §3（PTY 走 WebSocket）。

## D1-6：目录路由沿用 app 原生 header 机制，宿主不改协议

- **决策**：app 的 SDK 层用 `x-opencode-directory` 头做目录路由（server-compat.test.ts 实证）；Yume 现有手写客户端用 `?directory=` query。工作台不加适配、不设全局目录锁定——P1 在 app UI 内选择受管服务已有的 project instance（workspace/）验证路由；轻聊与工作台共址同 session 的接续是 P3 范围。
- **依据**：server-compat.test.ts L63 等；baseline.md §6（opencode.rs 的 workspace_url()）。

---

# P3 设计决策（2026-09-23，基于运行证据）

## D3-13：MCP 工具权限模型——精确 ID + `ask`，spawn 前烘焙，永不 allow-all

- **决策**：在保持 `"*": "deny"` 基线不变的前提下，为每个明确批准的 MCP 工具按其**规范化生成 ID**（`sanitize(server) + "_" + sanitize(tool)`，上游 `packages/opencode/src/mcp/catalog.ts:117-119`）在权限表加 `"ask"`；不用 `"allow"`、不做模式通配、不开全局放行。配置必须在 sidecar spawn 前经 `OPENCODE_CONFIG_CONTENT` 注入。
- **依据**（全部运行实证，verification.md P3-7）：①MCP 连接、握手、`tools/list` 成功不代表工具进入模型工具表——`LLMRequestPrep.resolveTools()`（session/llm/request.ts）按 `Permission.disabled()` 过滤，基线 `"*":"deny"` 使 MCP 工具被隐藏；②`"ask"` 与 `"allow"` 都能让工具进入工具表，但 `"ask"` 保留运行时审批（E2E 中批准一次后工具真实执行并返回 `YUME_MCP_ECHO:` 输出）；③per-directory 配置为 run-once 缓存，进程运行后 `PATCH /global/config` 不改已缓存实例配置（此前三次运行时 PATCH 尝试均无效），故必须 spawn 前烘焙；④上游 sanitize 正则 `[^a-zA-Z0-9_-]` **保留连字符**——QA 配置键定为下划线形式 `yume_qa_mcp`，与运行时观察 ID `yume_qa_mcp_yume_qa_echo` 一致；两侧（Rust/TS）镜像各有一条"保留连字符"回归测试防再误判。
- **实现形态**：`settings.rs::sidecar_permission_policy_with_approved_mcp_tools(&[...])` 叠加在不变的 `sidecar_permission_policy()` 之上；未启用 MCP 时批准列表为空且等于基线，启用固定桌面 MCP 时只传对应显式 `(server, tool)` 对。
- **对 P5 的约束**：Playwright MCP / Windows-MCP 接入必须复用本模式（固定版本 → 明确批准清单 → 精确 ID + ask → spawn 前烘焙），不得另造放行机制。
- **重审条件**：未来落地真实 `Settings.mcp_servers` 用户配置面时，批准列表来源由 QA 常量换成设置字段，派生/注入逻辑不变；若上游改变 sanitize 或权限过滤语义（升级时复核 catalog.ts 与 permission/index.ts），按新事实重派生。

# P4 设计决策（2026-09-23）

## D4-1：取消成功必须由原生状态确认，工作台也不得绕过宿主

- **决策**：三条入口统一为 abort 响应成功后再读 `/session/status`；目标仍为 busy/retry 时返回明确失败，状态不可读时返回未知。确认停止后，宿主按 session 拒绝仍挂起的 permission/question、复查列表为空；若清理交互使 session 再次 busy，则再次执行确认 abort。轻聊与 Agent UI 在确认前保持 busy；上游工作台的 `platform.fetch` 仅拦截 `/session/:id/abort`，转交 `workbench_abort_session` 使用同一宿主门控；轻聊也经 `chat_abort_session` 进入该门控。
- **依据**：HTTP abort 的 `true` 只表示请求被接受，不证明工具进程树已退出；五场景真实矩阵首次运行还证明 OpenCode 会在 abort 后保留待审批请求，故必须把交互清理纳入“已停止”结算。真实生命周期 QA 另外核对 PID 消失与迟到文件不再增长。普通停止不重启 sidecar，只有结算失败的隔离恢复或 sidecar 真实崩溃才重启。

## D4-2：工作台输入所有权使用单会话租约，不以窗口存在推断存活

- **决策**：宿主仅保存一个当前 owned session；工作台按路由 claim/release，2 秒 heartbeat，6 秒过期。轻聊观察到租约失效后必须查询受管服务；只有 busy/idle 可确认时才解除所有权门，unavailable 继续锁定并给出说明。
- **依据**：WebView 崩溃不会触发 CloseRequested，永久 bool/HashSet 会造成输入永久锁死；按会话精确释放可避免旧页面释放新路由会话。

## D4-3：sidecar 异常退出自动恢复但不重放输入

- **决策**：宿主监督自己持有的 child；外部退出后中断宿主 Agent run、释放工作台租约，并以相同受管端口与本次应用启动内存凭证重启。监督器与显式 restart 共用恢复锁；应用退出先置 stopping，QA 停止宿主优先。
- **依据**：同一 endpoint/凭证使现有 fetch-SSE 与工作台 SDK 自动重连，无旧 endpoint 缓存问题；真实 QA 强杀后原 session 可鉴权读回、prompt 请求数不变，证明没有重放。

## D4-4：原生 session 元数据单独索引，消息正文仍只归 OpenCode

- **决策**：`native-session-index.json` 仅保存 `stableId=sessionId`、persona、workspace、source、created/updated。轻聊创建后同步登记；工作台平台层观察成功的 `POST /session` 响应后登记。重复登记 upsert，不复制 message/part/tool 正文。
- **依据**：满足 Yume 归属与筛选需要，同时保持 OpenCode 数据库为执行事实唯一来源；独立索引可随 UI 回退继续保留，不要求旧 UI 解析新原生数据库格式。

## D4-5：UI 入口回退与数据库降级是两条独立流程

- **决策**：UI 回退只切换/隐藏入口并允许旧 UI 继续读写 `history.json`；不得删除 `native-session-index.json`、覆盖 OpenCode 数据库或重放对话。数据库格式回退不得让旧 OpenCode 二进制直接写当前库，只能先复制到隔离目录，再以只读探测或经验证的导出/恢复流程处理。
- **依据**：合成演练中旧 UI 写入后原生索引字节不变且新增 workbench 记录仍在；隔离副本只读探测可读 1 条完整原生 part，当前源库前后 SHA-256 完全一致。该演练有意不宣称任意未来版本都可无损降级。
- **重审条件**：升级版本提供官方、可校验且支持目标旧版本的导出/降级工具时，可在隔离副本上加入该路径；仍不得跳过源库哈希保护和恢复后完整性核验。

# P5 设计决策（2026-09-23）

## D5-1：浏览器用固定 Playwright MCP，Windows 候选以真实副作用决定去留

- **决策**：浏览器固定 `microsoft/playwright-mcp@0.0.82` / `f1257a5a67aff872f947fae274759f7d54853862`（Apache-2.0）。`CursorTouch/Windows-MCP@0.8.5` / `30c1472f807eefa44774a2fe23a5b10502a59f23`（MIT）被否决，替换为 `sbroenne/mcp-windows@1.3.24` / `b90485c3d1a228fc4f5341bc2bdfc7be7672c6d0`（MIT）。
- **依据**：Playwright 候选在 OpenCode 1.18.21 中完成 DOM 输入与本地 HTTP 服务双读回，四个错误/停止分支均产生真实 native tool part。CursorTouch 候选虽握手与工具 schema 正常，但真实记事本输入无文件副作用，截图在多个后端均为 COM access denied，独立窗口枚举也无可操作窗口；不能把“工具返回 completed”当成成功。替代候选在普通交互用户权限下真实保存唯一标识并生成 1280×573 标注截图，拒绝、窗口消失、只读保存失败和停止矩阵全部通过。
- **安全边界**：两个 MCP 都默认关闭；启用后也只把显式白名单工具以精确 ID 加为 `ask`，保留全局 `"*":"deny"`。Windows 不暴露 `process`、`clipboard`、`mouse_control`、`file_open`、`file_save`。报表会话仍不得获得工具。

## D5-2：Windows MCP 随包固定二进制，不以 Python 环境作为产品依赖

- **决策**：Windows 候选以 `src-tauri/resources/windows-mcp/1.3.24/Sbroenne.WindowsMcp.exe` 随 NSIS 资源交付；`scripts/prepare-windows-mcp.ts` 固定官方 release ZIP SHA-256 `4432e34a…903f` 与 exe SHA-256 `6415d0a0…8fcb`，任一不匹配即构建失败。运行命令仅为 exe + `--tools <精确清单>`，删除旧候选的 `uvx`、遥测和截图后端环境变量。
- **依据**：替代候选官方 Windows x64 单文件发布，无运行时 Python/Node 依赖；这减少用户机器差异并允许离线安装后的 Windows 控制。Playwright MCP 目前仍依赖本机 `npx`，P6 发布候选必须在缺失 `npx` 时明确阻断或改为随包运行时，不能静默遗漏。

## D5-3：桌面 MCP 与模型目录解耦；宿主审批与报表隔离都使用同一固定清单

- **决策**：桌面 MCP 配置必须建立在最小基线 config 上，不依赖是否存在已验证 provider；宿主 Agent 只把固定清单中的规范化 MCP 权限转成逐次询问，其他 MCP 权限继续默认拒绝；报表 prompt 显式把同一固定清单全部设为 disabled。
- **依据**：真实桌面热重启暴露了两个独立缺口：provider 地址更新后目录尚未验证时，fallback config 会连同 Windows MCP 一起丢弃；侧车虽产生 `ask`，宿主原生策略却把所有未知 MCP 权限自动拒绝。两处修复后成功链 6 次审批完成，拒绝/错误/停止均由宿主结算。随后真实 report request 又证明只禁用 `/experimental/tool/ids` 返回值不足以覆盖 MCP；补入固定桌面 ID 后，请求从 10 个 MCP 工具降为无 `tools` 字段。
- **安全边界**：清单来源仍是固定版本与显式工具名，不接受任意 server/tool 通配；报表即使启用了浏览器或 Windows MCP，也始终零工具。

# P6 决策与退役门槛（2026-09-23）

## D6-1：未签名隔离候选只供本地验收，不能代替正式发布链

- **决策**：保留两个 `--no-sign` NSIS 作为可核验的本地构建；只安装 `com.deskmate.worklogqa` 且必须同时启用 `worklog-qa` 编译 feature。生产身份包不安装、不对外发布。现有私钥文件只核查存在，不读取/使用；用户不知道密码，不猜测。`scripts/release.ps1`、`.sig`、`latest.json` 留待拿到合法签名凭证后执行并记录哈希。
- **依据**：安装版 QA 工作台/sidecar/资源已在真实 WebView 跑通，同版本重装和 QA 卸装再装均未改变三个 QA 数据文件哈希；签名链却未产生任何可校验产物。正式 YUME 0.4.8 安装仍在原路径，未被 0.4.3 包覆盖。

## D6-2：旧代码退役必须按使用点与替代证据逐项放行

- **初审清单**：`src/chat/WorkspaceTask.tsx`、`src/chat/useAgentRun.ts`、`src/lib/agent.ts` 与 `src-tauri/src/agent/run_commands.rs` 仍是当前轻聊工作区任务的真实入口（`ChatApp.tsx` 挂载，`lib.rs` 注册命令，现有测试调用）；`tool_permissions` 与 `agent/opencode_settlement.rs` 仍承载宿主审批、取消和终态保证。它们看似与原生工作台重叠，但不能凭文件名或界面相似就删除。
- **移除条件**：仅当能力矩阵的提问、拖拽附件、命令、子任务、diff/撤销及相关错误/停止/审批在**安装版**逐项通过，并证明该旧调用点没有轻聊、宠物、worklog、旧历史或兼容用途，才考虑删除对应重复完整 Agent UI/执行/审批投影；每项删除另需回归测试与数据回退证据。只读/文本反推逻辑需先定位所有调用者、证明原生事实能完整替代，再动代码。
- **明确保留**：陪伴轻聊、桌宠、人设与逐回合记忆、worklog、旧历史读取、必要元数据、D1-12 的旧 system 参数注入和已证实的兼容处理。当前尚无一项满足全部删除条件，故 P6 本轮**退役数量为 0**；这是未过门槛，不是遗漏的“清理”。

## D6-3：QA 卸装可验证回退入口，不等于跨版本数据库降级

- **决策**：QA 同版重装、专属卸装再安装只证明安装/清除入口和数据保留；不能把它们写成“0.4.2→0.4.3 升级”或“旧二进制写新版库成功”。若没有同环境迁移前包与可控副本，性能和跨版本降级保持未验证。回退继续遵循 D4-5：UI 入口可切，原生库不得交给旧版本直接写。
- **依据**：卸装后 QA 安装目录与注册表项确实消失，`history.json`、`native-session-index.json`、`settings.json` 哈希不变；重装恢复同一二进制哈希。没有产生第二个版本的实际运行证据。

## D6-4：原生工作台工具走一次性审批，不以全局拒绝隐藏能力

- **决策**：受管 sidecar 中 `edit`、`write`、`patch`、`task`、`question` 使用 `ask`，让固定版本工作台能暴露原生工具并经原生权限/提问 dock 应答；`external_directory` 继续 `deny`、未知工具继续 `deny`，不开放全局自动批准。宿主轻聊仍由其独立权限策略约束。安装版 QA 对 edit、task 和 question 均验证了一次性应答与原生记录。
- **边界**：右侧审查和会话级文件撤销依赖 OpenCode 原生 Git snapshot；非 Git QA 目录只展示 edit 工具 part 的差异，不视作审查/撤销通过。QA 中通过工作台创建的 Git 仓库和进程级 `safe.directory` 完成了带 Git 的审查与撤销测试，没有更改用户全局 Git 配置。正式产品中非 Git 目录的体验仍需单独定界。
