param(
  [ValidateSet('preflight','build','launch','status','stop','purge')][string]$Action = 'preflight',
  [string]$FixtureBaseUrl = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $repoRoot
$identity = 'com.deskmate.worklogqa'
$evidence = Join-Path $repoRoot '.omo/evidence/worklog-natural-recall-qa'
$configPath = Join-Path $PSScriptRoot 'tauri.qa.conf.json'
$buildReceipt = Join-Path $evidence 'build-receipt.json'
$runReceipt = Join-Path $evidence 'run-receipt.json'
$binaryPath = Join-Path $repoRoot 'src-tauri/target/debug/yume.exe'
$roots = @((Join-Path ([Environment]::GetFolderPath('ApplicationData')) $identity), (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) $identity))
function Save-Json($path, $value) { $value | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath $path -Encoding UTF8 }
function Read-Json($path) { Get-Content -LiteralPath $path -Raw | ConvertFrom-Json }
function File-Hash($path) { $stream = [IO.File]::OpenRead([IO.Path]::GetFullPath($path)); $hash = [Security.Cryptography.SHA256]::Create(); try { [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','') } finally { $stream.Dispose(); $hash.Dispose() } }
function Source-Hashes {
  $paths = @(& rg --files --no-ignore src src-tauri/src src-tauri/resources public scripts/worklog-qa)
  $paths += @('src-tauri/Cargo.toml','src-tauri/Cargo.lock','src-tauri/tauri.conf.json','package.json','bun.lock','vite.config.ts','tsconfig.json','pet.html','chat.html','settings.html')
  @($paths | Sort-Object -Unique | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | ForEach-Object { [ordered]@{ path = $_; sha256 = (File-Hash $_) } }) | ConvertTo-Json -Compress
}
function Assert-Guards {
  $lib = Get-Content src-tauri/src/lib.rs -Raw
  $settings = Get-Content src-tauri/src/settings.rs -Raw
  if ($lib -notmatch 'validate_worklog_qa_identity\(&handle\)\?' -or $lib -notmatch 'all\(windows, not\(feature = "worklog-qa"\)\)' -or $settings -notmatch 'KEYRING_SERVICE: &str = "com.deskmate.worklogqa"') { throw 'Required compile-time isolation guards are absent.' }
  $config = Read-Json $configPath
  if ($config.identifier -ne $identity) { throw 'Refusing non-QA identity.' }
  foreach ($root in $roots) {
    if ([IO.Path]::GetFileName($root) -ne $identity) { throw 'Invalid QA root.' }
    if ((Test-Path -LiteralPath $root) -and ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'QA root is a reparse point.' }
  }
}
function Owned-Processes($receipt) {
  $all = @(Get-CimInstance Win32_Process)
  $owned = @($receipt.processes)
  foreach ($known in $owned) {
    $current = $all | Where-Object { $_.ProcessId -eq $known.pid }
    if ($current -and $current.CreationDate.ToUniversalTime() -ne ([datetime]$known.created).ToUniversalTime()) { throw "PID reused: $($known.pid)" }
  }
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($candidate in $all) {
      if ($candidate.ProcessId -in @($owned.pid)) { continue }
      $parent = $owned | Where-Object { $_.pid -eq $candidate.ParentProcessId }
      if ($parent -and $candidate.CreationDate.ToUniversalTime() -ge ([datetime]$parent.created).ToUniversalTime()) {
        $owned += [pscustomobject]@{ pid=$candidate.ProcessId; created=$candidate.CreationDate.ToUniversalTime().ToString('o'); executable=$candidate.ExecutablePath }
        $changed = $true
      }
    }
  }
  return @($owned)
}
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
switch ($Action) {
  'preflight' {
    Assert-Guards
    Save-Json (Join-Path $evidence 'preflight-hashes.json') (Source-Hashes | ConvertFrom-Json)
    [ordered]@{ identity=$identity; roots=@($roots | ForEach-Object { @{path=$_;exists=(Test-Path -LiteralPath $_)} }); hashes='preflight-hashes.json'; launched=$false } | ConvertTo-Json -Depth 5
  }
  'build' {
    Assert-Guards
    $before = Source-Hashes
    & bun run tauri build --debug --no-bundle --features worklog-qa --config $configPath
    if ($LASTEXITCODE -ne 0) { throw 'QA build failed.' }
    if ($before -ne (Source-Hashes)) { throw 'Sources changed during build; rebuild after changes settle.' }
    Save-Json $buildReceipt ([ordered]@{ identity=$identity; binary=$binaryPath; sha256=(File-Hash $binaryPath); sourceHashes=$before; created=[DateTime]::UtcNow.ToString('o') })
  }
  'launch' {
    Assert-Guards
    $build = Read-Json $buildReceipt
    if ($build.identity -ne $identity -or $build.binary -ne $binaryPath -or $build.sha256 -ne (File-Hash $binaryPath) -or $build.sourceHashes -ne (Source-Hashes)) { throw 'Build receipt is stale or not QA.' }
    $uri = [uri]$FixtureBaseUrl
    if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'http' -or $uri.Host -ne '127.0.0.1' -or $uri.Port -lt 1024) { throw 'Fixture must be an explicit loopback HTTP URL on an unprivileged port.' }
    $catalog = Invoke-RestMethod -Uri ($FixtureBaseUrl.TrimEnd('/') + '/models') -TimeoutSec 5
    if ('model-a' -notin @($catalog.data.id)) { throw 'Synthetic model-a fixture is not ready.' }
    if (Test-Path -LiteralPath $runReceipt) {
      $previous = Read-Json $runReceipt
      if ($previous.identity -ne $identity -or ($previous.roots -join '|') -ne ($roots -join '|')) { throw 'Unexpected previous run ownership.' }
      if (@(Owned-Processes $previous | Where-Object { Get-Process -Id $_.pid -ErrorAction SilentlyContinue }).Count) { throw 'Previous QA process remains alive.' }
    } else {
      foreach ($root in $roots) { if (Test-Path -LiteralPath $root) { throw "Preexisting unowned QA data: $root" } }
    }
    $receipt = [ordered]@{ identity=$identity; roots=$roots; fixtureBaseUrl=$FixtureBaseUrl; fixtureOwnership='external probe worker'; buildSha256=$build.sha256; processes=@(); started=[DateTime]::UtcNow.ToString('o'); runtimeDataRetained=$true }
    Save-Json $runReceipt $receipt
    $app = Start-Process -FilePath $binaryPath -WorkingDirectory (Split-Path $binaryPath) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $evidence 'app.stdout.log') -RedirectStandardError (Join-Path $evidence 'app.stderr.log')
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($app.Id)"
    if (-not $processInfo) { throw 'QA application exited before process registration; inspect stderr.' }
    $receipt.processes = @(@{pid=$app.Id;created=$processInfo.CreationDate.ToUniversalTime().ToString('o');executable=$processInfo.ExecutablePath})
    Save-Json $runReceipt $receipt
    Write-Output "QA PID $($app.Id) launched. Configure only synthetic model-a at $FixtureBaseUrl through QA UI. Run status before and after each scenario."
  }
  'status' {
    $receipt = Read-Json $runReceipt
    $receipt.processes = @(Owned-Processes $receipt)
    Save-Json $runReceipt $receipt
    $ports = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -in @($receipt.processes.pid) } | Select-Object LocalAddress,LocalPort,OwningProcess)
    [ordered]@{ processes=$receipt.processes; ports=$ports; roots=$receipt.roots } | ConvertTo-Json -Depth 5
  }
  'purge' {
    Assert-Guards
    $receipt = Read-Json $runReceipt
    if ($receipt.identity -ne $identity -or ($receipt.roots -join '|') -ne ($roots -join '|')) { throw 'Unexpected root ownership.' }
    if (@(Owned-Processes $receipt | Where-Object { Get-Process -Id $_.pid -ErrorAction SilentlyContinue }).Count) { throw 'Stop all owned QA processes before purging.' }
    foreach ($root in $roots) {
      if (-not (Test-Path -LiteralPath $root)) { continue }
      $links = @(Get-ChildItem -LiteralPath $root -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
      if ($links.Count) { throw 'Refusing recursive cleanup containing reparse points.' }
      Remove-Item -LiteralPath $root -Recurse -Force
    }
    Save-Json (Join-Path $evidence 'data-cleanup-receipt.json') @{ removedRoots=$roots; credentials='Synthetic keyring entries require separate QA UI cleanup receipt'; exports='Only exact export receipt filenames may be separately removed'; completed=[DateTime]::UtcNow.ToString('o') }
    Write-Output 'Owned QA runtime roots removed; evidence retained. Verify separate synthetic credential/export cleanup receipts.'
  }
  'stop' {
    $receipt = Read-Json $runReceipt
    $receipt.processes = @(Owned-Processes $receipt)
    Save-Json $runReceipt $receipt
    foreach ($owned in @($receipt.processes | Sort-Object created -Descending)) {
      $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($owned.pid)"
      if ($current) {
        if ($current.CreationDate.ToUniversalTime() -ne ([datetime]$owned.created).ToUniversalTime()) { throw 'Refusing reused PID.' }
        Stop-Process -Id $owned.pid -Force
      }
    }
    $remaining = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -in @($receipt.processes.pid) })
    Save-Json (Join-Path $evidence 'cleanup-receipt.json') @{ stoppedProcesses=$receipt.processes; remainingOwnedPorts=$remaining; runtimeDataRetained=$true; fixtureOwnership='external probe worker'; completed=[DateTime]::UtcNow.ToString('o') }
    if ($remaining.Count) { throw 'Owned ports still open.' }
    Write-Output 'Owned QA processes stopped. Runtime data intentionally retained for restart/readback; fixture remains owned by probe worker.'
  }
}
