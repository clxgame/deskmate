# 仓库文件用途复查与清理方案

日期：2026-09-30（Asia/Shanghai）。基线：`482b52952ecab5297dda410d5c14ac6c019ab003`，YUME `0.4.16`；判定对象包括清理开始时的未提交工作树。本文保留清理前的用途判定和处理方案；用户随后授权“开始处理”，已执行的删除、迁移、修复与验证见[执行进度](repository-cleanup-progress.md)。原有 42 项删除和审计整改改动保留；提交推送按用户后续授权执行，不升版或发布。

## 1. 为什么会漏掉

这不是三份文件的偶然遗漏，而是前两次检查没有建立完整的文件职责清单。

1. **清理按体积和目录推进，缺少文件全集。** 之前清理聊天中，三份鸣潮文档仅出现在 `ls` / `du` 清单，没有读取用途、核对引用或记录保留理由。处理重点是 target、缓存、旧素材和重复 persona 文本，因此小文件和根目录资料没有进入判定流程。
2. **系统审计按运行链路推进，遗漏仓库内容治理。** `AUDIT.md:9` 的文档覆盖集中在设计、迁移和验收，删除候选集中在迁移符号与状态路径。架构审计发现的重要问题并不能证明根目录资料、旧配置、实验脚本也已逐项检查。
3. **未区分“当前入口、历史证据、作者素材、实验、生成物”。** 有些旧计划仍写“当前阶段”“下一步”“复用入口”，有些实验脚本仍带某次机器路径；文件存在本身被当成继续保留的默认理由，缺少退役条件。
4. **代码绿灯不等于用途有效。** TypeScript 的 `noUnusedLocals` 不会证明导出有调用者；测试可以持续调用已退出生产的包装函数；Rust 的 `allow(dead_code)` 会遮住未使用的辅助函数。Vite 和角色打包脚本还会泛化复制无消费者的 JSON。
5. **完成声明没有对应覆盖账本。** 前次清理和审计都没有给出“检查全集 = 保留 + 删除 + 迁移/更新 + 待验证”的核对结果，漏项无法被最后一步发现。只读审计不直接删文件符合原请求，但遗漏删除候选并不因此合理。

今后必须先确认职责，再作处理决定；既不能用“资料有价值”补造保留理由，也不能把无静态引用直接等同于垃圾。

## 2. 本次覆盖及证据边界

- 起始 Git 清单共 **1,069 个路径**：1,061 个跟踪文件、8 个未跟踪文件。42 个跟踪路径已被此前工作删除；实际存在的非忽略文件为 **1,027 个**。本报告和本次证据不计入这个起始基线。
- 逐项复查根目录 9 份及 `docs/` 39 份 Markdown；另核对脚本说明文档、所有脚本/工作流、213 项资源文件的职责、调用或打包关系。完整路径判定见本次逐文件清单。
- 前端生产 TS/TSX 共 182 个文件。三个应用入口及工作台模块图可达 179 个；其余为无使用的 barrel、仅测试调用的旧包装和有实际回归职责的测试时钟。核对相对 import、动态 import 和工作台共享入口后再判定。
- Rust 模块树检查覆盖 `src-tauri/src/` 的全部 `.rs` 文件，包括 `#[path]`、平台条件和测试模块；另核对 Tauri `build.rs` 和脚本编译的 Windows 进程助手。**这只排除了完全脱离模块树的 Rust 文件，不代表每个函数都有效。** 本次另核对前端无生产消费者的导出、原审计退役项和 `allow(dead_code)` 辅助函数。
- 核对配置、构建、框架隐式入口、动态角色路径、CLI、测试 fixture、许可证和文档引用。起始 Markdown 的 59 个本地链接均能解析；链接有效不能证明文档内容仍正确。
- 忽略目录按目录用途、体积和现有维护说明核查；没有逐个读取 release 日志、用户聊天数据、密钥或依赖缓存。本次没有重新构建、运行产品测试、访问 GitHub/Apple 发布状态或核验 Windows/macOS 安装包。
- 逐文件清单对源码中的“保留”表示存在模块/测试职责；不是逐函数完整代码审计通过。需要实机、生成链或外部作者流程证据的项目明确保留前提，不能汇总成已全部验证。

## 3. 主仓无产品职责的资料：5 个文件

| 文件 | 证据 | 默认处理 | 验证 |
| --- | --- | --- | --- |
| `鸣潮BOSS汇总.md` | 游戏首领笔记；唯一入/出链是文末引用活动笔记；无应用、构建或维护职责 | 从主仓删除，Git 历史可恢复 | 检查三份资料的残留文档链接即可 |
| `鸣潮版本活动汇总.md` | 游戏活动、卡池和奖励资料；随 `52585d8` 的角色修复提交加入，并不是修复输入 | 从主仓删除 | 同上 |
| `鸣潮角色一览_3.6.md` | 有日期的游戏角色/抽取资料；与 BOSS 笔记在 `c8b2cd0` 保存 | 从主仓删除 | 同上 |
| `AI编程助手线程管理与上下文使用指南.md` | 通用 AI 使用教程，YUME 仅作例子；无项目入链；与下一份大量重叠 | 移出主仓；不另建仓库“杂项归档”继续留存 | 核对 AGENTS/README 仍包含真正项目维护要求 |
| `Codex线程管理与缓存使用建议.md` | 通用线程/缓存教程；同在 `4e4da65` 加入；无项目维护依赖 | 移出主仓 | 同上 |

该批是低风险文件清理，不需要为“文件已删除”新增测试。

## 4. 已退役却仍被复制的 3D 配置：28 个文件

**证据**：`src/pet/personaAssets.ts:58–64,91–94` 只解析 GLB 和纹理；`PetRenderer.ts:83–91` 加载模型并使用 `personaCatalog` 的缩放和动作配置。全仓当前代码没有 `figure3d.json` 的语义读取。`scripts/pack-personas.ts:93–96` 仅泛化复制 JSON，不能作为该配置有效的依据。部分文件仍提已不存在的 `personaFigure3d.ts` / `petBridge.ts`；小著一代配置 `idle=Think` 与现行目录 `idle=Idle` 冲突。

- 内置 3 项：`public/personas/{xiaozhu,xiaozhu-nidaime,xiaozhu-sandaime}/figure3d.json`。删除；验证内置模型/动作和 pack smoke。
- 可选 AKI 25 项：`public/personas/{aimisi,aogusita,bulante,carlotta,changli,chun,daniya,feibi,feixue,fuluoluo,jinxi,kakaluo,kanteleila,katixiya,linnai,luhesi,luokeke,moning,qianxiao,shouanren,xigelika,younuo,zanni,zhujue_FM,zhujue_M}/figure3d.json`。从当前作者树退役；需要保存其原作者参数时归入角色资产仓库，并同步当前私有素材下载包，防止再次展开。

总计 100,376 字节，其中内置 936 字节。现行 runtime 无消费者的判断为高置信；外部旧版本/作者工具的兼容尚未测试。删除当前源码里的文件不等于改写用户已安装的角色包，不扫描或批量修改 appData。当前比例、动作及材质说明以实际 catalog 为准。

**前提与验证**：确认作者资产发布包内容；运行现有 `personaCatalog` / `personaAssets` / `pack-personas` 与 Rust pack 导入回归；合成新 `.dmpack` 验证模型、动作和材质正常；检查完整 build 后没有旧 JSON 被再次复制。泛化打包输入还需改为按渲染类型声明必需文件与允许的作者元数据，保留 GLB/纹理、persona、placeholders、GIF/rig2d 与 placement 等真实输入。

## 5. 非当前平台的生成图标：46 个文件

| 路径 | 数量 | 判断与处理 |
| --- | ---: | --- |
| `src-tauri/icons/android/**` | 17 | 当前无 Android 工程、构建和发布入口；删除模板生成图标 |
| `src-tauri/icons/ios/**` | 18 | 当前无 iOS 工程、构建和发布入口；删除模板生成图标 |
| `src-tauri/icons/Square*Logo.png`、`StoreLogo.png` | 10 | 当前 NSIS/macOS 配置不用；删除未启用分发目标的图标 |
| `src-tauri/icons/64x64.png` | 1 | 无配置、代码或隐式消费证据；删除多余尺寸 |

总计 1,718,321 字节。逐文件名称和 hash 在证据清单，不能把整个 icons 目录加入删除命令。保留配置使用的 32/128/256 PNG、`icon.ico`、NSIS 图标和 hooks。

**保留反例**：`src-tauri/icons/icon.png` 虽没有仓库内静态引用，安装的 Tauri codegen 在 macOS 开发模式会隐式用它作图标，必须保留。`icon.icns` 先保留：实施时选定 macOS 正式图标源、明确配置，再在包内核验后决定是否移除。

**验证**：已有 Windows 图标校验、NSIS 安装器/卸载器图标检查及 macOS app/dmg 图标检查。本次尚未执行，两平台通过前不能把“配置未引用”当成最终打包通过。

## 6. 源码中的退役包装、预留导出和测试位置

本表按符号清理，不删除仍承担职责的整个模块，也不由前端 wrapper 无调用者推导 Rust IPC 可删除。

| 位置 | 证据 / 建议 | 删除前保留的行为验证 |
| --- | --- | --- |
| `src/pet/petModel.ts` | 4 个导出只由 `petModel.test.ts` 调用，是 `personaCatalog` 的旧默认角色包装；迁移有价值的默认模型/动作断言到真实 catalog，再删该包装文件 | 保留默认小著、资源 URL、动作映射及 renderer poke 行为；测试文件不可整份当垃圾删 |
| `src/lib/horoscope/index.ts` | 无 import 或动态入口，仅重新导出现有 date/generator/types/zodiac；删除未使用的 barrel，保留星运功能 | typecheck 和现有星运用例 |
| `src-tauri/src/packs/archive.rs:62–77` | `file_digest` 无调用、无测试，所在 archive 模块私有且无 re-export；被 `allow(dead_code)` 遮住；删除函数和仅用于它的 imports | Rust 编译/现有 pack 回归；保留 `extract_verified` 的真实 SHA-256 校验 |
| `src/chat/ChatApp.tsx:237,425` | `nativePersistedRef`、`createdRef` 后续均只赋值；原 F08，仍未处理；删声明及赋值 | reset/resume/local reply 现有回归 |
| `src/lib/history.ts:33–60` | `HistorySummary`、`historyList/historySave/historyDelete` 无前端调用者；删内部 wrapper/type | 保留 `historyLoad`、正文类型及后端 IPC；历史/迁移回归 |
| `src/lib/memory.ts:201–207,261–291` | `memoryAvailable`、`memoryCreate`、`memoryRelationship`、`memorySetRelationshipSummary`、`memoryLinkTask`、`memoryUnlinkTask`、`memoryUnlinkDeletedTask` 无前端/作者脚本消费者；删内部 wrapper | 保留 Rust 注册命令、实际 memory context/list/update/forget/export；检查删除 wrapper 后类型的真实消费者 |
| `src/lib/worklog.ts:72` | `worklogAvailable` 无调用；删 wrapper | 保留当前日志/报告工具与 UI |
| `src/lib/opencode.ts:61–65,193–207` | `ToolState` union 无消费者；4 个 `is*ToolPart` 仅测试调用，生产直接用 typed parts；可删退役辅助导出，测试迁到真实 parser/状态消费处 | 保留 pending/running/completed/error 状态解析和批准/完成行为回归，不以降低测试数为目的 |
| `src/chat/ccSwitchSetup.ts:165–172` | `recoverCcSwitchDraftsFromMessages` 仅测试调用；当前生产使用保留终态的 `recoverCcSwitchToolResultsFromMessages`；删过滤 draft 的旧 wrapper | 原恢复测试转向当前恢复入口，保留 tracker/去重/终态规则 |
| `src/chat/worklogActions.ts:35,61` | `worklogRequestId` 仅测试调用，生产用 `worklogOutput`；静态 `WORKLOG_SYSTEM_INSTRUCTION` 仅供测试，生产每轮调用 `buildWorklogSystemInstruction`；删旧 wrapper/常量并迁移断言 | receipt 验证、重复保存、自动归档及 03:00 工作日规则保持 |
| `src/pet/figure2d.ts:15` | `Figure2dAnimation` union 无消费者；删未使用别名，保留 V1/V2 schema、parser 和实际渲染类型 | GIF V1/V2 契约保持 |
| `src/pet/personaCatalog.ts:243` | `PERSONAS` 默认目录常量仅测试调用；测试直接用真实 `personaCatalog()` 后可删除冗余快照 | 保留内置与安装角色目录行为 |
| `src-tauri/src/history/native_index.rs` | `upsert/persist/replace` 仅测试调用，原 F08/D2；先用固定旧 JSON fixture 替代测试 writer，再删 writer | 旧格式读取、导入和 migration rollback，不删除整个 index 模块 |
| `src/pet/petSleepTestClock.ts` | 测试时钟有 4 个真实回归消费者；**保留**，建议移到 `src/testing/petSleepClock.ts`，同步 import | 睡眠和 reload 现有回归 |
| `src/chat/attachmentState.ts:29` | `AttachmentEventType` 用于测试事件穷举约束；**保留**，不可因无生产 import 删除测试保护 | 事件覆盖约束 |

源码候选经过仓库内调用复查；实施仍需 typecheck/现有行为回归验证。前端导出扫描也命中了工作台 `sessionRoute/createSessionOwnershipRouter`，但它们由 overlay/transform 共享，因此保留。Rust MCP permission helper 已有 `settings.rs:1909,2021–2025` 的生产消费者，不能因 `allow(dead_code)` 注解误删；清掉其失效的“future/QA only”注释和不必要 suppression 即可。

## 7. 实验与 QA 脚本的退役和漂移

| 文件 / 组 | 处理 | 理由及前提 |
| --- | --- | --- |
| `scripts/agent-qa/permission-verbatim-spike.ts` | 迁移必要场景后删除旧入口 | 硬编码 2026-09-17 `.omo/evidence/...` 和当时环境探针；由当前 permission contract/harness 接收必要用例 |
| `scripts/agent-qa/permission-pattern-spike.ts` | 同上 | 同类固定历史目录和单次实验 |
| `scripts/agent-qa/permission-directory-spike.ts` | 同上 | 同类实验；不能因此删目录授权回归 |
| `scripts/agent-qa/permission-exact-workspace-spike.ts` | 同上 | 独立 workspace 探针；提取有效权限样本后退役 |
| `scripts/agent-qa/p5-windows-candidate-inventory.ts` | 合并后删候选入口 | 旧临时 Windows MCP 候选盘点与当前 inventory 重叠；独有用例合入固定版本的 inventory |
| `scripts/agent-qa/p5-windows-e2e.ts:189` | 更新并保留 | 默认指向 `.tmp/sbroenne...exe`；改为 prepare-windows-mcp 的固定资源，保留错误/拒绝/Stop 矩阵 |
| `scripts/worklog-qa/seed-missed-week.js:4` | 更新并保留 | 仍读旧 `work-journal-reports-qa/run-receipt.json`；当前 desktop/provider/readback 使用 `worklog-natural-recall-qa` |
| `scripts/worklog-qa/verify-provider.js:45` | 更新并保留 | 向旧目录写自验输出且不建目录；统一显式 receipt/output 参数并校验启动条件 |
| `scripts/history-organizer-qa/`、`scripts/horoscope-qa/`、`scripts/automation-qa/chat-preview.*` | 保留；登记为预览/验收入口 | 渲染当前组件或提供验证 fixture，独立 HTML/CLI 本身就是入口，无 import 不等于无用 |
| 无 README/package/CI 入链的 manual QA CLI | 保留有职责的入口，补索引 | 在脚本索引注明命令、输入、输出、平台、是否需要真实服务、退出条件；测试 fixture 与可运行 CLI 分开 |
| `scripts/release.ps1`、`scripts/publish.ps1`、`scripts/publish-macos.sh` 等 | 保留平台/维护者职责，统一说明入口 | 与当前 Actions + 本机签名链职责交叠；检查 shared checks/draft gate、文档标明范围后再考虑移除旧编排，不直接删除发布能力 |
| `scripts/pack-upgrade.ps1` | 待确认维护职责后退役或补作者入口 | 没有调用/说明，但旧包 metadata/封面升级保证原资产逐字节保留；重新 pack 不等价，不能直接删 |
| `scripts/worklog-qa/capture-window.ps1` | 接入当前受管 QA 截图流程或退役 | 独立 HWND 截图 CLI，无当前调用/文档，且未绑定 QA 身份；保留必要截图验收能力后才退役 |
| `scripts/worklog-qa/desktop.ps1`、`scripts/workbench-qa/unified-history-desktop.ps1` | 核对共享过程管理部分，再决定抽取 | 两个领域场景与身份有真实区别；PID 创建时间、后代归属、reparse point、指纹、launch/stop/purge 等价前，不合并整份脚本 |

`scripts/prepare-xiaozhu-sandaime.ps1` 生成当前三代模型及溯源元数据；`scripts/prepare-personas.ts` 与 `.github/workflows/verify-assets-token.yml` 管理可选私有角色包输入；它们并非孤儿。私有包固定 26 个 GLB / 93 个 PNG 的校验与 pinned personas-1.0.1 相配，不因当前内置只有 3 个角色就删除。

补充治理缺口：现行 TS 配置主要覆盖 `src/`，runner 配置只覆盖三个脚本；大量维护/QA 脚本和自有 overlay 未被 typecheck 覆盖。补检查范围应与既有 W1/W2 衔接，不把 Vite 转译当成类型验证。`history-organizer-qa/README.md:3` 的 `npm run dev` 与 Bun 入口统一；horoscope QA 实际预览整个 SettingsApp，补说明或改名，不能误称独立星运验收。完整脚本清单为 156 项，其中 138 个现有 scripts/tests 文件、4 个 workflow、14 个配置/锁文件，明确包含两个待确认 CLI。

## 8. 生成文件与重复文件

| 项目 | 处理方案 / 验证前提 |
| --- | --- |
| `src-tauri/gen/schemas/{acl-manifests,capabilities,desktop-schema,macOS-schema,windows-schema}.json` 共 5 项 | 生成产物；后三份逐字节相同。先验证干净 checkout 在现行 Mac/Windows 构建可重新生成，确认 capability `$schema` 路径与开发期校验，再停止跟踪并加入准确忽略项；不删除真正的 `src-tauri/capabilities/*.json` 权限源 |
| `public/personas/xiaozhu-sandaime/provenance.json` | 保留资产来源证明，移到 `docs/assets/xiaozhu-sandaime.provenance.json` 等非 public 路径；同步生成脚本和现有资产测试；build 后不再随客户端发布 |
| 三组 `public/personas/<小著>/persona.md` 与 `resources/personas/<小著>/persona.md` 相同 | 分别服务作者打包与 Rust 资源展开，有职责且已有一致性测试；本轮保留。后续可选择单一源生成，不直接删除任一运行输入 |
| 三份 `resources/skills/<小著>/ncmdump.md` 相同 | 按角色目录授权/展开，目录语义不同；保留，不能按 hash 去重破坏权限边界 |
| 当前已删除的 40 个非内置 resource persona 文件、2 个 archive 素材 | 保持此前删除，不恢复或冒充本轮新成果；其中并非所有文本都逐字节重复 |

## 9. 文档清理：先修错，再合并契约、冻结历史

**必须先修的错误**：

| 文件 / 位置 | 当前问题 | 处理方案 |
| --- | --- | --- |
| `README.md:204–206` | 仍称消息有“记住这件事”按钮、不会自动保存；现行 settings 默认启用自动记忆和日志，按钮已移除 | 改为当前开关、可信来源、自动提取、管理/删除及失败边界；与 automatic-memory 验证记录对齐 |
| `docs/local-release-runbook.md:76`、`docs/macos-runtime-checks.md:12` | 仍把裸 `bun test` 当全套入口；当前 B1 为独立进程 runner | 改用 `bun run test:frontend` / `bun run check`；保留运行权限和实机 gate |
| `README.md:275`、`docs/macos-runtime-checks.md:50,81` | 常驻“一键更新”叙述与当前按需显示的“下载更新”行为不符 | 按 `conditional-update-footer.md:7–12` 和 `UpdateFooter/i18n` 修正文案和验证步骤 |
| `docs/migrations/opencode-native/unified-history-contract.md:18–28` | 缺当前 `CatalogEntry.has_records`；规则散在 `empty-conversation-history.md` | 合入空会话、hasRecords 和 history-entry 规则，保留旧数据/删除不复活边界 |
| `docs/migrations/opencode-native/progress.md:7,66`、`verification.md:153–159,172` | 同一文档给出不同“当前阶段”，旧“复用入口”仍写不自动重启/静态记忆 | 冻结历史；把当前命令、当前契约及未验清单提炼到活动入口，历史不再指导当前操作 |
| `docs/audit-remediation-progress.md:12` | “README 更新”只能证明部分段落更新，不能代表所有文档漂移已修 | 明确已改章节和未改范围；新增本次文件治理工作包，不冒充原 B2 已验收 |

**归档/合并规则**：增加 `docs/README.md` 作为唯一文档索引，区分当前契约、活动计划、历史记录；不为每个旧文件继续写一份新方案。

- 合并当前附件契约：`local-resource-attachments.md` 吸收 picker/preview 的当前规则；`attachment-native-regression.md` 保留真实宿主 gate；特定版本 QA 回执归档。
- 合并当前记忆说明：提取 `automatic-memory-construction-plan.md` 的有效产品/数据规则；验证记录保留，未验真实模型语义不能丢。
- 合并当前历史契约：吸收 `history-entry.md`、`empty-conversation-history.md`、organizer/composer 的现行交互规则；主题原则进入 `DESIGN.md`。
- 合并当前更新说明：conditional footer 规则进入现行 updater/runtime 文档；旧 one-click 方案及一次验证回执归档。
- 已完成的 frontend/composer/horoscope/organizer 方案、旧集成 review、旧 agent roadmap、迁移 baseline/progress/v048-port/verification 等迁入 `docs/archive/<主题>/`。先提取仍有效规则和未完成事项；不是删除独有证据。
- `frontend-redesign-phase-2-plan.md` 的 P1/P2、automatic-memory 的真实模型语义、attachment 的未验边界等单列到当前待办；只归档已完成部分。
- 保留 AGENTS、README、DESIGN、当前 audit/整改、macOS release gate、provider 功能说明、有效决策与回退约束、7 份 release notes。截图 `docs/qa/automatic-memory-chat.png` 有实际入链，保留并随验证文档移动。
- 移动时同步 Markdown 链接、release notes 引用、源码注释；特别是 `scripts/prepare-workbench.ts:11` 和 `THIRD_PARTY_NOTICES.md:21` 当前指向迁移 baseline。历史基线不可冒充新的固定输入说明。

逐份文档的判定列于本次完整清单，不能将全部 docs 批量移入 archive。

## 10. 本地忽略目录：按生命周期处理

| 目录 | 复查体积 | 处理方案 |
| --- | ---: | --- |
| `output/` | 约 11 GB | 先建立 completed/active 的逐版本保留清单；历史源码副本/中间候选/重复下载需验证可重建和当前状态后清除；release state/context、公证记录和独有 QA 证据保留 |
| `output/build-0.4.9/` | 约 1.4 GB | 旧构建候选，优先核对其不承担回退/验收输入后清理；不把日期旧作为唯一证据 |
| `output/releases/` | 约 7.2 GB | v0.4.15 / v0.4.16 仍含 release archives/状态/下载/QA；本次未查询公开状态，不允许直接清空 |
| `output/release-0.4.10…0.4.13/` | 约 1.8 GB | 每个版本核对状态、归档资产/公证信息、是否有当前恢复引用；保留小型回执，移除可重建的大型重复副本 |
| `output/silver-cat-*`、`output/小熊虫final` | 数十 MB | `output/README.md` 明确当前作者成果、原稿和预览软链接；移出源码工作树前保留完整来源与可用成果，不当缓存删 |
| `node_modules/` | 约 597 MB | 可重装依赖；仅在无构建/测试使用时按空间需求清理，不视为无关源码 |
| `dist/`、`public/workbench/` | 约 165 / 85 MB | 可重建输出及构建输入；无进行中的 dev/build 后清理，之后完整准备流程恢复；不拿旧 bundle 当新验证 |
| `artifacts/`、`.omo/` | 约 2.7 MB / 12 KB | 当前人工成果、局部工具状态按用途核对；不用通配 rm |
| `src-tauri/target*` | 当前不存在 | 前次清理结果，不重复记为本轮回收空间 |

以上大小来自 `du` 的目录会计，不能把它们相加宣传为本次已回收空间。之前已移除的 28 个 `.app` 另有 `output/app-bundle-cleanup-2026-09-30.md`，不重复计功。

## 11. 实施顺序与退出条件

| 批次 | 具体动作 | 风险 / 退出条件 |
| --- | --- | --- |
| A 资料和明显错误 | 移除 5 个根目录资料；修 README、测试入口、更新按钮规则 | 低；引用/本地链接核对、文案与当前源码一致；不新增源码文本测试 |
| B 退役源码 | 清理无用 barrel、petModel facade、无 caller wrappers/符号、write-only refs、file_digest；保留/迁移有价值测试 | 低至中；typecheck、当前源前端 suite、Rust library suite。旧 index writer 的 fixture 替代与删除同批 |
| C 配置和资源 | 去掉 28 个旧 figure3d；删 46 图标；移动 provenance；验证 schema 再生后停止跟踪 gen 文件 | 中；作者包/导入、内置模型/动作、Mac app/dmg 与 Windows NSIS 图标、干净生成链均验证。外部资产包变更另行落实并记录 |
| D 实验与入口 | 迁移四个 spike 和候选 inventory 的有效场景；统一 QA receipt/path；索引现行作者/QA/发布入口 | 中；批准/拒绝/目录隔离/取消/错误矩阵保留，CLI 可从干净环境按文档启动；Windows 项实际在 Windows 执行 |
| E 文档生命周期 | 先提取契约/未验事项，再合并与归档；建立唯一 docs 索引并修全部链接 | 低至中；没有丢未完成工作、兼容/回退约束或独有验收；旧文档不再充当当前命令入口 |
| F 本地空间 | 核对发布状态和进行中进程；清可再生副本/缓存，作者成果迁出时保留来源 | 取决于内容；逐路径记录处理结果，不读凭据、不清用户数据、不重复公证、不覆盖公开版本 |

每批单独 review diff，可独立回退；不重置工作树，不包含原有未提交整改，也不顺带升版或发布。现有 W1/W2 工作台 transform 简化、历史投影/数据治理仍按原施工依赖推进，不能借本轮文件清理直接删除运行链路。

## 12. 防止再次遗漏

1. 每次清理先取 tracked + untracked + ignored 目录全集；每个文件或具有共同明确职责的目录必须有保留/删除/迁移/更新/待验结论，未分类数必须为零。源码的模块可达与逐函数审计分别陈述。
2. 保留理由必须落到 consumer、当前契约、作者入口、测试保护或独有证据；删除理由必须覆盖动态/框架/CLI/配置消费者。无入链的有效入口补索引；无职责的资料退出主仓。
3. 一次实验有命名、输入/输出和退役条件；硬编码某次运行目录的 spike 在结论落地后迁用例并退出活动脚本目录。生成物有明确生成链和忽略规则，资产溯源不放前端 public。
4. 功能完成时同步 README、当前契约、操作 runbook 和旧文档状态；旧计划标基线/日期/superseded，未完成事项转移后才能归档。
5. “全部清理完成”必须有覆盖清单、实际 diff、验证结果及未完成项；测试通过不替代用途证明。当前方案中的条件项完成前，只能报告对应批次已完成。

这些要求已简短并入当前 AGENTS 的仓库审计/清理入口，完整流程维护在本节；沿用用户任务授权，没有引入自动删除或新的确认/发布门禁。

## 附录 A. 每份文档的处理归属

以下 49 项为 48 份 Markdown 与 1 张有实际引用的 QA 图。具体行号证据见逐文件 JSON；归档/合并不得丢弃未验事项和独有证据。

| 文件 | 处理 |
| --- | --- |
| `AGENTS.md` | 保留有效职责 |
| `README.md` | 更新当前内容 |
| `DESIGN.md` | 保留有效职责 |
| `AUDIT.md` | 保留有效职责 |
| `AI编程助手线程管理与上下文使用指南.md` | 退出主仓 |
| `Codex线程管理与缓存使用建议.md` | 退出主仓 |
| `鸣潮BOSS汇总.md` | 退出主仓 |
| `鸣潮版本活动汇总.md` | 退出主仓 |
| `鸣潮角色一览_3.6.md` | 退出主仓 |
| `docs/AGENT_HARNESS_ROADMAP_AUDIT.md` | 历史归档（先提取有效规则与未验项） |
| `docs/ai-provider-support.md` | 保留有效职责 |
| `docs/attachment-native-regression.md` | 更新当前内容 |
| `docs/audit-remediation-construction-plan.md` | 保留有效职责 |
| `docs/audit-remediation-progress.md` | 更新当前内容 |
| `docs/automatic-memory-construction-plan.md` | 历史归档（先提取有效规则与未验项） |
| `docs/automatic-memory-verification.md` | 保留有效职责 |
| `docs/chat-attachment-picker-fix.md` | 合并当前契约，历史回执另存 |
| `docs/chat-attachment-preview.md` | 合并当前契约，历史回执另存 |
| `docs/chat-composer-workspace-model-plan.md` | 历史归档（先提取有效规则与未验项） |
| `docs/conditional-update-footer.md` | 合并当前契约，历史回执另存 |
| `docs/daily-horoscope-implementation-plan.md` | 历史归档（先提取有效规则与未验项） |
| `docs/empty-conversation-history.md` | 合并当前契约，历史回执另存 |
| `docs/frontend-redesign-phase-2-plan.md` | 历史归档（先提取有效规则与未验项） |
| `docs/frontend-redesign.md` | 历史归档（先提取有效规则与未验项） |
| `docs/history-organizer-redesign-plan.md` | 历史归档（先提取有效规则与未验项） |
| `docs/history-theme-consistency.md` | 合并当前契约，历史回执另存 |
| `docs/local-release-runbook.md` | 更新当前内容 |
| `docs/local-resource-attachments.md` | 保留有效职责 |
| `docs/macos-one-click-update-plan.md` | 历史归档（先提取有效规则与未验项） |
| `docs/macos-release.md` | 保留有效职责 |
| `docs/macos-runtime-checks.md` | 更新当前内容 |
| `docs/migrations/opencode-native/baseline.md` | 历史归档（先提取有效规则与未验项） |
| `docs/migrations/opencode-native/capabilities.md` | 更新当前内容 |
| `docs/migrations/opencode-native/data-and-rollback.md` | 合并当前契约，历史回执另存 |
| `docs/migrations/opencode-native/decisions.md` | 更新当前内容 |
| `docs/migrations/opencode-native/history-entry.md` | 合并当前契约，历史回执另存 |
| `docs/migrations/opencode-native/progress.md` | 历史归档（先提取有效规则与未验项） |
| `docs/migrations/opencode-native/unified-history-contract.md` | 更新当前内容 |
| `docs/migrations/opencode-native/v048-port.md` | 历史归档（先提取有效规则与未验项） |
| `docs/migrations/opencode-native/verification.md` | 历史归档（先提取有效规则与未验项） |
| `docs/release-v0.4.10.md` | 保留有效职责 |
| `docs/release-v0.4.11.md` | 保留有效职责 |
| `docs/release-v0.4.12.md` | 保留有效职责 |
| `docs/release-v0.4.13.md` | 保留有效职责 |
| `docs/release-v0.4.14.md` | 保留有效职责 |
| `docs/release-v0.4.15.md` | 保留有效职责 |
| `docs/release-v0.4.16.md` | 保留有效职责 |
| `docs/yume-latest-integration-review.md` | 历史归档（先提取有效规则与未验项） |
| `docs/qa/automatic-memory-chat.png` | 保留有效职责 |

## 附录 B. 本次证据位置

完整逐文件账本：[inventory.json](../output/repository-cleanup-audit/inventory.json)。汇总：[summary.json](../output/repository-cleanup-audit/summary.json)。每项含路径、状态、职责、处理动作、检查深度和依据；原有删除单独标记，不计为新清理。

专项证据：[文档](../output/repository-cleanup-audit/doc-classification.json)、[脚本/配置](../output/repository-cleanup-audit/scripts-classification.json)、[资源与 hash](../output/repository-cleanup-audit/assets-classification.json)、[TS 入口图](../output/repository-cleanup-audit/module-graph.json)、[Rust 模块引用](../output/repository-cleanup-audit/rust-module-references.json)、[本地链接](../output/repository-cleanup-audit/markdown-links.json)、[导出候选原始扫描](../output/repository-cleanup-audit/export-leaf-candidates.json)。原始导出扫描含已排除的 false positives，以第 6 节的实际消费者判定为准。

证据放在 Git 忽略的 output 下，本机可读，不纳入发布资产。报告保留结论；以后清理证据目录时先保存完成/未验结论，不能把缺失的临时证据误当仍可复现。
