param(
  [Parameter(Mandatory = $true)][string]$BinaryPath,
  [string]$ExpectedIconPath = (Join-Path $PSScriptRoot '../src-tauri/icons/icon.ico'),
  [string]$PreviewPath = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
if (-not ('YumeIconResourceReader' -as [type])) {
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class YumeIconResourceReader {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, EntryPoint = "ExtractIconExW")]
  public static extern uint Extract(string file, int index, out IntPtr large, out IntPtr small, uint count);
  [DllImport("user32.dll")]
  public static extern bool DestroyIcon(IntPtr icon);
}
'@
}

function Read-IconBitmap([string]$Path) {
  $large = [IntPtr]::Zero
  $small = [IntPtr]::Zero
  $absolute = (Resolve-Path -LiteralPath $Path).Path
  $count = [YumeIconResourceReader]::Extract($absolute, 0, [ref]$large, [ref]$small, 1)
  try {
    if ($count -eq 0 -or $large -eq [IntPtr]::Zero) { throw "No icon resource in $absolute" }
    $icon = [Drawing.Icon]::FromHandle($large)
    try { return $icon.ToBitmap() } finally { $icon.Dispose() }
  } finally {
    if ($large -ne [IntPtr]::Zero) { [void][YumeIconResourceReader]::DestroyIcon($large) }
    if ($small -ne [IntPtr]::Zero) { [void][YumeIconResourceReader]::DestroyIcon($small) }
  }
}

$actual = Read-IconBitmap $BinaryPath
try {
  if ($PreviewPath) {
    $actual.Save([IO.Path]::GetFullPath($PreviewPath), [Drawing.Imaging.ImageFormat]::Png)
  }
  $expected = Read-IconBitmap $ExpectedIconPath
  try {
    if ($actual.Size -ne $expected.Size) { throw 'EXE icon dimensions do not match the configured icon' }
    $different = 0
    for ($y = 0; $y -lt $actual.Height; $y++) {
      for ($x = 0; $x -lt $actual.Width; $x++) {
        if ($actual.GetPixel($x, $y).ToArgb() -ne $expected.GetPixel($x, $y).ToArgb()) { $different++ }
      }
    }
    if ($different -gt 0) { throw "EXE icon mismatch: $different pixels differ from $ExpectedIconPath" }
    Write-Output "PASS: embedded EXE icon matches $ExpectedIconPath ($($actual.Width)x$($actual.Height))"
  } finally { $expected.Dispose() }
} finally { $actual.Dispose() }
