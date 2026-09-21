# YUME 最新前端代码包接入审查

## 结论与范围

以 `main` / `v0.4.7`（`b6bc30a20c0f029d2a47dd3405d0380dd0b6f54d`）为基线，在 `codex/integrate-yume-latest` 分支选择性接入。有效生产改动集中在三个样式文件，未整体覆盖压缩包。

输入：`yume-latest.zip`。SHA-256：`e78aa10faf754fe5be2736a10034f2736a75f437de2f86dbe9e7749b0006ff03`。

包内工程版本仍是 **0.4.4**，不是当前主分支快照。项目实际依赖为 React **19.2.4**。包内说明所称“251 项通过”不能替代当前代码验证。

## 审查发现与处理

| 优先级 | 发现 | 处理 |
| --- | --- | --- |
| P1 | 包内 Rust 更新模块、前端 updater 和 UpdateFooter 会回退 0.4.7 的检查/下载分离行为；版本号也退回 0.4.4。 | 保留当前实现及版本，不采用这些文件。 |
| P1 | SettingsApp、PersonaPacks 和导航代码基于旧布局；会移除真实导航组件、重复包裹主题选择器、拆散角色控件，并丢失部分可访问标签。 | 保留现有 P0 布局、角色切换/回退逻辑与真实八项导航。 |
| P1 | ZIP 的快捷键守卫移除了 defaultPrevented 检查，遗漏 ARIA 模态 dialog，且会被隐藏 alertdialog 阻断。 | 保留当前带可见性判断的完整守卫及测试。 |
| P1 | ZIP Vite 将端口改成 3000，而 Tauri 开发入口仍指向 1420；额外加入网页演示入口及模拟接口。 | 保留现有 Vite 配置、原生窗口入口和依赖锁文件。 |
| P2 | 新 chat.css 引用仅在设置窗口定义的 --r-pill、--ease；聚合演示页会掩盖独立聊天窗口缺失变量的问题。 | 在 chat-root 内完整定义需要的变量。 |
| P2 | 后面的旧 chat-iconbtn 规则覆盖新版按钮背景；附件按钮仍为 22px，与交付说明不符。 | 移除重复规则，附件和发送操作统一为 36px。 |
| P2 | 附件托盘或提示出现后，发送按钮相对整个输入区居中，偏离输入框。56px 输入框的原内边距也不足以完整容纳两行 18px 文本。 | 按输入框底部定位发送按钮；上下内边距改为 9px，保留 36px 文本内容高度。 |
| P2 | ZIP 丢失内置 figure.glb、Cargo.lock 和部分现有文档。 | 不据压缩包缺失情况删除仓库文件；构建资产检查通过。 |

### webAdapter 的边界

当前主分支没有 `src/lib/webAdapter.ts`；这次报告的 fetch 异常来自新增的浏览器模拟适配器。ZIP 通过 `src/devtools.ts` 无条件导入它，但它**确实有 isTauri 守卫**，与当前安装的 Tauri API 判定一致，不能据此断言正式桌面接口一定被接管。

`safeDefineGlobal` 可替换 configurable getter，但不能改写 non-configurable、无 setter 的 getter。将该函数提取到隔离的 Node VM，以 window 与 globalThis 指向同一全局对象做验证：前者替换成功，后者保持旧值；两种情况都返回 undefined。兜底重复尝试同一对象并不能突破属性限制，调用方也无法判断失败。初始化标记还会提前置为 true，存在部分初始化后无法重试的问题。

此外，适配器包含模拟凭据验证、角色导入及对话，按 URL 子串匹配请求；这些不是桌面业务修复。**本次不引入这套适配器，也不宣称已修复所有沙箱 fetch 限制。** 后续如需要独立网页预览，应显式限定为开发入口，采用可注入的 transport/host，并让初始化失败可观测。

## 实际接入

- `src/settings/settings.css`：面板 16×20px、基础卡片 12×16px、卡片间距 12px；保留紧凑页覆盖规则。移除侧栏和卡片的重复背景模糊，保留根窗口一层；保留真实主题预览色、完整名称换行、标题拖拽命中和数字对齐。
- `src/chat/chat.css`：根窗口使用共享亚克力背景，统一标题操作、状态指示、气泡和输入区；补齐独立窗口变量，使用主题相关阴影；修复按钮覆盖和附件提示下的对齐，支持完整两行输入及减少动态效果偏好。
- `src/chat/chat-markdown.css`：代码块圆角、内边距均为 12px，操作按钮 26px；保留代码与表格内部滚动和可访问名称。

SettingsApp.tsx、settingsPrimitives.tsx 无需为了匹配 ZIP 文件清单而改写。当前代码已包含其合理布局目标。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| `bun run typecheck` | 生产与测试 TypeScript 检查通过。 |
| `bun test src/settings/` | 263 pass，0 fail，31 个文件。 |
| `bun test src/lib/` | 38 pass，0 fail，8 个文件。 |
| `bun test src/chat/` | 初次审查时为 352 pass、10 fail。后续已修复测试模拟接口绑定，完整目录组合运行的 663 项均通过。 |
| `bun test src/settings/ src/lib/ src/chat/` | 修复后 **663 pass、0 fail**，82 个文件。修复前与未修改 main 对照均为 653 pass、10 fail。 |
| 单独运行 `src/chat/chatAttachmentSend.test.tsx` | 14 pass，0 fail，包含上述 10 个在批量运行中失败的用例。这些批量失败现已修复，详见下文。 |
| 单独运行 `src/chat/useAgentHistoryView.test.tsx` | 3 pass，0 fail。 |
| `bun test scripts/bundled-personas.test.ts` | 最终代码生产构建通过；3 项资产/生产包检查通过，22 次断言。此测试内部运行构建。 |
| `git diff --check` | 通过。 |

浏览器验证使用真实的独立 chat/settings 入口，临时 IPC/本地接口提供合成数据；未加载 ZIP 的 webAdapter，聊天窗口未加载 settings.css。

- 对话窗口边界 420×560；Dark、Mint、Peach、Lavender 四种主题均无根容器横向溢出。
- 长代码保留内部横向滚动，表格未撑宽气泡；历史会话可打开，输入框可编辑。
- 附件与发送按钮均为 36px，垂直中心差为 0；附件错误提示出现时也检查了对齐。
- 输入框内部可用文本高度为 36px，完整容纳两行 18px 文本。
- 设置窗口边界 720×520；中英文通用页无纵向滚动，四个主题名称无横向溢出；英文深色和薰衣草主题另有截图。
- 无更新时底栏仅显示 v0.4.7；更新下载条件行为由现有测试覆盖。

本地交接截图与日志位于 `output/yume-latest-review/`，不进入应用生产包。浏览器截图不能证明 Windows WebView2/macOS WKWebView 下的原生透明、拖拽、缩放或 GPU 性能；后续已完成下述 macOS 原生测试应用检查；Windows 实机、签名公证安装包与系统缩放验收仍未完成。减少模糊层数也不等同于已测得性能提升。

## 后续建议

1. 继续按目录运行测试，保持模拟接口在用例开始前明确绑定；不要依赖辅助文件第一次被发现的顺序。此次已修复附件发送测试辅助文件的绑定问题。
2. 后续给 Gemini 提供最新提交号与差异文件，要求交付 diff 和真实测试日志，避免旧工程整包覆盖。
3. 在独立窗口验证设计，覆盖窄窗口、长文本、四主题、中文/英文及附件提示；聚合展示页只用于设计沟通。
4. 发布前在 macOS、Windows 各检查一次原生拖拽/关闭、焦点、系统缩放和透明背景，确认材质可读性，再评估是否需要原生 Vibrancy/Mica。

## 后续：测试隔离修复

`chatAttachmentSendHarness.test.tsx` 同时被测试发现机制和其他测试导入。它初次加载时注册的 Tauri 模块模拟，可以在真正运行用例前被别的文件覆盖。`invoke.mockReset()` 只重置本地模拟函数，不能将模块当前导出的 invoke 指回它；因此用例有时读取了另一组默认设置和历史/Agent 接口。

修复在 `beforeEach` 中重新绑定 core、event 和文件夹选择器模拟，然后重置每个用例的数据；保留真实 ChatApp 和原有行为断言，不通过跳过用例或增加等待时间规避失败。

针对性重现命令：

```sh
bun test ./src/chat/chatAttachmentSendHarness.test.tsx ./src/chat/chatAttachmentFlow.test.tsx ./src/chat/chatAttachmentSend.test.tsx
```

在未修改 main 快照上为 **9 pass、10 fail**，修复后为 **19 pass、0 fail**。完整设置/公共库/对话组合为 **663 pass、0 fail**；生产与测试 TypeScript 检查通过。

## 后续：macOS 原生窗口检查

使用当前前端构建独立 `YUME UI QA.app`，应用标识及数据目录与正式版分离，包含真实 Tauri/WKWebView 窗口。该应用仅作本机测试，采用临时本地签名，未公证或作为正式安装包发布。Rust 编译存在已有的未使用代码等警告，构建成功不代表零警告。

已确认：

- 720×520 设置窗口中，通用设置和四个主题完整显示；深色、薰衣草主题截图已保存。
- Cmd+8 切换关于页，Cmd+1 返回通用页；Tab 焦点依次移动，焦点描边可见。
- 420×560 聊天窗口中，中英文混合两行草稿完整显示，附件与发送按钮对齐。
- 聊天和设置关闭后应用继续运行；经桌宠重开聊天，草稿保持，设置主题同步至聊天；聊天内可重新打开设置。
- 仅编辑合成草稿，未调用模型发送测试消息。

未完成：标题栏拖拽自动化返回 `windowNotFoundAtPosition`，不能作为拖拽通过或应用缺陷的证据，需要人工拖动确认。Windows WebView2、不同系统缩放、原生桌面模糊与 GPU 性能仍待实机验收。

截图位于 `output/yume-latest-review/native-macos/`。
