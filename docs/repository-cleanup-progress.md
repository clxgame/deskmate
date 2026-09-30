# 仓库清理执行进度

2026-09-30，基线 `482b52952ecab5297dda410d5c14ac6c019ab003` / YUME 0.4.16。用户已授权实施[清理方案](repository-cleanup-plan.md)，随后要求保存、提交、推送。以下保留本轮清理及原有整改和42项删除的实际结果；提交推送状态以Git历史及本次操作回执为准，不升版或发布。

## 已实施清单

新增删除 **92 个跟踪文件**，迁移 **22 个文件**；不包括此前42项删除。原始1,069路径清单保留为审计基线，执行后的逐项去向另存账本；没有按扩展名或无静态引用批量删除。

| 批次 | 实际处理 | 用途与保护 |
| --- | --- | --- |
| 根目录资料：5删除 | `鸣潮BOSS汇总.md`、`鸣潮版本活动汇总.md`、`鸣潮角色一览_3.6.md`、`AI编程助手线程管理与上下文使用指南.md`、`Codex线程管理与缓存使用建议.md` | 已核对无产品/构建职责；退出主仓，可由Git历史恢复 |
| 退休配置：28删除 | `public/personas/*/figure3d.json` | 当前GLB动作/schema入口保留；旧私有归档复制和marker命中都过滤退休元数据 |
| 图标：46删除 | Android/iOS/Windows Store及64px等没有当前消费者的输出 | 保留实际desktop/NSIS图标、Rust fixture的32px及Tauri Macdev隐式`icon.png`；`icon.icns`继续保留 |
| 生成JSON：5删除 | `src-tauri/gen/schemas/` 的ACL、capability和三平台schema | 权限源保留；修正两份capability相对schema路径，加精确ignore；删除后实际Mac构建再生，另直接运行锁定生成器的Mac/Windows目标检查，再移除工作树生成输出 |
| 旧脚本：5删除 | 四份permission spike、Windows candidate inventory | 场景合入 `contract.ts --case permission-paths`；来源/schema/最小工具信息并入当前P5 inventory；拒绝/批准/目录隔离保护保留 |
| 旧源码文件：3删除 | `petModel.ts`、`petModel.test.ts`、`horoscope/index.ts` | 默认模型/URL/动作保护迁到真实catalog；poke断言迁 `PetRendererActions.test.ts`；星运实现保留 |
| 文档：20迁移 | 13份旧计划和7份合并原件 → `docs/archive/` | 20/20归档正文和独有证据保留；先将现行契约和未验项转入当前入口，不继续让历史命令指导当前操作 |
| 资产证明：1迁移 | public下三代provenance → `docs/assets/xiaozhu-sandaime.provenance.json` | 字节不变，生成脚本和测试同步；不再随客户端静态资源发布 |
| 测试工具：1迁移 | `petSleepTestClock.ts` → `src/testing/petSleepClock.ts` | 有真实睡眠/reload消费者，保留工具和断言 |
| 退役符号 | 无caller的history/memory/worklog wrapper、只供旧测试的工具guard/别名/draft helper、worklog静态常量/request wrapper、两个只写ref、Rust `file_digest`及旧index writer | 不删除后端IPC；旧index读入/导入/回滚改用[固定旧JSON](../src-tauri/src/history/fixtures/native-session-index-v1.json)，不再由退休writer生成测试数据 |

角色包采用渲染器明确的必需文件与允许元数据清单，无关JSON/笔记/额外模型报错；GLB/PNG、GIF/rig配置、prompt、placeholders、位置和封面保持实际职责。已跑真实CLI的合成GLB包以及当前baobao、小熊虫包烟测。

当前QA路径已修正：工作记录provider/launcher/readback/seed统一 `YUME_WORKLOG_QA_EVIDENCE_DIR`，相对目录按仓库根解析；provider自验默认独立时间戳目录，退出检查包含signal并有关闭期限。截图接入受管capture入口，核对身份/活进程创建时间/后代/窗口归属，拒绝已存在输出，渲染指定HWND。Windows P5默认使用prepare准备的固定资源，平台/缺文件预检先于fixture创建。真实模型语义输出从固定 `/tmp` 文件改为时间戳证据或显式输出路径。

`tsconfig.runner.json` 加入本轮维护的contract、P5 inventory/Windows入口、角色打包/policy和语义QA脚本，传递检查其依赖；不宣称自有overlay和所有其他脚本已全量纳入类型检查。`client`/`contract`/`lifecycle` 类型修正仅收窄JSON和去未用import。

## 文档和治理

当前入口为[文档索引](README.md)和[脚本索引](../scripts/README.md)。已修README自动记忆/工作日志与更新按钮叙述、发布/runbook测试命令、附件/空会话/历史与更新契约；新增[记忆契约](memory-and-worklog.md)、[固定工作台构建](workbench-build.md)、[当前验收待办](verification-backlog.md)，同步release引用、第三方声明和prepare注释。AGENTS增加文件用途清单、提取未验事项后归档和覆盖核对规则。

原运行/UI/工作台/历史整改仍见[施工进度](audit-remediation-progress.md)。本轮删退休writer不关闭H1/H2/H3；补构建入口不关闭W1/W2；前端/Rust绿灯不代替完整原生UI或真实模型验收。

## 本地忽略输出

已核对0.4.10、0.4.11、0.4.12、0.4.13、0.4.15、0.4.16公开状态；0.4.15/16本地发布state均有完成记录。核对待删路径无打开文件后，处理 **17个具体目录/文件**，`output/` 的du口径大小由 **10.577 GiB降至5.052 GiB**，减少 **5.525 GiB**。这不包含前次28个App清理。

- 移除旧0.4.9固定上游clone/依赖：tracked源码无改动；三个旧overlay源文件先逐字节保留，并记录commit/hash。
- 移除已完成QA源码副本的Rust target/frontend dist，保留特有诊断源码、QA HOME/数据库/截图。
- 移除0.4.15/16已完成发布的unsigned候选与下载分片；保留发布state/context、Apple回执与最终签名资产。
- 移除八份与保留的最终签名资产SHA-256逐字节一致的下载/feed副本；保留tar的哈希同时与GitHub资产digest一致。

各版本最终签名资产仍保留一组，旧0.4.10…13唯一备份保留；作者原稿/小熊虫/银猫成果和证据保留。当前 `node_modules`、本次 `dist`、`public/workbench` 是有职责的依赖/生成输入，继续保留。具体路径、大小、hash和结果见[本地输出账本](../output/repository-cleanup-audit/local-output-cleanup.json)。

## 实际验证

同一工作树使用Bun1.3.14及 `DEVELOPER_DIR=/Library/Developer/CommandLineTools`；Rust复用外部target且离线锁定依赖。需loopback/合成钥匙串的测试在允许访问的上下文执行。

| 验证 | 结果 / 证据 |
| --- | --- |
| `bun run typecheck` | 三个配置全部通过，包括新增维护入口；[日志](../output/repository-cleanup-audit/typecheck.log) |
| `bun run test:frontend` | **155/155文件、1190项通过，0失败，0未完成**；[日志](../output/repository-cleanup-audit/frontend-tests.log) |
| `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml --lib` | **777通过、0失败、12忽略**；[日志](../output/repository-cleanup-audit/rust-tests.log)；ignored不计通过 |
| `bun run build` | 通过；[日志](../output/repository-cleanup-audit/build.log)；现有chunk体积提示仍在，完整工作台重建属于W1/W2 |
| 角色作者/模型/过滤 | 39项不同focused tests通过；真实合成GLB及GIF/rig pack CLI烟测通过；[小型回执](../output/repository-cleanup-audit/pack-smoke.json) |
| 权限路径live | Mac query/header六场景通过：read一次批准、edit/write拒绝、字节稳定、同目录请求一致、其他目录无串用；process/两端口/tempRoot清理全部true；[回执](../output/repository-cleanup-audit/permission-paths.json) |
| 工作记录fixture | provider八断言及指定进程/端口关闭通过；report四断言通过；仓库外相对证据路径解析通过；[provider回执](../output/repository-cleanup-audit/worklog-provider/provider-selftest.json) |
| 生成链 | 清掉五份输入后Mac实际Cargo成功再生四份；Mac/Windows锁定生成器目标在独立目录生成各自schema与desktop别名；Windows使用空合成ACL的generator smoke，**不是Windows原生构建**；[回执](../output/repository-cleanup-audit/schema-regeneration.json) |
| 去向/引用/差异 | 完整去向账本、本地Markdown路径/锚点和 `git diff --check`；结果见[最终核对](../output/repository-cleanup-audit/implementation-validation.json) |

缓存链复查发现仅加ignore还不够：移除schema后，warm Cargo原先可能跳过build.rs而不再生。已让build.rs监视 `gen/schemas`，检查缺失输出再生及之后缓存稳定；不让“首次清楚构建成功”掩盖后续缓存恢复缺口。生成的权限/schema内容与已通过library suite时一致。

## 尚需的实际环境验证

| 项目 | 后续处理 / 当前边界 |
| --- | --- |
| Windows Source checks与权限路径 | 当前机器为Mac；ordinary/extended文件系统别名的realpath身份与宿主wire归一化分支类型检查通过，live中明确skipped。需在Windows执行；raw extended HTTP alias支持另标not tested；不能用generator smoke替代整条构建链 |
| Mac app/dmg与Windows NSIS图标 | 实际配置/框架隐式消费者核对通过，当前所需图标保留；下一次打包用正式图标gate回验，未为本轮擅自签名、公证或发布 |
| 外部固定私有角色归档 | pinned版本/哈希未改，不修改外部仓库；本地提取过滤及warm-marker检查通过。后续上游发布时移除归档里的退休metadata并重新锁定版本/hash |
| Windows作者PowerShell与工作记录capture | CLI及生成路径更新已做，需实际Windows校验ZIP分支、生成器和HWND渲染的PNG可用性 |
| P5 Windows旧受管进程边界 | 已发现数字PID归属证明、setup失败及cleanup连锁失败的旧缺口；需先补出生时间/可执行文件/本次新建归属与逐项清理，再执行完整桌面矩阵，见[待办](verification-backlog.md) |
| 全脚本/overlay类型覆盖 | 本轮维护入口已纳入；剩余范围与W1/W2衔接。没有用Vite转译冒充完整类型检查 |

这些余项是平台、外部输入和既有运行整改边界，保留为明确待办。当前文件用途清理已落地；条件验收不标成全平台通过。

逐文件处理账本：[implementation-inventory.json](../output/repository-cleanup-audit/implementation-inventory.json)。证据位于Git忽略的output目录，仅保留本机核对结果；需要搬移/清除该目录时先保留本报告、余项和必要回执，不把缺失临时证据当成仍可复现。
