param(
  [Parameter(Mandatory=$true)][int]$Hwnd,
  [Parameter(Mandatory=$true)][string]$Output
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NativeWindowCapture {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
}
'@
$rect = New-Object NativeWindowCapture+RECT
if (-not [NativeWindowCapture]::GetWindowRect([IntPtr]$Hwnd, [ref]$rect)) { throw "GetWindowRect failed." }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -lt 20 -or $height -lt 20) { throw "Window rectangle is too small." }
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
  $parent = Split-Path -Parent $Output
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  $bitmap.Save($Output, [System.Drawing.Imaging.ImageFormat]::Png)
  $file = Get-Item -LiteralPath $Output
  [ordered]@{ path=$file.FullName; bytes=$file.Length; hwnd=$Hwnd; width=$width; height=$height; capturedAt=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Depth 4
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}
