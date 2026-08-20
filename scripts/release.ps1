# Build deskmate with signed updater artifacts and generate a GitHub Releases
# latest.json manifest for local publishing.
#
# Usage:
#   powershell -File scripts\release.ps1 [-Repo "clxgame/deskmate"] [-Tag "v0.1.1"] [-Password "..."]
#
# The signing key is read from TAURI_SIGNING_PRIVATE_KEY first, then
# %USERPROFILE%\.tauri\deskmate.key. The signing password must be supplied by
# -Password or TAURI_SIGNING_PRIVATE_KEY_PASSWORD.

param(
  [string]$Repo = "clxgame/deskmate",
  [string]$Tag = "",
  [string]$Password = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$checkArgs = @{}
if ($Tag) {
  $checkArgs["TagName"] = $Tag
}
& (Join-Path $PSScriptRoot "check-version.ps1") @checkArgs

if ($Repo -notmatch '^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$') {
  throw "Repo must be owner/name, got '$Repo'"
}

if ([string]::IsNullOrWhiteSpace($Password)) {
  throw "TAURI_SIGNING_PRIVATE_KEY_PASSWORD is required; pass -Password or set the environment variable"
}

$keyPath = Join-Path $env:USERPROFILE ".tauri\deskmate.key"
$privateKey = $env:TAURI_SIGNING_PRIVATE_KEY
if ([string]::IsNullOrWhiteSpace($privateKey)) {
  if (-not (Test-Path -LiteralPath $keyPath)) {
    throw "TAURI_SIGNING_PRIVATE_KEY is required or signing key must exist at $keyPath"
  }
  $privateKey = (Get-Content -LiteralPath $keyPath -Raw).Trim()
}

if ([string]::IsNullOrWhiteSpace($privateKey)) {
  throw "TAURI_SIGNING_PRIVATE_KEY is empty"
}

Write-Host "==> Building with signing..." -ForegroundColor Cyan
$env:TAURI_SIGNING_PRIVATE_KEY = $privateKey.Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $Password

Push-Location $root
try {
  bun run tauri build
  if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
} finally {
  Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
  Pop-Location
}

Write-Host "==> Generating latest.json..." -ForegroundColor Cyan
$conf = Get-Content (Join-Path $root "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$version = $conf.version
$tag = if ($Tag) { $Tag } else { "v$version" }

$nsisDir = Join-Path $root "src-tauri\target\release\bundle\nsis"
$installer = "deskmate_${version}_x64-setup.exe"
$installerPath = Join-Path $nsisDir $installer
$sigPath = Join-Path $nsisDir "$installer.sig"
if (-not (Test-Path -LiteralPath $installerPath)) {
  throw "Installer not found: $installerPath"
}
if (-not (Test-Path -LiteralPath $sigPath)) {
  throw "Signature not found: $sigPath"
}
$sig = (Get-Content -LiteralPath $sigPath -Raw).Trim()
$asset = [ordered]@{
  signature = $sig
  url       = "https://github.com/$Repo/releases/download/$tag/$installer"
}

$manifest = [ordered]@{
  version   = $version
  notes     = ""
  pub_date  = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64"      = $asset
    "windows-x86_64-nsis" = $asset
  }
}
$manifestJson = $manifest | ConvertTo-Json -Depth 5
$manifestPath = Join-Path $nsisDir "latest.json"
Set-Content -LiteralPath $manifestPath -Value $manifestJson -Encoding UTF8

Write-Host ""
Write-Host "=== Done. Release artifacts ===" -ForegroundColor Green
Write-Host "installer: $nsisDir\$installer"
Write-Host "signature: $nsisDir\$installer.sig"
Write-Host "manifest:  $nsisDir\latest.json"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Create a GitHub release tagged '$tag' in $Repo"
Write-Host "  2. Upload all three files above as release assets"
Write-Host "  3. In the app: 设置 -> 关于 -> 更新仓库 填 '$Repo'"
