param([ValidateRange(1,2000)][int]$Count = 1001)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$run = Join-Path $repo ('.omo/evidence/unified-conversation-history/native-scale-' + [guid]::NewGuid().ToString('N'))
$workspace = Join-Path $run 'project-a'
$binary = Join-Path $repo 'src-tauri/resources/opencode/opencode.exe'
New-Item -ItemType Directory -Path $workspace -Force | Out-Null
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()
$password = [guid]::NewGuid().ToString('N')
$environment = @{}
foreach ($name in @('HOME','USERPROFILE','APPDATA','LOCALAPPDATA','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','XDG_STATE_HOME')) {
    $environment[$name] = Join-Path $run $name
    New-Item -ItemType Directory -Path $environment[$name] -Force | Out-Null
}
foreach ($item in Get-ChildItem Env:OPENCODE_*) { $environment[$item.Name] = $null }
$environment['OPENCODE_SERVER_PASSWORD'] = $password
$environment['OPENCODE_CONFIG_CONTENT'] = '{"plugin":[],"permission":"deny"}'
$environment['OPENCODE_DISABLE_PROJECT_CONFIG'] = 'true'
$environment['OPENCODE_DISABLE_DEFAULT_PLUGINS'] = 'true'
$environment['OPENCODE_DISABLE_CLAUDE_CODE'] = 'true'
$environment['OPENCODE_AUTH_CONTENT'] = '{}'
$environment['OPENCODE_TEST_HOME'] = $run
$previous = @{}
try {
    foreach ($name in $environment.Keys) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $environment[$name], 'Process')
    }
    $sidecar = Start-Process -FilePath $binary -ArgumentList @('serve','--port',"$port",'--hostname','127.0.0.1') -WorkingDirectory $workspace -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $run 'stdout.log') -RedirectStandardError (Join-Path $run 'stderr.log')
} finally {
    foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
$started = $sidecar.StartTime.ToUniversalTime()
$headers = @{ Authorization = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('opencode:' + $password)) }
$base = "http://127.0.0.1:$port"
$query = '?directory=' + [uri]::EscapeDataString($workspace)
$results = [Collections.Generic.List[object]]::new()
$ids = [Collections.Generic.HashSet[string]]::new()
try {
    $ready = $false
    foreach ($attempt in 1..80) {
        try {
            $health = Invoke-RestMethod "$base/global/health" -Headers $headers -TimeoutSec 1
            if ($health.healthy) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 250 }
    }
    if (!$ready) { throw 'Synthetic sidecar failed readiness' }
    $unauthorized = Invoke-WebRequest "$base/session$query" -SkipHttpErrorCheck -TimeoutSec 5
    if ($unauthorized.StatusCode -ne 401) { throw 'Unauthenticated native request was not denied' }
    $clock = [Diagnostics.Stopwatch]::StartNew()
    foreach ($index in 1..$Count) {
        $body = @{ title = ('合成历史规模 QA {0:d4}' -f $index) } | ConvertTo-Json -Compress
        $created = Invoke-RestMethod "$base/session$query" -Method Post -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json' -TimeoutSec 10
        if (!$ids.Add($created.id)) { throw 'Duplicate native identity' }
        if (($index % 100) -eq 0) { Write-Output "Created $index synthetic native sessions" }
    }
    $clock.Stop()
    $results.Add(@{ probe='create'; count=$ids.Count; elapsedMs=$clock.ElapsedMilliseconds })
    $limit = 100
    do {
        $clock.Restart()
        $listed = @(Invoke-RestMethod "$base/session$query&roots=true&limit=$limit" -Headers $headers -TimeoutSec 20)
        $clock.Stop()
        $results.Add(@{ probe='list'; limit=$limit; count=$listed.Count; elapsedMs=$clock.ElapsedMilliseconds })
        if ($listed.Count -lt $limit) { break }
        $limit *= 2
    } while ($limit -le 51200)
    if ($listed.Count -ne $Count) { throw "Discovery lost rows: expected $Count, got $($listed.Count)" }
    foreach ($row in $listed) { if (!$ids.Contains($row.id)) { throw 'Unexpected native row outside fixture' } }
    $sample = $listed[0]
    $sampleUrl = "$base/session/$($sample.id)$query"
    $renamed = Invoke-RestMethod $sampleUrl -Method Patch -Headers $headers -Body '{"title":"Unified history user rename"}' -ContentType 'application/json' -TimeoutSec 5
    $readback = Invoke-RestMethod $sampleUrl -Headers $headers -TimeoutSec 5
    if ($renamed.title -ne 'Unified history user rename' -or $readback.title -ne $renamed.title) { throw 'Native rename readback mismatch' }
    $results.Add(@{ probe='rename'; id=$sample.id; title=$readback.title })
    $deleted = Invoke-RestMethod $sampleUrl -Method Delete -Headers $headers -TimeoutSec 5
    $missing = Invoke-WebRequest $sampleUrl -Headers $headers -SkipHttpErrorCheck -TimeoutSec 5
    if (!$deleted -or $missing.StatusCode -ne 404) { throw 'Native delete readback mismatch' }
    $results.Add(@{ probe='delete'; id=$sample.id; readbackStatus=$missing.StatusCode })
    $results.Add(@{ probe='result'; verdict='PASS'; version=$health.version; unauthorized=$unauthorized.StatusCode })
} finally {
    $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($sidecar.Id)"
    if ($current) {
        if ($current.ExecutablePath -ne $binary -or [math]::Abs(($current.CreationDate.ToUniversalTime() - $started).Ticks) -gt 10) { throw 'Refusing to stop a reused or unknown PID' }
        Stop-Process -Id $sidecar.Id -Force
        $sidecar.WaitForExit()
    }
    $remaining = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $sidecar.Id })
    $results.Add(@{ probe='cleanup'; pid=$sidecar.Id; created=$started.ToString('o'); executable=$binary; port=$port; remainingOwnedPorts=$remaining.Count; syntheticRun=$run; workspace=$workspace; dataRetained=$true })
    $results | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $run 'results.json') -Encoding UTF8
    Write-Output "Evidence: $run/results.json"
    if ($remaining.Count) { throw 'Owned sidecar port remained open' }
}
