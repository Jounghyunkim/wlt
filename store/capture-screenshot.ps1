<#
  Captures the WLT window as a Store screenshot PNG at an exact size.

  Usage (set up the scene in WLT first):
    powershell -ExecutionPolicy Bypass -File store\capture-screenshot.ps1 -Name 01-split
    ... -Width 1366 -Height 768     # smaller screens

  The window is moved to the top-left corner and resized so its visible area is exactly
  Width x Height (physical pixels), then captured after -Delay seconds.
  Output: store/screenshots/<Name>.png
#>
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [int]$Width = 1920,
  [int]$Height = 1080,
  [int]$Delay = 3
)
$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win {
  public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out RECT rect, int size);
}
"@
# Per-monitor DPI aware v2, so every size below is in physical pixels.
[void][Win]::SetProcessDpiAwarenessContext([IntPtr](-4))
Add-Type -AssemblyName System.Drawing, System.Windows.Forms

$proc = Get-Process wlt -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { throw "WLT is not running (no wlt.exe window found)." }
$hwnd = $proc.MainWindowHandle

$work = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
if ($Width -gt $work.Width -or $Height -gt $work.Height) {
  throw "The screen's working area is $($work.Width)x$($work.Height); $Width x $Height does not fit. Try -Width 1366 -Height 768."
}

function Bounds {
  $r = New-Object Win+RECT
  # DWMWA_EXTENDED_FRAME_BOUNDS = 9: the visible frame, without the invisible resize borders.
  [void][Win]::DwmGetWindowAttribute($hwnd, 9, [ref]$r, [System.Runtime.InteropServices.Marshal]::SizeOf($r))
  $r
}

[void][Win]::ShowWindow($hwnd, 9)  # SW_RESTORE (un-maximize)
[void][Win]::SetWindowPos($hwnd, [IntPtr]::Zero, $work.Left, $work.Top, $Width, $Height, 0x0040)
Start-Sleep -Milliseconds 300
# Grow the outer rect by the invisible borders so the visible frame is exactly Width x Height.
$outer = New-Object Win+RECT
[void][Win]::GetWindowRect($hwnd, [ref]$outer)
$vis = Bounds
$padL = $vis.Left - $outer.Left; $padT = $vis.Top - $outer.Top
$padR = $outer.Right - $vis.Right; $padB = $outer.Bottom - $vis.Bottom
[void][Win]::SetWindowPos($hwnd, [IntPtr]::Zero, $work.Left - $padL, $work.Top - $padT, $Width + $padL + $padR, $Height + $padT + $padB, 0x0040)
[void][Win]::SetForegroundWindow($hwnd)

Write-Host "Capturing in $Delay s ..."
Start-Sleep -Seconds $Delay
$vis = Bounds
$w = $vis.Right - $vis.Left; $h = $vis.Bottom - $vis.Top

$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($vis.Left, $vis.Top, 0, 0, (New-Object System.Drawing.Size $w, $h))
$g.Dispose()

$dir = Join-Path $PSScriptRoot "screenshots"
New-Item -ItemType Directory -Force $dir | Out-Null
$file = Join-Path $dir "$Name.png"
$bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
if ($w -ne $Width -or $h -ne $Height) { Write-Warning "Captured ${w}x${h} instead of ${Width}x${Height}." }
Write-Host "Saved $file (${w}x${h})"
