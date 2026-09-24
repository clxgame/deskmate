# 验证记录（命令、实际结果、证据索引）

原则（施工 Prompt §12）：失败即失败，跳过即未验证；每条记录含版本/构建指纹、命令、期望、实际结果、证据路径、是否跳过。

## P0（2026-09-22，Sisyphus / Kimi K3）

P0 为只读调查阶段，未运行产品测试套件；以下为实际执行的核查命令与结果。

| # | 命令/操作 | 期望 | 实际结果 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | `git status --porcelain; git log --oneline -10; git rev-parse HEAD` | 记录基线与未提交修改 | HEAD=6fd1077f3893e91a73ae71eb7792eded44b76026（v0.4.3）；22 修改 + 13 未跟踪，归属并行 agent-hang 任务 | progress.md |
| 2 | 读 package.json / bun.lock / node_modules/opencode-ai/package.json | 确认固定版本与依赖结构 | opencode-ai 1.18.21 精确固定；bun.lock sha512 与 npm registry integrity 一致；无 @opencode-ai/sdk | baseline.md §2 |
| 3 | `Get-FileHash src-tauri/resources/opencode/opencode.exe -Algorithm SHA256` + `opencode.exe --version` | 二进制指纹与自报版本 | 179,463,208 B；SHA-256 EA4F4D4B…AF18；输出 `1.18.21` | baseline.md §2 |
| 4 | 读 scripts/prepare-opencode.ts | 确认二进制来源链与校验机制 | node_modules 复制 + 版本一致性检查 + PE/架构校验；sha256 下载校验属 ncmdump | baseline.md §2 |
| 5 | 目录结构列举 `%APPDATA%\com.deskmate.desktop`（不含内容） | 数据归属基线 | opencode-home/deskmate-memory.db/history.json/yume-worklog.db/agent-runs/workspace 等；opencode.db 9.2MB+4.2MB WAL | data-and-rollback.md §1 |
| 6 | 读 sidecar.log | 运行事实 | 无鉴权警告；127.0.0.1:62994；双 project instance；配置加载顺序；LSP/formatter 禁用 | baseline.md §4 |
| 7 | 读 docs/AGENT_HARNESS_ROADMAP_AUDIT.md（2026-09-16） | 提取已核实架构事实 | 调用链/权限链/报表隔离/已知契约风险（{id,role,parts} vs {info,parts}）等 | baseline.md §7 |
| 8 | explore agent × 2（Rust/TS 源码表 17 行核对） | CONFIRMED/CHANGED/MISSING 逐行判定 | 全部完成；关键变化：权限六层、history 墓碑/所有权、注入组装点 agent_run_start()、settlement/supervision/live-tests 为并行任务新增 | baseline.md §6 |
| 9 | librarian agent × 2（上游版本链 + 能力面） | npm→tag→commit 可追溯；app 能力面/CLI 独有项/配置面/传输鉴权/serve 适配 | commit 826d9ad46a22bef0294998e08daa3c4904fea28f；app SolidJS workspace 私有；system.transform 钩子存在；HTTP+SSE+PTY-WebSocket；Basic 鉴权；serve 与 app 兼容 | baseline.md §2、capabilities.md |
| 10 | 读 src-tauri/capabilities/default.json | 确认现有窗口权限范围 | windows: pet/chat/settings；core 窗口权限 + dialog:allow-open；无工作台 capability | baseline.md §6 |

**未执行（明确标注为跳过/未验证）**：

- `bun run typecheck` / `bun test` / `bun run build` / `cargo test`：P0 无代码改动，且并行任务刚在 `.tmp/final-*.log` 跑过其范围；本任务未复跑，不声称其结论。
- 官方 Web 应用行为基准运行：属 P1 任务 1（先构建后运行），P0 仅确认来源与构建方式。
- agent-qa / worklog-qa：P0 未触发；`YUME_AGENT_TEST_BINARY`（脚本侧）与 Rust live 测试的 `YUME_AGENT_TEST_BASE/WORKSPACE` 条件未满足时相关用例跳过，届时必须在证据中标明。

## P1（2026-09-22，隔离 QA 身份 com.deskmate.worklogqa + 合成 provider）

构建指纹：QA 二进制 `src-tauri/target/debug/yume.exe`（tauri build --debug --no-bundle --features worklog-qa --config scripts/worklog-qa/tauri.qa.conf.json，经 desktop.ps1 build 并记录 build-receipt.json）；工作台包 `public/workbench/`（上游 826d9ad4 + 新增入口，vite build，index.html sha256 8A5B826C…FCB2D）；合成 provider `scripts/workbench-qa/provider.ts`（PID 1539216，127.0.0.1:52361）；证据目录 `artifacts/opencode-native/p1-20260922-152755/`。

| # | 场景 | 命令/操作 | 期望 | 实际结果 | 证据 |
| --- | --- | --- | --- | --- | --- |
| P1-1 | 工作台在真实 Tauri WebView2 中加载 | QA 启动（desktop.ps1 launch），CDP 检查 workbench 页 | 原生 app 完整渲染、无错误边界 | ✅ 首版遇错（boot 竞态 + ServerConnection key 不匹配 + font-src 缺失），修复后渲染完整：新建会话 UI、模型选择器、命令提示 | console-2.log、workbench-home.png |
| P1-2 | boot 竞态处理 | entry.tsx 增加 waitForServer（先等 /global/health 再挂载） | 不再出现启动即错误边界 | ✅ 修复后启动进入正常 UI | entry.tsx（上游叠加文件） |
| P1-3 | ServerConnection key 对齐 | defaultServer 改用 `Key.make("sidecar")` | permission context 不抛 "Permission server not found" | ✅ 修复后正常 | decisions.md D1-7 |
| P1-4 | CSP | tauri.conf.json + qa conf 增加 font-src/worker-src | data: 字体不再被拦 | ✅ 控制台无 font CSP 错误 | 两处配置文件 |
| P1-5 | 合成 provider 接入 | QA 设置 UI 添加供应商（base URL 无 /v1 后缀，Yume 自拼 /v1/models）→ 验证 → 模型选 model-a；`PATCH /global/config {"model":"yume-2/model-a"}` | sidecar 配置含 yume-2/model-a | ✅ GET /config 显示 provider yume-2（baseURL 52361，models.model-a）+ 默认模型生效 | 本次验证日志 |
| P1-6 | 正常场景（§6 验收 1） | 工作台发送 "hello qa" → 原生审批 dock 点"允许一次" | 完整文本 + 工具过程 | ✅ Shell/Get-Location 工具卡、审批 dock（拒绝/始终允许/允许一次）、最终文本 `WORKBENCH_QA_DONE:hello qa`；provider 记录 3 次请求（标题生成 + 主请求 + 工具后续） | workbench-session-done.png、requests.json |
| P1-7 | 同一受管服务 | run.js status 进程树 | 只有一个 opencode.exe | ✅ 树内仅 yume.exe(1547020) + opencode.exe(1423028) | status 输出 |
| P1-8 | 目录/session 路由 | 观察工作台 URL 与会话归属 | workspace 目录 + 原生 session ID | ✅ 初始路由 `/<b64(workspace)>/session` → 新布局草稿；发送后 `/server/c2lkZWNhcg/session/ses_f37b6f06…`（c2lkZWNhcg = base64url("sidecar")） | CDP eval 输出 |

| P1-13 | 故障场景（§6 验收：故障） | 杀 sidecar 进程 → 工作台发送 → 观察 | 明确报错、不启动隐式备用服务、不无限转圈 | ✅ 冷启动遇死服务：明确"无法连接到 YUME / 正在自动重试"状态；✅ 无第二进程（status 仅余 CDP 端口）；⚠️ 发送后约 20s 才进入明确重连状态，期间用户消息看似已发但无即时反馈（上游 submit.ts 有 toast 机制但未在 5s 观察窗内出现——记为待复核的上游 UX 缺口） | console 日志（ERR_CONNECTION_REFUSED/RESET）、页面文本 |
| P1-14 | 离线资源（§6 任务 4） | CDP Network 域重载工作台，统计请求源 | 禁外网时资源完整加载 | ✅ 39 个请求全部命中 tauri.localhost(8) / ipc.localhost(2) / 127.0.0.1(29)，**零外网请求**（模型目录为内置） | netlog 输出 |
| P1-15 | PTY/WebSocket（§6 任务 3） | POST /pty 创建真实 PTY（powershell）→ POST connect-token（x-opencode-ticket: 1 头）→ 工作台页内 WebSocket 连接 | WS 通道连通且有数据 | ✅ OPEN 后收到 PowerShell ANSI 初始化数据流；connect-token 为 POST（GET 会落到 SPA fallback，已记录） | CDP eval 返回 |
| P1-16 | 鉴权启用（§6 任务 3） | 宿主每次启动生成随机密码 → OPENCODE_SERVER_PASSWORD；全客户端带 Basic 头 | 无凭证 401、错凭证 401、正确凭证全通 | ✅ 无/错凭证 /global/health 均 401；工作台（凭证经 workbench_connection 内存交付）正常收发；轻聊（fetch+SSE 带头）完成"鉴权后轻聊"全来回；PTY 无凭证创建 401；QA sidecar 日志无 "server is unsecured" | 本次验证记录 |
| P1-17 | 鉴权下注入仍恰好一份 | 鉴权启用后工作台发 "authed hello" | 注入计数不变 | ✅ sysCount=2，sys[1] 含人设（仅此一份） | requests.json |
| P1-18 | 上游补丁纪律 | 上游克隆 git status | 只允许新增文件 | ✅ 仅 `?? packages/app/workbench/`、`?? packages/app/vite.workbench.config.ts`、`?? packages/app/workbench-dist/`，零修改既有文件 | git status |

**P1 通过条件复核（§6）**：正常 ✅ / 上下文 ✅ / 停止 ✅ / 故障 ✅（含已记录的上游 UX 缺口，见 P1-13，不阻塞但列入 P2+ 候选补丁）。打包形态：`tauri build --debug --no-bundle`（真实二进制、内嵌 frontendDist、非 dev server）。取消与上下文两门槛均已证明。

**P1 已记录的限制（不隐瞒）**：

## P2（2026-09-22，隔离 QA 身份 com.deskmate.worklogqa + 合成 provider + CDP 驱动）

构建指纹：QA 二进制 `src-tauri/target/debug/yume.exe`（含 workbench.rs 桥、代码创建工作台窗口、CSP 修复、模型写回、THIRD_PARTY_NOTICES 资源）；工作台包 `public/workbench/`（含 `ghostty-vt.wasm` 967,563B 暂存）；证据目录 `artifacts/opencode-native/p1-20260922-152755/`。

| # | 场景（§7 验收） | 操作 | 期望 | 实际结果 | 证据 |
| --- | --- | --- | --- | --- | --- |
| P2-1 | 窗口生命周期 | 代码创建工作台窗口（导航白名单 + CloseRequested→hide）；workbench_hide→show | 关闭即隐藏、重开恢复 | ✅ hide 后同一 webview 存活，页面状态与 last-active-url 完整；重复 show 幂等 | CDP eval |
| P2-2 | 导航边界（§7 边界） | 工作台页内 `location.href='https://example.com/malicious'` | 外网页面不得进入本窗口 | ✅ 被 on_navigation 拦截，停留在 tauri.localhost；宿主桥命令另有窗口标签校验双重门 | CDP eval |
| P2-3 | 外链（§7 故障：外链不受支持） | 桥调 workbench_open_external https / file:// | https 开系统浏览器且不导航本窗；file:// 拒绝 | ✅ stayedOnApp=true；file:// 返回 "Unsupported link protocol" | CDP eval |
| P2-4 | 图片粘贴（§7 正常） | ClipboardEvent 粘贴 测试图片.png → 附件 chip → 发送 | 图片作为附件进入请求 | ✅ chip 缩略图（alt=测试图片.png）；标记模型图像能力后，请求含 text+image_url 两部分 | requests.json、eval |
| P2-5 | 中文/空格路径（§7 正常） | 在 `workspace\测试 目录\说明 文档.txt` 写入 → workbench_read_file 读回 | 中文空格路径逐字节往返 | ✅ 内容一致（Set-Content 尾部 CRLF 除外） | CDP eval |
| P2-6 | 选择器（§7 故障：取消文件选择 + 正常：选中文件上传） | ①桥调 workbench_pick_files 打开原生对话框 → PowerShell ESC 取消；②原生对话框实际选中 → 桥读回内容 | 取消不崩不静默丢附件；选中则正确返回并可读 | ✅ ①取消返回空数组、页面存活；②对话框打开、选中返回 `{name:"贪吃蛇.html", path:"E:\Codex\yume\贪吃蛇.html", size:10254}`，workbench_read_file 读回 10254 字节且内容头一致。注：②的文件是真实磁盘文件、仅只读（非合成 QA 数据）；本轮 PowerShell 向对话框键入中文路径未落到文件名字段（回车确认了默认高亮项），"对话框选中→桥返回→桥读回"链路已证，"键入指定中文路径选中"属 QA 驱动局限、非产品缺陷（用户鼠标点选为真实路径） | CDP + WScript.Shell |
| P2-7 | 文件不存在（§7 故障） | workbench_read_file 不存在路径 | 明确错误 | ✅ "file missing" 错误，不崩溃 | CDP eval |
| P2-8 | 终端（§7 正常：使用该版本支持的终端） | Ctrl+Alt+T 新建终端 → 画布 → 终端内写文件 | 终端可用 | ⚠️→✅ 初查三因：①ghostty-vt.wasm 未打包（prepare-workbench.ts 已修，页面相对/工作台路径 200）；②CSP `script-src` 缺 `wasm-unsafe-eval` 拦编译（tauri.conf.json + qa conf 已修）；③修复后 canvas 挂载、终端标签可建、终端内 `Set-Content term-proof.txt` 成功回读 YUME_TERMINAL_OK（键盘→ghostty→WS→PTY→PowerShell→文件全链路） | wasm-diagnose.js、console、文件回读 |
| P2-9 | 会话切换与恢复（§7 正常） | 点击会话 `<a href>` 进入 → 关闭重开 | 切换会话、重开回到原会话 | ✅ 路由 `/server/c2lkZWNhcg/session/ses_…` 正确；hide→show 恢复 | CDP eval |
| P2-10 | 工作台 capability（§7 边界） | capabilities/workbench.json | 最小权限 | ✅ 仅 `core:default`（应用命令走进程内窗口标签校验，不经 ACL） | 配置文件 |
| P2-11 | 模型设置写回（§7.6 单一生效源） | set_settings 后调 sync_workbench_default_model → PATCH sidecar /global/config model | 设置页与工作台共用模型生效值 | ✅ 运行时实测通过：清空 `/global/config` 的 model 后，经 set_settings 选型 providerId=yume-2/modelId=model-a，`/global/config` 的 model 被写回为 `yume-2/model-a`（writeThroughWorked: true）；失败路径不阻断保存（函数容忍 sidecar 未运行/重启中） | test-write-through-clean.js |
| P2-12 | 上游声明（§7.7） | THIRD_PARTY_NOTICES.md（上游来源/MIT 许可/固定提交/叠加补丁清单/构建管线）入资源列表 | 发行物含声明、不依赖用户本机上游环境 | ✅ 文件已建并加入 tauri.conf.json resources | THIRD_PARTY_NOTICES.md |

**P2 进行中剩余**：OAuth 登录回调（QA 供应商为 API-Key 型，OAuth 流程不在本期验证范围，已记录）；打包产物安装/升级验证在 P6。

## P3（进行中，隔离 QA 身份 com.deskmate.worklogqa + 合成 provider + CDP 驱动）

| # | 场景（§8） | 操作 | 期望 | 实际结果 | 证据 |
| --- | --- | --- | --- | --- | --- |
| P3-1 | 轻聊→工作台会话接续（§8.1 场景 1） | 轻聊发"接续验证二"并批准后，点头部"在工作台打开" | 同一 session；打开本身不发消息/不复制历史/不另建会话；无重复发送 | ✅ 工作台就地导航到 `/server/c2lkZWNhcg/session/ses_f36c0313affeJPxSfgW8kst2io`（与轻聊同一 session），会话内容（"接续验证二"+工具过程+完成文本）完整可见；provider 计数接续前后均为 26（无重复发送）。修复过程发现：工作台页在应用启动即加载，挂接需经 `workbench://handoff` 事件对已加载页面就地导航（不整页重载、不重复 bootstrap） | handoff-verify.js、lastUrl、provider 计数 |
| P3-2 | 工作台新建会话→轻聊可见（§8.1 场景 2） | history_list 合并受管 sidecar 原生会话（native 标记，不复制进 history.json） | 轻聊历史列表含工作台新建会话 | ✅ history_list 现返回 24 个会话，其中 20 个 `native: true`（含工作台新建的 "New session - 2026-09-22T11:25/11:32" 等）；历史面板对 native 条目给"在工作台打开"徽章并走挂接（不经本地续聊），隐藏删除按钮（原生会话不归 history.json 管） | history_list 输出 |
| P3-3 | 上下文作用域（§8.2） | ①插件补"缺 sessionID 跳过"规则（`if (!input.sessionID) return`）；②真实日报生成后核对报表会话请求 | ①缺 sessionID 不注入陪伴；②报表会话无陪伴人设 | ✅ ①修正后正常会话注入仍恰好一份（"作用域验证"请求 sysCount=2、sys[1] 人设块=True、sys[0] 无）；②真实日报生成（工作日志条目+日报 run 均 committed）后，报表会话请求（reports::SYSTEM 标记）sysCount=1、sys[0] 无"小著"人设块——插件经 skipWhenHeadIncludes 标记正确跳过报表。遗留细化：标题生成等有 sessionID 的 utility 请求仍被注入（P1 已记，P3 后续可再按 model 细分） | requests.json、trigger-report.js |
| P3-4 | 输入所有权（§8.1） | ①轻聊建会话后点"在工作台打开"挂接 → 查轻聊侧状态；②隐藏工作台 → 再查 | ①拥有会话时轻聊断开输入/审批、显示"在工作台处理"+返回入口；②关闭即释放、轻聊恢复 | ✅ ①挂接后轻聊显示"该会话正在工作台处理"、输入区与审批卡片均隐藏（hasOwnedNotice/hasTextarea:false/hasApprovalCards:false）；②workbench_hide 后提示消失、输入区恢复（noticeGone/hasTextarea:true）。宿主在归属变化时广播 `workbench://ownership-changed`，轻聊事件监听实时重查（修复了挂接当前会话不刷新的问题）；归属按会话粒度，非全局锁 | CDP 验证输出 |
| P3-5 | 关闭重开审批只处理一次（§8.1 场景 3） | 工作台触发 bash 审批不回答 → 关闭 → 重开 → 批准；另触发审批 → 拒绝 | 原请求关/开不变、只处理一次；拒绝也正确 | ✅ 挂起审批 `per_0c9868717001ZHE735G7AhyvNt`：关闭后仍在（未自动答复/丢失/重复）、重开后仍为同一条（sameOriginalRequest:true,count:1）、批准一次后挂起清空且工具完成一次；拒绝后挂起清空、Shell 失败被拒、**不产生替代请求**（noReplacement:true） | CDP 验证输出 |

| P3-6 | 技能加载（§8.3/§8.5） | QA 私有 HOME 注入 `skills: { paths: [...] }` 后经工作台 `/skill` 端点查询 | 测试技能被发现并列出 | ✅ `/skill` 返回 `["customize-opencode","yume-qa-skill"]`，`yume-qa-skill` 为本次注册的测试技能（注册正确格式为对象 `paths`，非字符串数组） | 本次验证（run p1-20260922-152755） |
| P3-7 | MCP 工具暴露与权限（§8.3/§8.5） | `bun run verify:mcp-permission`（scripts/agent-qa/verify-mcp-permission.ts，真实 opencode.exe 1.18.21 + 合成 provider + 双工具 MCP fixture，control/fix 两运行各自全新 home/workspace/sidecar） | ①control（基线 `"*":"deny"`）：MCP connected 但两个工具都不进入 provider 请求 tools 数组；②fix（精确 ID + ask）：仅批准工具出现、未批准工具仍隐藏、审批往返后拿到真实工具输出；③进程/端口/临时目录清理闭环 | ✅ 全过。control_run: approved_tool_present=false, unapproved_tool_present=false, mcp_status=connected；fix_run: approved=true, unapproved=false, approval_round_trip=pass, tool_result_marker=`YUME_MCP_ECHO:mkf9adcf2c8300a46fc`（permission_request_id `per_0ca404aa2001p1L4m7DmoFuiii`）；cleanup.allClosed=true；binary sha256 `ea4f4d4b…af18` 与基线一致 | artifacts/opencode-native/p3-mcp-2026-09-22_17-53-08/mcp-tool-exposure.json（另有一次代理运行 p3-mcp-2026-09-22_17-50-03 同结论） |

**P3 残留（移交 P4/交接 Prompt，非失败项）**：§8.4 两角色×两目录并发矩阵；§8.5 配置损坏可诊断；question 腿的关闭/重开；输入 ownership 的崩溃恢复与单会话释放；工作台新建会话的 Yume 元数据登记补齐。

## P4（通过，2026-09-23）

| # | 场景 | 操作 | 期望 | 实际结果 | 证据 |
| --- | --- | --- | --- | --- | --- |
| P4-1 | 取消状态闭合 | 轻聊/Agent 定向测试；工作台 fetch abort 转宿主；Rust abort settlement 测试 | 未确认前保持 busy，busy/unknown 不宣告停止 | ✅ 43 个 TS 定向测试、5 个 Rust abort 测试通过；原生工作台使用同一门控 | `src/lib/opencode.test.ts`、`chatPetActivity.test.tsx`、`useAgentRun.test.tsx`、`opencode_settlement_tests.rs` |
| P4-2 | 提交响应丢失 | prompt POST 抛 transport error；按稳定 message ID 查 `/message` | 已存在则确认；不可读则待确认；不重发 | ✅ 两分支均通过，promptAttempts 始终为 1 | `chatPetActivity.test.tsx`、`opencode.test.ts` |
| P4-3 | ownership 崩溃恢复 | 单会话 claim→路由切换；无 heartbeat 超 6 秒；轻聊查真实状态 | 精确释放；busy/idle 才恢复；unavailable 保持锁定 | ✅ Rust 3 个租约测试 + React 真实状态门测试通过；工作台包重建成功 | `workbench.rs` ownership tests、`chatFixedReply.test.tsx` |
| P4-4 | 外部强杀 sidecar | 隔离 QA 桌面 PID 1687856；精确强杀 sidecar 1700764；等待监督器；鉴权读回 session；比较 provider 请求 | 自动恢复；原 session 不丢；零 prompt 重放 | ✅ 新 PID 1701776 在原端口 63081 监听；33→33 session；provider 0→0；旧 PID 消失 | `artifacts/opencode-native/p4-20260923-lifecycle/sidecar-recovery.json` |
| P4-5 | 真实工具生命周期 | `bun scripts/agent-qa/tool-lifecycle.ts` | 长命令/子进程/超时/失败/拒绝/取消均终态；PID 与迟到副作用清理 | ✅ exit 0；cancel 与 cancel-child processGone=true、lateWrite=false；全 cleanup=true | `.omo/evidence/agent-tool-lifecycle.json` |
| P4-6 | 双目录/权限/报告基线 | `bun scripts/agent-qa/contract.ts` | A/B 不串目录；report deny；abort/稳定 ID/清理 | ✅ exit 0；contract-complete；证据目录落盘 | `.omo/evidence/yume-agent-mode-sol/2026-09-22T19-37-10-635Z` |
| P4-7 | 原生 session 元数据幂等 | QA 桌面启动自动登记轻聊 session；IPC 重复登记同 ID | 1 条稳定关联；不复制消息正文；退出清理 | ✅ 1→1 条，created 稳定、updated 前移；hostAlive=0、端口监听=0 | `artifacts/opencode-native/p4-20260923-metadata/native-session-index-verification.json` |
| P4-8 | 共享服务并发停止隔离 | 同一真实 sidecar 同时运行 A 长 PowerShell 工具、B 正常聊天、C 实际 worklog 报表 runner；只 abort A | A/B/C 同时 busy；A 进程树与迟到写停止；B/C 不受影响 | ✅ A PID 1722344 消失且 lateWrite=false；B 返回 `LIFECYCLE_COMPLETE:normal-chat`；C run `p4-matrix-report` succeeded 并持久化 Markdown；全清理 true | `artifacts/opencode-native/p4-2026-09-22T20-10-59-799Z-shared-service/shared-service-isolation.json` |
| P4-9 | 五类取消矩阵 | 长命令、受控子进程、等待审批、工具失败、网络失联分别 prompt→观测→abort→结算 | 每例 busy→idle；有进程则 PID 退出；无迟到副作用；permission/question 无残留 | ✅ 5/5 通过；两组进程树全消失；等待审批残留清零；工具失败保留原生 completed+失败输出事实后取消；网络失联终态 MessageAbortedError；cleanup 全 true | `artifacts/opencode-native/p4-2026-09-22T20-33-45-701Z-cancel-matrix/cancellation-matrix.json` |
| P4-10 | 合成迁移与分离回退 | 完整 native、纯文本旧会话、删除墓碑、新 native、重复 message/part、中断残留；迁移两次；旧 UI 写历史；数据库隔离副本只读探测 | 数量不增；墓碑不复活；旧文本不伪造工具 part；新原生记录保留；当前数据库绝不交给旧写入路径 | ✅ history 4→4；重复折叠；墓碑/旧文本/中断态均正确；原生索引 2 条且无正文；UI 回退后索引字节不变；源 DB 前后 SHA-256 同为 `7eb72257…4627`，未宣称无损降级 | `artifacts/opencode-native/p4-2026-09-23T04-44-46-036-data-rollback/data-rollback.json` |
| P4-11 | 打包桌面取消门控表面 | 最新 QA debug binary + WebView2/CDP；chat 与 settings 窗口分别 invoke `chat_abort_session` | chat 命令已注册可用；非 chat 窗口被拒；退出清理 | ✅ chat `{ok:true}`；settings 返回 `chat abort is only available to the chat window`；host/sidecar/provider/49352/49472/55883 全关闭 | `artifacts/opencode-native/p4-2026-09-23-desktop-abort/desktop-abort-surface.json` |

**P4 通过判定**：取消真实进程、共享服务隔离、sidecar 恢复不重放、提交响应丢失不重发、ownership 崩溃恢复、原生元数据、合成迁移和 UI/数据库分离回退均已有运行证据；普通停止不依赖 sidecar 重启。

**测试纪律备注（P4 终验）**：`cargo test --lib` 651 通过 / 1 既存失败（`worklog_tool_tests::worklog_query_tool_contract_covers_natural_recall_shape` 的资源 marker，与迁移无关）/ 13 忽略；`bun test` 1002 通过 / 8 个 macOS 专用跳过 / 0 失败；`bun run typecheck` 双配置退出码 0；`cargo check` 干净（仅既有警告）；`bun run prepare:workbench` 与隔离 `tauri build --debug --no-bundle --features worklog-qa` 均成功。

## P5（通过，2026-09-23）

| ID | 场景 | 操作 | 期望 | 实际 | 证据 |
| --- | --- | --- | --- | --- | --- |
| P5-1 | 固定 MCP 清单与权限 | OpenCode 1.18.21 同时启动 Playwright MCP 0.0.82 与 Windows MCP 1.3.24，读取 provider tools/schema | 两服务 connected；只出现明确批准工具；危险 Windows 工具缺席；每个批准工具为 `ask` | ✅ 两服务 connected；16 个批准工具及 schema 全部出现；`process/clipboard/mouse_control/file_open/file_save` 全部缺席；清理全绿 | `artifacts/opencode-native/p5-2026-09-23T06-14-46-525Z-mcp-inventory/mcp-inventory.json` |
| P5-2 | 浏览器成功与错误矩阵 | 模型协议经原生工具打开隔离 Edge、本地页填唯一标识、提交并从 DOM/HTTP 服务双读回；另跑拒绝、缺元素、5s 超时、停止 | 真实工具调用、call/permission ID 可追踪；错误不伪装成功；停止后无迟到提交 | ✅ 成功链 7 个 native tool part 全完成，DOM 与服务记录一致；拒绝/缺元素/超时均为原生 tool error；停止后服务无迟到记录。直接 sidecar abort 的 tool part 仍 running，宿主结算验证留桌面集成项 | `artifacts/opencode-native/p5-2026-09-22T21-41-29-908Z-browser-e2e/browser-e2e.json` |
| P5-3 | Windows 候选替换 | 对 CursorTouch 0.8.5 执行真实记事本输入/截图，并用独立窗口枚举交叉验证 | 只有实际副作用成立才可接入 | ❌ 候选被否决：输入返回 completed 但文件为空；截图 COM access denied；无可可靠操作窗口 | `artifacts/opencode-native/p5-2026-09-22T22-53-21-822Z-windows-e2e/windows-e2e.json`（另见 22-37、22-42 批次） |
| P5-4 | Windows 成功场景 | 普通交互用户权限运行固定 exe；启动受控记事本、UIA 输入唯一标识、Ctrl+S、UIA 回读、窗口截图、磁盘读回 | 文件内容与唯一标识完全一致；截图与 native call ID 保留；无直接写文件冒充 | ✅ `app/window_management/ui_snapshot/ui_type/keyboard_control/ui_read/screenshot_control` 均 completed；磁盘精确读回；截图 1280×573、14 个标注元素；清理全绿 | `artifacts/opencode-native/p5-2026-09-23T06-05-34-524Z-windows-e2e/windows-e2e.json` |
| P5-5 | Windows 失败/停止矩阵 | 依次执行拒绝、窗口消失、只读保存、长等待中止 | 拒绝无进程；消失报错；保存失败不改原文件；停止后无输入；清理闭环 | ✅ `app:error` 且 pid null；消失后 `ui_read:error`；只读文件保持 `READ_ONLY_ORIGINAL` 且保留截图；stop 在 `ui_wait:running` 时 abort、无 `ui_type`、文件为空；controlled root 与运行时全部清理 | `artifacts/opencode-native/p5-2026-09-23T06-06-54-922Z-windows-e2e/windows-e2e.json` |
| P5-6 | 打包桌面宿主成功/拒绝/错误/停止 | QA Tauri 二进制启用随包 Windows MCP；经宿主 `agent_run_*` 与逐次原生审批执行真实记事本副作用 | 成功结果可读回；拒绝无副作用；错误投影到聊天；停止把 running tool 结算为 terminal，且无迟到写 | ✅ 成功 run completed，6 个批准工具均有 request ID，文件与截图精确读回；拒绝未创建文件；失败 run 为 `APIError` 并在聊天表面可见；stop 在 `ui_wait:running` 后 1.2s 内变为 `Tool execution aborted` / run cancelled，无 `ui_type` 与文件副作用 | `artifacts/opencode-native/p5-desktop-2026-09-23/desktop-host-e2e.json`、`desktop-success.png`、`chat-failure.png` |
| P5-7 | 设置热重启与无模型目录降级 | 把 provider 地址切到尚未验证的新端口并切换 Windows MCP，读取重启后 `/mcp` 与 `/config` | MCP 不得因“零已验证 provider”被静默丢弃；固定命令与 10 个 `ask` 仍存在 | ✅ 修复前重启后只剩 QA MCP；修复后 `yume_windows: connected`，随包 exe 路径、`--tools` 精确清单与 10 个 `ask` 全保留；回归测试覆盖无 provider 基线 | 同上；`settings::mcp_permission_tests::desktop_mcp_survives_when_no_ai_provider_is_verified` |
| P5-8 | 报表零工具污染 | Windows MCP 启用时从真实 QA 桌面排队日报，检查合成 provider 收到的两次 report request | 报表会话不得获得内置或 MCP 工具 | ✅ 修复前每次 report request 携带 10 个 Windows MCP 工具；修复后两次请求均不存在 `tools` 字段（tool count 0）。fixture 未返回报告 JSON，run 按预期为 `INVALID_MODEL_OUTPUT`，不影响隔离判定 | `artifacts/opencode-native/p5-desktop-2026-09-23/desktop-host-e2e.json`；`worklog::model_client::tests::real_http_fixture_requires_terminal_completion_and_disables_tools` |
| P5-9 | 受控真实模型浏览器工具选择 | `gpt-6-luna` 经用户指定 Kuro 网关，仅授权本地测试页的 Playwright 工具；导航、读 DOM、填唯一标识、提交、DOM/本地服务双读回 | 模型自行选择原生工具，真实浏览器副作用成立；凭据不入证据 | ✅ 5 次原生工具调用及对应一次性审批均完成；服务收到唯一标识恰好一次，最终 DOM 显示同一值；MCP connected，隔离运行时清理全绿；证据不含密钥 | `artifacts/opencode-native/p5-live-2026-09-23/browser-real-model.json` |
| P5-10 | 受控真实模型 Windows 工具选择 | 同一模型启动隔离记事本，输入、保存、UI 回读并截屏 | 磁盘精确读回且截图存在，原生 call/permission ID 可追踪 | ✅ 用户解锁桌面后重跑；7 次原生工具调用全部 completed、7 次精确一次性审批且零拒绝；磁盘文件与唯一标识完全相同，UI 原生读回含同一值；44,516 字节窗口截图已目视确认；记事本进程与 sidecar/临时根清理全绿。此前锁屏下 `keyboard_control` 与截图被安全桌面拒绝，未作为通过证据。 | `artifacts/opencode-native/p5-live-2026-09-23/windows-real-model.json`、同目录 `notepad-3421aadb-0c75-4b86-8a82-c045cc769480.png` |

**P5 通过**：真实模型浏览器与 Windows 链均证明模型自行选择经精确审批的原生 MCP 工具；浏览器有 DOM/服务双读回，Windows 有 UI/磁盘双读回和实拍窗口截图。拒绝、错误与停止矩阵及打包桌面宿主投影见 P5-2、P5-5、P5-6；凭证不入源码或证据。准入 P6。

**P5 当前测试纪律（2026-09-23）**：`bun test` 1003 通过 / 8 个 macOS 专用跳过 / 0 失败；`cargo test --lib` 655 通过 / 1 个既存失败（仍为 `worklog_tool_tests::worklog_query_tool_contract_covers_natural_recall_shape` 缺资源 marker）/ 13 忽略；`bun run typecheck`、`cargo fmt --check`、`cargo check`、`git diff --check` 均通过。React Doctor 为 82/100，仅余 `ChatApp` 与 `WorkspaceTask` 两项既有控制流复杂度提示；本轮发现的卸载后状态写入与独立串行等待均已修复，24 个定向回归通过。

## P6（进行中，2026-09-23；仅本地 Windows 隔离候选）

构建基线：YUME 0.4.3 / HEAD `6fd1077f3893e91a73ae71eb7792eded44b76026` 加当前未提交施工修改；OpenCode `v1.18.21` / `826d9ad46a22bef0294998e08daa3c4904fea28f`；Bun 1.3.14、Rust 1.94.1、上游 `bun.lock` SHA-256 `334AC7FB44E967944973C979ECAA218ACA96FD19028EAB36A89EA3F2BCBA1029`。构建命令与原样输入见下表；此指纹不是已签名发布版本。

| ID | 场景/操作 | 期望 | 实际结果 | 证据 |
| --- | --- | --- | --- | --- |
| P6-1 | `scripts/check-version.ps1 -TagName v0.4.3` | 版本/tag 一致 | ✅ 退出码 0 | 本地命令记录；`src-tauri/tauri.conf.json` |
| P6-2 | `bun run tauri build -- --no-sign`；生产身份仅构建，不安装 | NSIS 可重复构建，工作台与 sidecar 自动准备 | ✅ 最终源码重建退出码 0；`beforeBuildCommand` 依次运行 `prepare:workbench`、`prepare:sidecar`、`build`；`YUME_0.4.3_x64-setup.exe` 176,925,900 B，SHA-256 `41386B8E83C2EA175B484F0B1263E19A5888AD100368317C69B1A85AEE7EA09C`；`7z t` 校验 29 文件全部通过；Authenticode `NotSigned`，未安装生产身份 | `src-tauri/target/release/bundle/nsis/`；`src-tauri/tauri.conf.json` |
| P6-3 | `bun run tauri build -- --features worklog-qa --config scripts/worklog-qa/tauri.qa.conf.json --bundles nsis --no-sign` | 完全隔离身份，可安装 | ✅ 最新 QA 包 176,969,197 B，SHA-256 `C18587B1CDBDEFE86A267249DA6B17F194AB08140D1717792F7059219E975B7A`；`7z t` 校验 69 文件全部通过；`com.deskmate.worklogqa` + 编译期 `worklog-qa` 均启用；未签名 | 同上；`scripts/worklog-qa/tauri.qa.conf.json` |
| P6-4 | QA NSIS `/S /D=<工作区内绝对路径>` 安装并从安装目录启动 | sidecar/资源/工作台真实运行；生产身份不动 | ✅ 安装版 sidecar `--version` = `1.18.21`、SHA-256 `EA4F4D4B…AF18`；Windows MCP `6415D0A0…8FCB`；第三方声明 `C9B4AD52…0356`；工作台页/轻聊/设置均真实渲染。工作台鉴权 `/global/health` = 200，79 个重载请求中 0 外网；两份独立截图检查无乱码/裁切。生产 YUME 0.4.8 仍注册于原目录 | `artifacts/opencode-native/p6-qa-install/{workbench-installed,chat-installed,settings-installed}.png`；安装目录 `resources/` |
| P6-5 | 同版本 QA 安装包重新安装到原目录 | 修复入口可用，QA 数据不丢 | ✅ installer exit 0；本轮新包安装后二进制 SHA-256 `B7631FE7AB960CA7700B5F685EC8B7FEC90097217FF4EF1D9C387CEFC5AD7B47`；`history.json` / `native-session-index.json` / `settings.json` 三个文件重装前后哈希完全一致 | `artifacts/opencode-native/p6-qa-install/current/`；QA `%APPDATA%/com.deskmate.worklogqa` 的哈希核对（未读取内容） |
| P6-6 | QA 专属 `uninstall.exe /S`，核对后再安装同包 | 仅 QA 安装被撤除；数据和生产身份保持；候选可恢复 | ✅ uninstall exit 0；QA 安装目录与注册表项消失，QA AppData 三个文件哈希不变，生产 YUME 注册表项仍在；随后同包重装 exit 0，安装版二进制哈希回到 `86D42F77…E2` | 同上；`src-tauri/nsis/yume-installer-hooks.nsh` |
| P6-7 | `bun test`、`bun run typecheck`、`cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`、`git diff --check`、`cargo test --manifest-path src-tauri/Cargo.toml --lib --quiet` | 不回退既有基线 | ✅ Bun 1006 通过、8 个 macOS 专用跳过、0 失败；typecheck/fmt/diff 通过。⚠️ Rust 656 通过、13 忽略、1 项既存 `worklog_query_tool_contract_covers_natural_recall_shape` 缺 marker 失败，未删除或放宽 | 本轮测试输出；同一既存失败见 P4/P5 记录 |
| P6-8 | 从 QA 安装目录重启后，在真实工作台输入 `/` 并执行 `/model` | 命令菜单与对应模型选择 UI 可用，不发送模型请求 | ✅ 菜单出现内置命令、MCP 与技能项；点击 `/model` 后编辑器清空，真实模型选择窗口显示 `model-a` 已选中；截图目视检查通过。本批 `/terminal` 和 `/new` 未得到可核验结果；后续 `/new` 验证见 P6-13 | `artifacts/opencode-native/p6-qa-install/slash-model-installed.png` |
| P6-9 | 安装版 QA 模型调用原生 `question`；选择提交、隐藏重开、忽略 | 问题只在工作台应答；重开仍是相同 ID；拒绝无替代问题 | ✅ 选择“通过”后原生 question part completed、同会话继续；第二问 `que_0ce2aca5d001UZ1Cod5iFSrDxU` 隐藏/重开 ID 不变，点击“忽略”后 part error，待处理数 0、无替代问题。多题/多选/自定义回答未逐项验证 | `artifacts/opencode-native/p6-final-2026-09-23/question-pending-installed.png`；原生 `/question`、`/session/.../message` 回读 |
| P6-10 | 安装版在 QA 工作目录运行原生 edit、打开审查、撤销第二次编辑 | 一次审批准确定位文件；差异真实；撤销恢复磁盘原值 | ✅ `edit` 一次性审批准确定位 `p6-edit-20260923.txt`；首轮创建文件，第二轮 Git 跟踪下审查页显示 `P6_EDIT_AFTER`→`P6_EDIT_SECOND`；点击该消息“撤销”后磁盘哈希恢复为 `F30F11947D4011AC62792449B8559F77135B1ABD301604C00B7AE19AC1F0A447`，原生 session 有 revert 记录、审查页清空。非 Git 工作目录仅工具 part 有 diff，右侧审查不可用；QA 目录通过 UI 新建了 Git 仓库，进程级 `safe.directory` 仅对本次 QA app 生效，未改全局 Git 配置 | `artifacts/opencode-native/p6-final-2026-09-23/{edit-diff-installed,edit-review-git-installed}.png`；原生 session/磁盘哈希回读 |
| P6-11 | 安装版 `task` 启动 `explore` 子任务并回传 | 一次性审批；父子 lineage 与原生 part 可追踪 | ✅ `task` 一次性审批，父 `ses_f31bd3890ffeLSVNzc6BPo7LIW`、子 `ses_f31bcd143ffe5lLHzFXXxFQ86A` 的 `parentID` 精确匹配；子消息 `WORKBENCH_QA_CHILD_DONE`，父 tool part completed 并含同一子 ID/结果，父最终文本完成 | 原生 `/session` 与 `/session/.../message` 回读；`scripts/workbench-qa/provider.test.ts` |
| P6-12 | 安装版把合成 `File` 拖放到编辑器并发送 | 中文与空格文件名不丢；原生消息含准确文件内容 | ✅ 文件芯片显示 `P6 附件 空格.txt`；会话 `ses_f31baf10effeugn6mT29dxD0Km` 中原生 file part 为 `text/plain`、同名 data URL，抽取文本为 `P6_ATTACHMENT_PAYLOAD_20260923`；只读 `Get-Location` 审批后流程终态。拖放为 WebView DOM 合成事件，真实鼠标拖放未测 | 原生 `/session/.../message` 回读与工作台安装版表面 |
| P6-13 | 安装版执行 `/new`、`/terminal` | 前者打开空草稿；后者打开可核验 PTY 面板 | `/new` ✅ 清空编辑器并进入新草稿；`/terminal` ⚠️ 菜单项可点击，但在首页和已有会话里均未观察到终端面板，因此本轮不计通过；P2 的 WebView PTY 写入回读证据仍有效 | 安装版 CDP 控件/DOM 检查；P2-8 |

资源核对：`dist/workbench/index.html` SHA-256 `217880BC800DEDDE45AB24E6535283E21DDA5C681A19B2DB13E7E36B94A51AE3`；`ghostty-vt.wasm` 967,563 B，SHA-256 `B9579E2993A3FC6EDDE73121141AD6B2EAA94BDC3E43D46FD496177D12E503AF`，与打包前静态目录一致。工作台资源内嵌于 `yume.exe`，不是 NSIS 的单独资源文件；安装后真实 WebView 加载成功是运行证据。

**尚未通过的 P6 门槛（跳过即未验证）**：用户不知道现有 Tauri 私钥密码，未读/未使用私钥；`scripts/release.ps1` 的正式签名链未运行，`.sig` 与 `latest.json` 不存在，故两个包均不可对外发布。只验证同版本重装和 QA 卸装再装，没有两个不同版本之间的升级/降级。提问的多题/多选/自定义回答、真实鼠标拖放及更多 MIME、需模型执行的 slash 命令、`/terminal` 面板、CLI/TUI 专有入口仍缺逐项本轮运行证据；非 Git 目录没有审查/撤销。性能缺同环境迁移前对照。旧代码替代门槛未全过，不做删除。P6 总门槛与原任务书 §13 **未通过**。

## 复用入口（后续阶段直接引用）
1. 轻聊仍走旧 system 参数注入（插件按指纹跳过防重复）；旧链路退役在 P3。
2. 工作台侧记忆为锚点级静态摘要（写入时计算）；逐回合关键词检索仍是轻聊专属（P3 评估 messages.transform 路线）。
3. 标题生成等 utility 请求也会被注入（P3 作用域细化）。
4. 报表会话排除依据 reports::SYSTEM 前缀标记（代码路径验证；运行时实测列入 P3 场景 4）。
5. 宿主对外部强杀 sidecar 不自动重启（supervision 仅覆盖宿主自有 run）；恢复=重启应用（P4 生命周期再完善）。
6. 中途发送失败有约 20s 静默期才进入明确重连态（上游候选补丁：submit 失败即时反馈）。

**测试纪律备注**：`cargo test --lib` 638 通过 / 1 失败 / 12 忽略；失败项 `worklog_tool_tests::worklog_query_tool_contract_covers_natural_recall_shape` 经核实为**既存失败**（资源文件 2026-09-14 起缺 3 个 marker，HEAD 同样失败，与本任务改动无关），不删除不掩盖，留待其 owner 处理。鉴权批次后 `bun test` 996 通过 / 0 失败 / 8 跳过；`bun run typecheck` 双 tsconfig 均无错。

**发现的问题与处理**

1. `ServerConnection.key()` 对 sidecar 连接返回字面量 `"sidecar"` 而非 URL；`defaultServer` 必须与之相等，否则 permission context 抛错。已修（D1-7）。
2. 工作台窗口随应用启动创建，早于 sidecar 就绪 → 需 waitForServer 门槛。已修。
3. CSP 缺 font-src/worker-src。已修（两处 conf）。
4. Yume 设置页 Base URL 不含 `/v1`（目录校验自拼 `/v1/models`）；合成 provider 需同时服务 `/models` 与 `/v1/models`、`/chat/completions` 与 `/v1/chat/completions`。已在 provider.ts 兼容。
5. 模型选择器 UI 经 CDP 合成事件难以驱动；改用服务端 `PATCH /global/config` 设置默认模型（真实生效路径）。UI 驱动问题留待 P2 平台适配时复核（可能与焦点/合成事件有关，非功能缺陷证据）。
6. 打包形态说明：P1 使用 `tauri build --debug --no-bundle`（真实二进制、内嵌 frontendDist、非 dev server）；NSIS 安装包验收在 P6。

## 复用入口（后续阶段直接引用）

- 工作台构建（P1 起）：整仓克隆 anomalyco/opencode @ 826d9ad4 → `bun install --frozen-lockfile`（bun@1.3.14）→ `bun --cwd packages/app build`
- 现有 QA：`scripts/agent-qa/tool-lifecycle.ts`（合成 provider + 真实二进制）、`scripts/worklog-qa/run.js`（preflight/build/provider/launch/status/stop，端口以 receipt 为准）
- 证据目录：无既有等价目录，采用 `artifacts/opencode-native/<run-id>/`（不入库敏感数据）
