param([string]$RunDir)
$bunExe = "C:\Users\chenglingxiao\AppData\Roaming\npm\node_modules\bun\bin\bun.exe"
$repo = "E:\Codex\工作伙伴\deskmate-public-release"
$absRun = Join-Path $repo $RunDir
New-Item -ItemType Directory -Path $absRun -Force | Out-Null
$proc = Start-Process -FilePath $bunExe -ArgumentList @("scripts/workbench-qa/provider.ts", $absRun) -WorkingDirectory $repo -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $absRun "provider.stdout.log") -RedirectStandardError (Join-Path $absRun "provider.stderr.log")
Start-Sleep -Seconds 4
[ordered]@{
  pid = $proc.Id
  exited = $proc.HasExited
  stdout = (Get-Content (Join-Path $absRun "provider.stdout.log") -Raw -ErrorAction SilentlyContinue)
  stderr = (Get-Content (Join-Path $absRun "provider.stderr.log") -Raw -ErrorAction SilentlyContinue)
  receipt = (Get-Content (Join-Path $absRun "provider-receipt.json") -Raw -ErrorAction SilentlyContinue)
} | ConvertTo-Json -Depth 4
