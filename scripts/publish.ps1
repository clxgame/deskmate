# Publish the already-built release artifacts to GitHub Releases.
# Requires `gh` to be authenticated (run `gh auth login` once first).
#
# Usage:
#   powershell -File scripts\publish.ps1 [-Repo "clxgame/deskmate"] [-Tag "v0.1.2"]

param(
  [string]$Repo = "clxgame/deskmate",
  [string]$Tag = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if ($Repo -notmatch '^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$') {
  throw "Repo must be owner/name, got '$Repo'"
}

gh auth status *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "gh 未登录。请先运行: gh auth login" -ForegroundColor Red
  exit 1
}

$checkArgs = @{}
if ($Tag) {
  $checkArgs["TagName"] = $Tag
}
& (Join-Path $PSScriptRoot "check-version.ps1") @checkArgs

$conf = Get-Content -LiteralPath (Join-Path $root "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$version = $conf.version
$tag = if ($Tag) { $Tag } else { "v$version" }

$nsisDir = Join-Path $root "src-tauri\target\release\bundle\nsis"
$installer = "deskmate_${version}_x64-setup.exe"
$artifacts = @(
  (Join-Path $nsisDir $installer),
  (Join-Path $nsisDir "$installer.sig"),
  (Join-Path $nsisDir "latest.json")
)

gh repo view $Repo *> $null
if ($LASTEXITCODE -ne 0) {
  throw "GitHub repo does not exist or is inaccessible: $Repo"
}

foreach ($artifact in $artifacts) {
  if (-not (Test-Path -LiteralPath $artifact)) {
    throw "Release artifact not found: $artifact"
  }
  if ((Get-Item -LiteralPath $artifact).Length -le 0) {
    throw "Release artifact is empty: $artifact"
  }
}

$manifestPath = Join-Path $nsisDir "latest.json"
$signaturePath = Join-Path $nsisDir "$installer.sig"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$expectedUrl = "https://github.com/$Repo/releases/download/$tag/$installer"
$signature = (Get-Content -LiteralPath $signaturePath -Raw).Trim()
if ([string]$manifest.version -ne $version) {
  throw "latest.json version mismatch: expected $version"
}
if ([string]::IsNullOrWhiteSpace($signature)) {
  throw "Updater signature is empty"
}
foreach ($platform in @("windows-x86_64", "windows-x86_64-nsis")) {
  $entry = $manifest.platforms.$platform
  if ($null -eq $entry) {
    throw "latest.json missing platform: $platform"
  }
  if ([string]$entry.url -ne $expectedUrl) {
    throw "latest.json URL mismatch for ${platform}: $($entry.url)"
  }
  if ([string]$entry.signature -ne $signature) {
    throw "latest.json signature mismatch for $platform"
  }
}

$releaseJson = gh release view $tag --repo $Repo --json isDraft,url 2>$null
if ($LASTEXITCODE -eq 0) {
  $release = $releaseJson | ConvertFrom-Json
  if (-not $release.isDraft) {
    throw "Release $tag already exists and is not a draft: $($release.url)"
  }

  Write-Host "==> Uploading artifacts to existing draft $tag ..." -ForegroundColor Cyan
  gh release upload $tag --repo $Repo @artifacts --clobber
  if ($LASTEXITCODE -ne 0) { throw "gh release upload failed" }
} else {
  Write-Host "==> Creating draft release $tag ..." -ForegroundColor Cyan
  gh release create $tag --repo $Repo @artifacts --draft --title "deskmate $tag" --notes "deskmate $version"
  if ($LASTEXITCODE -ne 0) { throw "gh release create failed" }
}

Write-Host ""
Write-Host "==> 草稿发布已准备好" -ForegroundColor Green
Write-Host "检查草稿 release 资产后再手动发布；老用户点「检查更新」即可收到 v$version 更新。"
