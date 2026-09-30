param(
  [Parameter(Mandatory=$true)][long]$Hwnd,
  [Parameter(Mandatory=$true)][string]$Output,
  [Parameter(Mandatory=$true)][string]$ReceiptPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$receiptFile = [IO.Path]::GetFullPath($ReceiptPath)
$receipt = Get-Content -LiteralPath $receiptFile -Raw | ConvertFrom-Json
if ($receipt.identity -ne 'com.deskmate.worklogqa' -or @($receipt.processes).Count -eq 0) { throw 'Missing owned worklog QA run receipt.' }
$outputFile = [IO.Path]::GetFullPath($Output)
$evidenceRoot = [IO.Path]::GetDirectoryName($receiptFile).TrimEnd('\') + '\'
if (-not $outputFile.StartsWith($evidenceRoot, [StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $outputFile)) { throw 'Capture must be a new file inside the receipt evidence directory.' }
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NativeWindowCapture {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
}
'@
$all = @(Get-CimInstance Win32_Process)
$owned = @()
foreach ($recorded in @($receipt.processes)) {
  $current = $all | Where-Object { $_.ProcessId -eq $recorded.pid }
  if (-not $current) { continue }
  if ($current.ExecutablePath -ne $recorded.executable -or [math]::Abs(($current.CreationDate.ToUniversalTime() - ([datetime]$recorded.created).ToUniversalTime()).Ticks) -gt 10) { throw 'QA receipt PID was reused.' }
  $owned += $current
}
if ($owned.Count -eq 0) { throw 'Receipt has no live owned QA process.' }
$changed = $true
while ($changed) {
  $changed = $false
  foreach ($candidate in $all) {
    if ($candidate.ProcessId -in @($owned.ProcessId)) { continue }
    $parent = $owned | Where-Object { $_.ProcessId -eq $candidate.ParentProcessId }
    if ($parent -and $candidate.CreationDate.ToUniversalTime() -ge $parent.CreationDate.ToUniversalTime()) { $owned += $candidate; $changed = $true }
  }
}
[uint32]$windowProcess = 0
[void][NativeWindowCapture]::GetWindowThreadProcessId([IntPtr]$Hwnd, [ref]$windowProcess)
if ($windowProcess -eq 0 -or $windowProcess -notin @($owned.ProcessId)) { throw 'Window does not belong to the live receipt-owned QA process tree.' }
if (-not [NativeWindowCapture]::IsWindowVisible([IntPtr]$Hwnd) -or [NativeWindowCapture]::IsIconic([IntPtr]$Hwnd)) { throw 'Capture requires a visible, restored QA window.' }
$rect = New-Object NativeWindowCapture+RECT
if (-not [NativeWindowCapture]::GetWindowRect([IntPtr]$Hwnd, [ref]$rect)) { throw "GetWindowRect failed." }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -lt 20 -or $height -lt 20) { throw "Window rectangle is too small." }
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  # Render the verified HWND rather than pixels belonging to an occluding window.
  # https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-printwindow
  $deviceContext = $graphics.GetHdc()
  try {
    if (-not [NativeWindowCapture]::PrintWindow([IntPtr]$Hwnd, $deviceContext, 0)) { throw 'Owned window rendering failed.' }
  } finally { $graphics.ReleaseHdc($deviceContext) }
  $parent = Split-Path -Parent $outputFile
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  $bitmap.Save($outputFile, [System.Drawing.Imaging.ImageFormat]::Png)
  $file = Get-Item -LiteralPath $outputFile
  [ordered]@{ path=$file.FullName; bytes=$file.Length; hwnd=$Hwnd; pid=$windowProcess; receipt=$receiptFile; width=$width; height=$height; capturedAt=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Depth 4
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}
