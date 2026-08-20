# Publish the already-built release artifacts to GitHub Releases.
# Requires `gh` to be authenticated (run `gh auth login` once first).
#
# Usage:
#   powershell -File scripts\publish.ps1 -Repo "clx/deskmate" [-Tag "v0.1.0"]

param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [string]$Tag = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

gh auth status *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "gh 未登录。请先运行: gh auth login" -ForegroundColor Red
  exit 1
}

$conf = Get-Content (Join-Path $root "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$version = $conf.version
$tag = if ($Tag) { $Tag } else { "v$version" }

$nsisDir = Join-Path $root "src-tauri\target\release\bundle\nsis"
$installer = "deskmate_${version}_x64-setup.exe"

# Create the repo if it does not exist.
gh repo view $Repo *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "==> Creating repo $Repo ..." -ForegroundColor Cyan
  gh repo create $Repo --public --confirm
}

Write-Host "==> Creating release $tag ..." -ForegroundColor Cyan
gh release create $tag `
  (Join-Path $nsisDir $installer) `
  (Join-Path $nsisDir "$installer.sig") `
  (Join-Path $nsisDir "latest.json") `
  --title "deskmate $tag" `
  --notes "deskmate $version"

Write-Host ""
Write-Host "==> 发布完成" -ForegroundColor Green
Write-Host "老用户点「检查更新」即可收到 v$version 更新。"
