param(
  [string]$TagName = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

function Read-JsonFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Required file not found: $Path"
  }

  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Read-CargoVersion([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Required file not found: $Path"
  }

  $content = Get-Content -LiteralPath $Path -Raw
  $match = [regex]::Match($content, '(?m)^\[package\]\s+name\s*=\s*"deskmate"\s+version\s*=\s*"(?<version>[^"]+)"')
  if (-not $match.Success) {
    $match = [regex]::Match($content, '(?m)^version\s*=\s*"(?<version>[^"]+)"')
  }
  if (-not $match.Success) {
    throw "Could not read Cargo package version from $Path"
  }

  return $match.Groups["version"].Value
}

function Assert-SemVer([string]$Value, [string]$Name) {
  if ($Value -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$') {
    throw "$Name must be semantic version, got '$Value'"
  }
}

$tauri = Read-JsonFile (Join-Path $root "src-tauri\tauri.conf.json")
$package = Read-JsonFile (Join-Path $root "package.json")
$cargoVersion = Read-CargoVersion (Join-Path $root "src-tauri\Cargo.toml")

$version = [string]$tauri.version
Assert-SemVer $version "src-tauri\tauri.conf.json version"

if ($null -eq $tauri.app.security.csp) {
  throw "Production CSP must be configured in src-tauri\tauri.conf.json"
}

$debugWindows = @($tauri.app.windows | Where-Object {
  [string]$_.additionalBrowserArgs -match '(?i)(^|\s)--remote-debugging-(port|pipe)(=|\s|$)'
})
if ($debugWindows.Count -gt 0) {
  throw "Production windows must not enable WebView remote debugging"
}

if ([string]$package.version -ne $version) {
  throw "Version mismatch: package.json=$($package.version), tauri.conf.json=$version"
}

if ($cargoVersion -ne $version) {
  throw "Version mismatch: Cargo.toml=$cargoVersion, tauri.conf.json=$version"
}

if ($TagName) {
  if ($TagName -notmatch '^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$') {
    throw "Tag must look like v$version, got '$TagName'"
  }

  $tagVersion = $TagName.Substring(1)
  if ($tagVersion -ne $version) {
    throw "Version mismatch: tag=$TagName, app version=$version"
  }
}

Write-Host "version-ok: $version"
