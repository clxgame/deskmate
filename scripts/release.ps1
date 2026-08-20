# Build deskmate with signed updater artifacts and generate the latest.json
# manifest for GitHub Releases.
#
# Usage:
#   powershell -File scripts\release.ps1 -Repo "owner/deskmate" [-Tag "v0.1.1"] [-Password "deskmate"]
#
# The signing key is read from ~\.tauri\deskmate.key (keep it secret!).

param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [string]$Tag = "",
  [string]$Password = "deskmate"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$keyPath = Join-Path $env:USERPROFILE ".tauri\deskmate.key"
if (-not (Test-Path $keyPath)) {
  throw "Signing key not found at $keyPath"
}

Write-Host "==> Building with signing..." -ForegroundColor Cyan
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $keyPath -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $Password

$bun = Join-Path $env:APPDATA "npm\node_modules\bun\bin\bun.exe"
Push-Location $root
try {
  & $bun run tauri build
  if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
} finally {
  Pop-Location
}

Write-Host "==> Generating latest.json..." -ForegroundColor Cyan
$conf = Get-Content (Join-Path $root "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$version = $conf.version
$tag = if ($Tag) { $Tag } else { "v$version" }

$nsisDir = Join-Path $root "src-tauri\target\release\bundle\nsis"
$installer = "deskmate_${version}_x64-setup.exe"
$sigPath = Join-Path $nsisDir "$installer.sig"
if (-not (Test-Path $sigPath)) {
  throw "Signature not found: $sigPath"
}
$sig = (Get-Content $sigPath -Raw).Trim()

$manifest = [ordered]@{
  version   = $version
  notes     = ""
  pub_date  = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = $sig
      url       = "https://github.com/$Repo/releases/download/$tag/$installer"
    }
  }
}
$manifestJson = $manifest | ConvertTo-Json -Depth 5
$manifestPath = Join-Path $nsisDir "latest.json"
Set-Content -Path $manifestPath -Value $manifestJson -Encoding UTF8

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
