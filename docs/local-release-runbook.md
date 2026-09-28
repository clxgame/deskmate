# 本机“保存提交 push，发布新版本”指南

供 AI 和维护者直接执行。适用：`/Users/xiao/my-project/deskmate`，Apple Silicon Mac，仓库 `clxgame/deskmate`。
机器配置最近验证：2026-09-28，成功发布 [v0.4.14](https://github.com/clxgame/deskmate/releases/tag/v0.4.14)。**下次版本号、commit、run ID 必须重新确定**，不能复用历史值。

用户要求完整发布时，执行到公开 Release 并验证为止；不要在找到签名、CI 变绿或上传草稿后停下。仅要求写指南时不执行发布。
本指南记录配置与步骤，不代替当前用户授权或工具权限检查。沿用当前任务已有授权，不逐步重复询问；如果工具审批明确拒绝 Apple 上传等操作，报告被拒操作和原因，只补充必要授权，不绕过拒绝。

## 1. 已有配置：先使用，别重新找

| 项目 | 本机已验证值 / 使用方式 |
| --- | --- |
| Developer ID Application SHA-1 | `8CE4AD2A3B4708521651A886690740A1FE9AFE36` |
| Apple Team ID | `Z7ZCH9BL58` |
| 签名证书与配对私钥 | 登录钥匙串；`codesign` 已可使用。证书到期日 2031-09-15，仍需当次预检 |
| 公证 profile | `yume-notary`，iCloud 钥匙串同步；使用 `--keychain-profile yume-notary`，不要指定登录钥匙串文件 |
| GitHub CLI | `gh`，账户 `clxgame`，凭据在系统 keyring；远端为 `ssh://git@ssh.github.com:443/clxgame/deskmate.git` |
| Tauri updater 私钥 | 仓库 Actions secrets：`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；本机选 `MACOS_UPDATER_SIGNING=github-actions` |
| Apple 工具链 | `DEVELOPER_DIR=/Library/Developer/CommandLineTools`，仅对当前进程生效 |
| Bun | CI 固定 `1.3.14`；本机已验证 `/private/tmp/yume-bun-1.3.14/package/bin/bun`，临时目录可能被清理，先检查 |
| Rust / gh | `/opt/homebrew/bin`；本机 Cargo 来自 Homebrew，不能假定 `~/.cargo/bin` 存在。CI Rust 版本以 workflow 为准 |

SHA-1、Team ID、profile 名是标识符，不是秘密。不要导出证书私钥、读取密码、运行 `gh auth token` 或 `security ... -w/-g`，也不要输出全量环境变量。GUI 钥匙串排查和重建凭据不是日常发布步骤。

### 只读预检的执行权限

**Codex 沙箱内的钥匙串结果可能是假阴性。** `security` 返回 `0 valid identities found`、`codesign` 报 `no identity found`、notarytool 报钥匙串参数无效、`gh auth status` 报 token invalid，在本机都曾由沙箱导致。

以下预检通过 `exec_command` 的 `sandbox_permissions: "require_escalated"` 执行，理由写明“只读核验本机已有发布身份与认证，不读取密钥内容”。网络、钥匙串相关发布命令也使用具备相应权限的上下文。先做这一步，成功后就继续；不要先扫全盘、重新登录或要求用户提供证书。

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
/usr/bin/security find-identity -v -p codesigning
xcrun notarytool history --keychain-profile yume-notary --no-progress --output-format json
gh auth status
```

通过条件：指定 SHA-1 是有效 identity；notarytool 成功读取历史；gh 已登录目标账户。预检失败先看执行权限、网络和钥匙串锁定状态；只有具备正确权限的查询仍失败，才针对缺失项排查。不要改钥匙串 ACL 或强制信任证书。

### 工具链预检（Bash）

```bash
set -euo pipefail
cd /Users/xiao/my-project/deskmate
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
export PATH="/opt/homebrew/bin:$PATH"
if ! command -v bun >/dev/null; then
  test -x /private/tmp/yume-bun-1.3.14/package/bin/bun
  export PATH="/private/tmp/yume-bun-1.3.14/package/bin:$PATH"
fi
bun --version
cargo --version
gh --version
release_sdk="$(xcrun --sdk macosx --show-sdk-path)"
test -f "$release_sdk/usr/include/c++/v1/memory"
export CXXFLAGS="-isysroot $release_sdk -isystem $release_sdk/usr/include/c++/v1"
clang++ -isysroot "$release_sdk" -isystem "$release_sdk/usr/include/c++/v1" -x c++ -fsyntax-only - <<'CPP'
#include <memory>
int main() { auto value = std::make_unique<int>(1); return *value - 1; }
CPP
export MACOS_SIGNING_IDENTITY=8CE4AD2A3B4708521651A886690740A1FE9AFE36
export MACOS_NOTARY_PROFILE=yume-notary
export MACOS_UPDATER_SIGNING=github-actions
export MACOS_RELEASE_CACHE="$PWD/output/macos-release-cache"
```

以上命令按 Bash 执行（工具调用可指定 `shell: "/bin/bash", login: false`）；下一次独立工具调用不会继承上次 export，必须重设环境或加载下文 `context.sh`。若 Bun 路径已失效，依据 workflow 固定版本准备局部工具，不把旧临时目录永久视为有效。当前不依赖本机 PowerShell。

本机默认完整 Xcode 曾提示许可证未接受；用上面的 `DEVELOPER_DIR` 即可，无需 `sudo xcodebuild -license` 或修改 `xcode-select`。TagLib 构建曾报 `<memory>` 缺失：仅设 `SDKROOT` 不够，必须保留上述 C++ SDK 头文件参数。动态 SDK 路径及编译预检已在本机验证。

## 2. 核对改动、版本与测试

1. `git status --short --branch`、`git diff --stat`、`git diff`；检查未跟踪文件和暂存区。保留用户改动，遵循“全部保存”的范围，排除凭据与生成物，不用 `git add -f` 绕过忽略规则。
2. 查看 `gh release list --repo clxgame/deskmate --limit 10`、远端 tags、当前版本和未完成草稿。已有本次发布记录时续跑，不重复升版。否则按用户指定版本；未指定通常取下一 patch。不要覆盖/移动已发布 tag，也不要假定当前分支必然是 main。
3. 同步 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 中 **yume 自身**的版本、`src-tauri/tauri.conf.json`；写 `docs/release-v<version>.md`。不要替换依赖包恰巧相同的版本号。
4. 运行改动所需测试、`bun run typecheck`、`bun run build`；应用发布运行 `bun test` 和 `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib`，按真实输出记录成功数、失败数和忽略项。端口监听/网络被沙箱阻止时，用适当权限重跑受影响检查；其他失败须调查并记录处理结论，不能沿用旧版的失败记录自动放行。

本机无需为了版本检查先安装 PowerShell。Bun 可核对四处版本（CI 仍会执行 `scripts/check-version.ps1` 的生产配置检查）：

```bash
release_version="$(bun -p 'require("./package.json").version')"
[[ "$release_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
bun - "$release_version" <<'JS'
import assert from "node:assert/strict";
const version = process.argv[2];
const pkg = await Bun.file("package.json").json();
const tauri = await Bun.file("src-tauri/tauri.conf.json").json();
const cargo = Bun.TOML.parse(await Bun.file("src-tauri/Cargo.toml").text());
const lock = Bun.TOML.parse(await Bun.file("src-tauri/Cargo.lock").text());
const app = lock.package.filter(p => p.name === "yume");
assert.equal(app.length, 1);
for (const actual of [pkg.version, tauri.version, cargo.package.version, app[0].version]) {
  assert.equal(actual, version);
}
console.log(`version-ok: ${version}`);
JS
git diff --check
```

从这里开始保留发布上下文，避免换 shell / 会话压缩后丢失进度。在第 1 节同一 Bash 环境中：

```bash
release_repo=clxgame/deskmate
release_tag="v$release_version"
release_checkout="$PWD"
mkdir -p output/releases
release_root="$(mktemp -d "$PWD/output/releases/${release_tag}.XXXXXX")"
declare -p DEVELOPER_DIR PATH CXXFLAGS MACOS_SIGNING_IDENTITY MACOS_NOTARY_PROFILE \
  MACOS_UPDATER_SIGNING MACOS_RELEASE_CACHE release_repo release_version \
  release_tag release_checkout release_root > "$release_root/context.sh"
printf '%s\n' "$release_root/context.sh"
```

记录打印出的绝对路径。后续新 Bash 调用先 `set -euo pipefail`、`source <该绝对路径>`、`cd "$release_checkout"`。`context.sh` 只保存上述非秘密变量；不要用 `env > file`。在同目录写 `state.md`，逐阶段记 commit、run ID、output 路径、submission ID、验证结果和下一步；`output/` 已被 Git 忽略，不提交状态文件。

## 3. 提交与推送 tag

确定测试结论、目标分支和暂存内容后提交。下面假设核对后的发布分支是 `main`；其他分支先按实际合并/发布流程处理，不强制切换或覆盖用户改动。

```bash
git add -A
git diff --cached --stat
git diff --cached --check
# 检查暂存内容确实只有准备发布的源代码、资源和文档后，再执行以下命令。
git commit -m "release: prepare $release_tag"
release_commit="$(git rev-parse HEAD)"
declare -p release_commit >> "$release_root/context.sh"
git tag -a "$release_tag" -m "YUME $release_tag" "$release_commit"
git push --atomic origin main "$release_tag"
```

Git 写入或网络被当前沙箱限制时走工具权限申请。push 被拒先查远端差异，保留本地工作，不 force push。如果 tag 已存在，验证其解引用 commit 是否与本次一致，再决定续跑，绝不无条件重建 tag。推送后核对远端 main/tag 指向与本次 commit 一致。

## 4. CI 候选包与下载

```bash
gh run list --repo "$release_repo" --workflow release.yml --commit "$release_commit" \
  --limit 10 --json databaseId,headSha,event,status,conclusion,url
```

选择本次 tag push 对应、`headSha == release_commit` 的 run，记录为 `release_run_id`，用 `declare -p release_run_id >> "$release_root/context.sh"` 保存。不要仅取列表第一条，也不要沿用上次 run ID。

```bash
gh run view "$release_run_id" --repo "$release_repo" --json status,conclusion,jobs,url
```

流程为 draft → Windows 和 macOS 并行构建。Mac job 成功后可以先下载并本机签名，Windows 可继续构建；写最终清单前必须等 Windows 成功。CI 只生成未签名候选包，不代表可公开发布。

```bash
mkdir "$release_root/candidate"
gh run download "$release_run_id" --repo "$release_repo" \
  --name "macos-unsigned-$release_commit" --dir "$release_root/candidate"
ditto -x -k "$release_root/candidate/YUME.unsigned.app.zip" "$release_root/input"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
  "$release_root/input/YUME.app/Contents/Info.plist")" = "$release_version"
```

`gh run download` 已解开 Actions 外层 artifact ZIP，得到的 `YUME.unsigned.app.zip` 再用 ditto 解开一次即可。不需要浏览器、临时签名 URL 或额外下载代理。不要运行/公开未签名候选；正常发布也无需重新在本机构建整个 App。

## 5. 本机 Apple 签名、公证、打包

加载 context，在可使用钥匙串和网络的上下文运行：

```bash
release_output="$release_root/signed-1"
declare -p release_output >> "$release_root/context.sh"
test ! -e "$release_output"
bash scripts/release-macos.sh "$release_root/input/YUME.app" "$release_output"
```

脚本负责：校验并构建固定 TagLib/CMake → 修复 ncmdump 外部依赖 → 内到外签名（只有 OpenCode 有 JIT 权限）→ App 提交 Apple、公证 Accepted 并 staple → helper 冒烟测试 → DMG 签名、公证和 staple → ZIP/tar.gz 解包复验。不要手动再造另一套签名打包顺序。

公证分别提交 App 与 DMG；需要向 Apple 发送这些二进制，凭据留在钥匙串。状态证据：

- App：`$release_output/logs/app/{submission,status,notary-log}.json`。
- DMG：`$release_output/downloads/logs/dmg/{submission,status,notary-log}.json`。
- 等待或恢复时，先取已有 submission ID，执行 `xcrun notarytool info <id> --keychain-profile yume-notary --output-format json`；不能把超时当失败后立即重复提交。

完整脚本失败需修复后使用新输出目录（如 `signed-2`），更新 context；输入候选不变。缓存只复用 SHA-256 已验证的源码/工具归档，不能拿修改过的半成品 App 或预编译 dylib 顶替。进程仍在运行时等待原 session，不启动第二份。

此阶段预期输出提示 **awaiting GitHub updater signing**，正常：Apple 签名已完成，Tauri updater 签名还在下一阶段。不要寻找本机 updater 私钥。

## 6. 上传草稿，完成 updater 签名

```bash
bash scripts/upload-macos-payloads.sh "$release_output/downloads" "$release_version" "$release_repo"
gh run view "$release_run_id" --repo "$release_repo" --json status,conclusion,jobs,url
gh release view "$release_tag" --repo "$release_repo" --json isDraft,assets
```

上传脚本复验并上传 DMG、app.zip、app.tar.gz；只接受草稿，重复执行仅复用 digest 相同的资产，冲突即停。使用当前机器的 Actions 签名路径时，不用要求本机 updater 私钥的 `publish-macos.sh`。

确认原 release workflow 成功、草稿中有 Windows EXE / `.sig` / `latest.json` 和三个 Mac payload 后：

```bash
gh workflow run finalize-macos-release.yml --repo "$release_repo" -f version="$release_version"
gh run list --repo "$release_repo" --workflow finalize-macos-release.yml --event workflow_dispatch \
  --limit 10 --json databaseId,headSha,createdAt,status,conclusion,url
```

按刚才 dispatch 的时间、事件和该 run 日志中的目标版本确定 `release_finalize_run_id`，记录并等待成功。有并行发布时不要盲选最新 run。finalizer 的 `headSha` 可是默认分支 commit，它会在 job 内 checkout 目标 tag，不能仅靠 headSha 判断版本。

该 workflow 使用 Actions secret 为 tar.gz 签名、保留 Windows 条目合并 `darwin-aarch64`、写校验和并回读验证。它不是无条件可重入：重复上传 `.sig` 会冲突，已合并清单也不能再次当纯 Windows 输入。失败先查具体完成阶段与远端资产，不直接 rerun、删资产或 `--clobber` 整个草稿。

## 7. 回读最终资产与验收

```bash
mkdir "$release_root/verification"
gh release download "$release_tag" --repo "$release_repo" --dir "$release_root/verification" \
  --pattern "YUME_${release_version}_aarch64.dmg" \
  --pattern "YUME_${release_version}_aarch64.app.zip" \
  --pattern "YUME_${release_version}_aarch64.app.tar.gz" \
  --pattern "YUME_${release_version}_aarch64.app.tar.gz.sig" \
  --pattern SHA256SUMS-macos.txt --pattern latest.json
bash scripts/verify-macos-downloads.sh "$release_root/verification" "$release_version"
```

此校验涵盖校验和、Developer ID、内嵌程序依赖、公证票据、Gatekeeper、DMG 完整性，以及三种归档中 App 内容/版本一致。它不等于真实 GUI 更新已验证；updater 的密码学验签也不能用“`.sig` 非空”替代。

解析下载的 `latest.json`，断言版本、URL 和签名元数据正确：

```bash
bun - "$release_root/verification" "$release_version" "$release_repo" <<'JS'
import assert from "node:assert/strict";
const [dir, version, repo] = process.argv.slice(2);
const manifest = await Bun.file(`${dir}/latest.json`).json();
assert.equal(manifest.version, version);
const base = `https://github.com/${repo}/releases/download/v${version}/`;
const mac = manifest.platforms["darwin-aarch64"];
assert.equal(mac.url, `${base}YUME_${version}_aarch64.app.tar.gz`);
assert.ok(mac.signature.trim());
assert.equal(mac.signature.trim(),
  (await Bun.file(`${dir}/YUME_${version}_aarch64.app.tar.gz.sig`).text()).trim());
for (const target of ["windows-x86_64", "windows-x86_64-nsis"]) {
  const entry = manifest.platforms[target];
  assert.equal(entry.url, `${base}YUME_${version}_x64-setup.exe`);
  assert.ok(entry.signature.trim());
}
console.log(`manifest-ok: ${version}, Mac + Windows`);
JS
```

最终预期 **8 个**资产：

| 平台 / 用途 | 文件 |
| --- | --- |
| Windows | `YUME_<version>_x64-setup.exe`、对应 `.sig` |
| Mac 安装 / 更新 | `YUME_<version>_aarch64.dmg`、`.app.zip`、`.app.tar.gz`、`.app.tar.gz.sig` |
| 元数据 | `SHA256SUMS-macos.txt`、`latest.json` |

按 [runtime checks](macos-runtime-checks.md) 执行打包 App 验收及隔离 A→B 一键升级，保存真实证据。生产客户端读取公开 latest，草稿不会被发现；发布前升级验证要用隔离的 QA 更新源，不能提前公开半成品来代替测试。没有实测必须写“未验证”，不能把单元测试或 helper `--version` 当 GUI 通过，也不能声称前次发行已证明本次结果。发布门槛有未完成项时明确报告具体缺项，不静默绕过。

## 8. 公开发布与完成判定

发布验收满足后，沿用用户“发布新版本”的授权执行：

```bash
test "$(gh release view "$release_tag" --repo "$release_repo" --json isDraft --jq .isDraft)" = true
gh release edit "$release_tag" --repo "$release_repo" --title "YUME $release_tag" \
  --notes-file "docs/release-$release_tag.md"
gh release edit "$release_tag" --repo "$release_repo" --draft=false --latest
gh release view "$release_tag" --repo "$release_repo" \
  --json isDraft,isPrerelease,publishedAt,url,tagName,assets
test "$(gh api "repos/$release_repo/releases/latest" --jq .tag_name)" = "$release_tag"
git ls-remote origin refs/heads/main "refs/tags/$release_tag" "refs/tags/$release_tag^{}"
git status --short --branch
```

确认公开、非 prerelease、latest 指向目标版本、8 个资产完整、远端 tag 解引用为记录的 commit。另从公开 latest 下载链接确认 `latest.json` 已可访问且内容与验收版本一致。`gh release view --json` **没有 `isLatest` 字段**，使用上述 REST 查询。

最后报告版本、Release 链接、commit、验证结果及未完成项，保存阶段记录；不要为了清理删除用户旧安装、`output/`、签名身份或日志。公开后发现问题，另发修复版本，不能重签后覆盖同名公开资产。

## 常见故障与续跑规则

| 现象 | 正确处理 |
| --- | --- |
| 签名身份 0 个 / notary keychain 参数错误 / gh token invalid | 先核验是否在沙箱里，按第 1 节用具备权限的只读命令重试；不立刻宣布缺配置 |
| Xcode license 提示 | 每次新进程补 `DEVELOPER_DIR=/Library/Developer/CommandLineTools` |
| TagLib 编译 `<memory>` not found | 动态 SDK 路径 + `CXXFLAGS` 两个参数，先跑小编译预检；不改系统头文件 |
| `bun: command not found` | 检查上表已知位置和 PATH；临时运行时可能被清理，不重装整套开发环境 |
| 公证等待 / 超时 | 保留 ID，查询原 submission；Accepted 后仍需 staple/validate，不能把 Accepted 当所有打包步骤完成 |
| upload 长时间无输出 | 本机每个约 124–131 MB 资产曾需 4–6 分钟；保留原进程 session，查看完成的远端资产，不并发重复上传 |
| 构建/公证失败后重试 | 新 output 目录，复用已验证归档缓存；不覆盖旧结果，context 记录新路径 |
| `running 0 tests` 但 exit 0 | 不算验证通过；核对真实测试名。Mac updater 定向命令为 `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib updater::macos::tests`（当前 5 项） |
| finalizer 重跑冲突 | 检查 job 日志和草稿最终状态；已有 `.sig` 或 darwin 清单时先核对字节和阶段，不能盲目覆盖 |

耗时命令使用可继续读取的进程 session；每次等待控制在约 30 秒，持续提供有意义的进度。CI 无变化时降低查询频率，不用高频轮询。不要仅因输出安静而中止构建/上传，也不要丢失 session 后从头重跑。
