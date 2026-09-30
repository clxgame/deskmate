# 审计整改施工进度

日期：2026-09-30（Asia/Shanghai）。基线 commit：`482b52952ecab5297dda410d5c14ac6c019ab003`。
验收对象为该基线上的本次未提交工作树改动；没有新 commit、push、版本变更或发布。
版本保持 YUME 0.4.16 / OpenCode 1.18.21。原有角色资源与 archive 素材删除保持原样，不计入整改。

## 首批交付与保留范围

| 工作包 | 已落地 | 状态 / 仍需验收 |
| --- | --- | --- |
| B1 | 当前源码动态发现；完整绝对路径排序；逐文件独立 Bun 进程；DOM preload；退出码、失败、skip、超时、启动异常、中断及未完成清单；子进程树清理 | 本机全清单与受控失败通过。合成 clean/output-copy 目录清单一致；独立 Git checkout 清单与完整 check、Mac 中断及孙进程清理通过；Windows 中断清理待验收 |
| B2 | provider 新增项的 manualModelIds 契约；自动工作日志及显式写授权断言；6 项 Windows 路径测试明确平台条件；新增本机临时目录 parser/provenance 验证；README 测试入口/工作日志说明与 D1-12 更新 | Mac 适用测试通过；Windows 专属测试仍待实际执行，没有增加 ignored/skip；当时未修正 README 全部 Memory 章节 |
| R1 | bind/update/finish 先持久化候选再发布 active；受控 RunStore 写失败；scoped 原生事实确认恢复；恢复后的权限登记；scheduled 确认失败不终态化或重发 | RAM/磁盘/模拟重启、HTTP fixture 与真实 OpenCode CLI 隔离恢复通过；完整 Tauri 桌面宿主恢复流程待验收 |
| R2 | WAL 首次转换仅针对 BUSY/LOCKED 有界重试；未来 schema 提前拒绝及锁内复查；全部待迁移与版本推进共用 IMMEDIATE transaction；删除主文件备份回拷 | 本机 schema/WAL/失败回滚/跨进程/等待预算回归通过。schema 保持 2，无数据格式变更 |
| R3 | collector 投影失败继续 reconcile、权限同步与终态；用量采集独立；interactive/scheduled 旧输入失败只诊断；settle 后 archive 失败不挡终态与权限释放；catalog 模型选择错误单独保留失败约束 | collector / submission settle 及真实 OpenCode 连续 31 秒 archive 不可写、批准/拒绝/自然完成/确认取消通过；Tauri interactive/scheduled 输入失败完整矩阵待验收 |
| B3 | test:frontend / test:rust / check；push/PR 两平台 workflow；完整工作台重建 job；release 在建 draft 前复用该 workflow | workflow 文件已落地；GitHub job、Windows suite、分支保护 required checks 尚未执行/启用，不宣称 CI 门禁已生效 |
| U1/U2 | 尚未改动 UI | 重连、busy Stop、idle 后 scheduled、多个 text parts、迟到响应最小反例及修复待实施 |
| W1/W2 | B3 继续使用原准备流程与固定上游 ref | overlay 直接化、入口类型验证、统一指纹与重复准备待实施；没有把旧 public/workbench 视为重建证据 |
| H1/H2/H3 | 尚未改动历史读写协议 | 新正文投影退出、按 key 查询、变化行写入与导入时机待实施 |
| D1/D2、V1 | 尚未实施 | 退役代码、两平台宿主、回退演练与综合验收保留 |

首批源码全绿不能关闭 F01–F09 或替代 V1。下一批从 U1 最小反例及 U2 开始，工作台与历史简化继续遵循施工方案依赖。

## 运行时与命令证据

平台：macOS / Darwin arm64；Bun 1.3.14；Node v24.20.0；Rust/Cargo 1.96.0（Homebrew）。
本机没有 PATH 中的独立 Bun，执行时临时将已有 `/private/tmp/yume-bun-1.3.14/package/bin` 加入 PATH；脚本本身没有硬编码该路径。
全部 macOS 命令指定 `DEVELOPER_DIR=/Library/Developer/CommandLineTools`。
CI 沿用已有 release 的 Bun 1.3.14 / Rust 1.94.1，因此其实际结果仍需单独记录。

| 完整命令（仓库根目录） | 退出码 | 本次结果 | 日志位置（Git ignored） |
| --- | --- | --- | --- |
| `bun run typecheck` | 0 | 生产、src 测试和新增 runner 类型检查通过 | `output/audit-remediation/first-batch/typecheck.log` |
| `bun run test:frontend` | 0 | 154/154 文件；1185 pass / 0 fail / 1 skip；0 未完成 | `output/audit-remediation/frontend/manifest.json`、`summary.json`、逐文件日志；`first-batch/frontend.log` |
| `CARGO_TARGET_DIR=/private/tmp/yume-deep-audit-target cargo test --offline --locked --manifest-path src-tauri/Cargo.toml --lib` | 0 | 776 pass / 0 fail / 11 ignored | `output/audit-remediation/first-batch/rust.log` |
| `CARGO_TARGET_DIR=/private/tmp/yume-deep-audit-target cargo test --offline --locked --manifest-path src-tauri/Cargo.toml --lib agent::` | 0 | 97 pass / 0 fail / 1 ignored（最终全套亦包含这些用例） | `output/audit-remediation/first-batch/agent.log` |
| `CARGO_TARGET_DIR=/private/tmp/yume-deep-audit-target cargo test --offline --locked --manifest-path src-tauri/Cargo.toml --lib memory::` | 0 | 首轮 94 pass / 0 fail；随后新增 WAL 等待测试在最终全套通过 | `output/audit-remediation/first-batch/memory.log`、`rust.log` |
| `bun run build` | 0 | 自有前端 build 通过，保留已有大 chunk 提示；不是工作台重建 | `output/audit-remediation/first-batch/build.log` |
| `git diff --check` | 0 | 修改无 whitespace error | 本次终端校验 |

HTTP fixture 需要绑定 loopback 端口，沙箱内执行曾造成环境错误；获准在可绑定本机端口的上下文后完成以上验证。没有连接真实 provider、发送模型请求、读取用户聊天库或发布资产。

第一轮有效 Rust 基线为 765 pass / 7 fail / 11 ignored：6 项 Windows 路径 fixture，1 项旧 worklog tool 描述。首次 memory 竞争这次未触发，但保留原独立进程测试并修复其 WAL 配置竞争。前端原有 provider/worklog 两个契约失败均已修复。首次未指定 CommandLineTools 导致 release fixture 环境失败；纠正环境后通过。

另一次前端回归与手工 build 并发，`bundled-personas` 构建 fixture 在共享 dist 中遇到 ENOENT。停止并行构建后完整清单重跑全绿；`check` 按顺序运行这些阶段，README 记录避免同时构建。没有将这些失败加入 skip，也没有收窄清单。

## 故障与兼容覆盖

- B1 自检在临时目录证明 output、副本和依赖目录不参与发现；空清单报错；一个通过和一个失败文件组合时 CLI 退出 1；缺失运行时报告 startup_error；挂起子进程报告 timeout。默认每文件 120 秒，配置范围 100 毫秒至 600 秒。
- R1 在 begin 成功后分别注入 bind、confirm_submission、request_finish、reconcile、finish 写失败，对比 RAM、磁盘与模拟重启。恢复可写后提交成功；bind 的权限登记成功后 caller 清理样本通过。HTTP fixture 接受一次 prompt，确认失败及重启后仅 GET scoped snapshot 并重试元数据提交，prompt 次数为 1。未知提交事实继续保留 initial_input 屏障。
- R2 覆盖 schema 0/1/当前 2/未来 3；合法 v1 schema 的 v2 后段冲突；两步迁移中途失败；保持另一个连接打开的未 checkpoint WAL 数据；重开 integrity_check；既有多个真实独立进程同时首次启动和并发写入。持有 rollback-journal 写锁时首次 WAL 配置在约 5 秒返回，释放后重试成功。没有以文件复制充当回滚；原备份仅为短暂迁移 fallback，无独立保留契约。
- R3 连续 40 次 archive 失败仍登记 owned message/call IDs、显示批准并允许 Once reply，随后自然完成或已确认取消终态通过；这证明重复 tick 不进入 archive 监督失败链，尚不替代真实宿主跨 30 秒验收。提交结果不明但 settle 成功、archive 失败时，无 active/pending 或权限归属残留。native API、RunStore 和 catalog 模型选择的失败约束保留。
- 忘记屏障、memory/worklog 独立回执及来源幂等等既有库测试包含在最终全套。没有新的 schema 或 native 数据库改写，没有重放 prompt。

## skip / ignored 与平台范围

前端仅保留 `scripts/pack-personas.test.ts` 的既有 Windows 专属 pack 子集打包用例 skip：依赖 Windows 打包链。Windows job 将执行它。

Rust 的 11 个既有 ignored 保留，原因如下；本次自验新增 1 个需隔离原生 runtime 的显式 ignored，用专用脚本实际执行。默认全套为 776 pass / 0 fail / 12 ignored；新增项不属于默认门禁证据。原未写明原因的 export manual 用例补充了原因文本。

| 用例 | 条件 |
| --- | --- |
| `agent::tool_lifecycle_live_tests::live_audit_remediation` | `bun scripts/audit-remediation/verify-native.ts`，真实本机 OpenCode、合成 provider 与临时 workspace；本次单独执行 |
| `agent::tool_lifecycle_live_tests::live_tool_lifecycle` | 隔离 OpenCode/provider runtime 与 agent QA harness |
| `chat_attachments::export::tests::manual::manual_qa_exports_two_files_and_keeps_artifact_after_failed_export` | 显式隔离 `YUME_TASK6_DOWNLOAD_QA_DIR` |
| `chat_attachments::ncm::tests::manual::manual_qa_converts_real_ncm_with_bundled_runner_and_exports_downloads` | 显式真实 NCM QA 输入与下载目录 |
| `packs::gif_tests::imports_actual_xiaoxiongchong_artifact` | 显式构建 YUME_GIF_DMPACK |
| `packs::qa_tests::qa_pack_command` | 受限原生 QA command bridge |
| `packs::tests::imports_a_real_dmpack_built_by_the_packaging_script` | 显式构建 YUME_TEST_DMPACK |
| `pomodoro::qa_tests::qa_pomodoro_bridge` | 隔离原生 timer bridge |
| `tool_permissions::events::tests::live_web_permission_without_timeout` | 隔离运行中的 OpenCode |
| `worklog::export::tests::manual_export_reopen_evidence` | 合成导出 evidence 目录 |
| `worklog::repository::source_tests::manual_sqlite_reopen_evidence` | 合成 SQLite 重开 evidence |
| `worklog::runner::http_tests::shared_service_report_live` | P4 shared-service OpenCode runtime |

Windows 的 registry 盘符、分隔符、8.3 路径与 SystemRoot opener fixture 由 `cfg(windows)` 表达适用性。跨平台 registry 参数拒绝、缺失 handler、版本不可读、目录与可执行文件 identity 改用本机临时目录验证，仍在 Mac 执行。其它原有 Windows 条件测试保持不变，待 Windows workflow 执行。

## 未验收项目

没有启动真实桌面宿主或完整工作台，没有 Windows 执行结果，没有 CI run ID 或分支保护启用证明，没有完成回退演练。U1/U2、W1/W2、H1/H2/H3、D1/D2、V1 仍在计划中。F02 的本机源码验收成立，其余审计项继续保留各自端到端退出条件。
发布仅在之后明确要求时进入本机发布指南流程。


## 自行验收补充（2026-09-30）

验收仍限于首批施工。使用从基线本地 clone 的独立 Git checkout，应用当前未提交 diff 并复制本次未跟踪源码；不继承 maintainer 的 output 或 public/workbench。为避免重复下载，复用已有 node_modules 和已准备的本机 native resources，因此这是独立源码验收，不是无缓存安装/完整工作台重建证明。

- 两个真实 checkout 的 154 项相对测试清单完全一致；额外放入旧 output 测试副本后仍一致。临时 checkout 的 `bun run check` 退出 0：154/154、1185 pass / 0 fail / 1 skip，Rust 776 pass / 0 fail / 12 ignored，typecheck 与前端 build 通过。临时 checkout 随后已删除。
- SIGTERM 受控夹具包含测试进程和其孙进程。runner 退出 1、当前文件标记 interrupted、后续 1 项列为 unfinished；两个自建 PID 均已消失。Windows 清理实现仍没有执行证据。
- YAML 解析和结构检查通过：push/PR/workflow_call、Mac/Windows matrix、统一 check 和 release 复用检查入口均存在。这仅是静态结构验证，不是 GitHub Actions 成功或 branch protection 证据。
- 新增 `scripts/audit-remediation/verify-native.ts`，明确选择本机 binary，复用临时 HOME/XDG/private config 的隔离 harness。Rust 原生验收记录见下；完整 Tauri 桌面 UI、interactive/scheduled 实际启动入口及 real tool-child cancellation 矩阵仍待验收。

证据目录：`output/audit-remediation/self-acceptance/`。清单与全流程：`clean-manifest.json`、`clean-check.json`、`clean-check.log`、`clean-frontend-summary.json`；中断：`interrupt.json`；CI 静态检查：`workflow.json`；最终脚本类型检查：`typecheck.log`。此后修改仅为原生验收脚本/断言与其依赖夹具的类型标注，最终另行类型检查和原生执行；上述完整 check 对象为临时 checkout 创建时的源码快照。


原生最终命令：`DEVELOPER_DIR=/Library/Developer/CommandLineTools CARGO_TARGET_DIR=/private/tmp/yume-deep-audit-target bun scripts/audit-remediation/verify-native.ts`，退出 0。OpenCode health 验证 1.18.21；实际调用源码中的 scoped client、recovery、collector、permission 与 RunStore，使用真实本机文件路径阻塞产生 archive 写错误。持有原生批准请求时连续 tick **31182 ms** 未因 history 失败终态化；批准后工具实际写出临时 `command.exit=0`，拒绝生成终态 tool error，streaming 请求原生确认取消后 host active/权限归属均释放，再次运行完成。确认元数据失败后从磁盘重建 host state，原生 scoped snapshot 确认后重试成功；恢复场景 provider 初始请求 **1 次**。取消在 provider 收到请求前完成时不要求额外 provider 请求。

`native-driver.log` / `native.log` 记录 1 pass / 0 fail；`native-provider.json` 记录 5 次 provider requests、3 次初始请求、恢复场景 1 次；`native-cleanup.json` 的 processGone、providerClosed、sidecarClosed、tempRootRemoved 全为 true。没有访问真实用户聊天库或真实 provider。完整 Tauri UI、scheduled 启动入口和工具子进程强制取消仍未以该用例验收。

自验夹具初次把 storage 错误码、异步 prompt 接受时机和取消前 provider 请求数写成过强假设，导致夹具失败；修正为实际 storage 错误码、等待原生事实及按恢复场景核对一次请求后，最终完整原生用例及清理均通过。这些修正未放宽生产故障约束。

## 文件治理与文档契约更新（2026-09-30）

此项来自后续[文件清理方案](repository-cleanup-plan.md)，不计为原 B2 已完成的工作或新的宿主/模型验收。本次修正 README 自动记忆与更新按钮规则、发布测试入口，建立[文档索引](README.md)；合并附件、历史、更新与数据回退契约，冻结旧方案/回执，并将未验事项转入[当前验收与待办](verification-backlog.md)。实际文件数、链接核对及余项以[清理执行进度](repository-cleanup-progress.md)为准；历史和本段不替代当前源码测试。
