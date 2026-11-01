# Captures the running KAREN window to a PNG, without a visible desktop.
# PrintWindow asks the window to render itself into our bitmap, so this works
# even when the window is behind others.
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Title = 'KAREN',
  [int]$WaitSeconds = 3
)

Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class Win {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);

  public static int[] Rect(IntPtr h) {
    RECT r;
    GetWindowRect(h, out r);
    return new int[] { r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top };
  }
}
'@

[void][Win]::SetProcessDPIAware()

$deadline = (Get-Date).AddSeconds([Math]::Max(1, $WaitSeconds))
$proc = $null
while ((Get-Date) -lt $deadline) {
  $proc = Get-Process -Name KAREN, electron -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle -like "*$Title*" } |
    Select-Object -First 1
  if ($proc) { break }
  Start-Sleep -Milliseconds 250
}

if (-not $proc) { throw "no window titled like '$Title' found" }

$h = $proc.MainWindowHandle
$rect = [Win]::Rect($h)
$w = $rect[2]
$hgt = $rect[3]
if ($w -le 0 -or $hgt -le 0) { throw "window has no size ($w x $hgt)" }

$bmp = New-Object System.Drawing.Bitmap($w, $hgt)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $gfx.GetHdc()
# 2 = PW_RENDERFULLCONTENT: capture DirectComposition/GPU-rendered content.
$ok = [Win]::PrintWindow($h, $hdc, 2)
$gfx.ReleaseHdc($hdc)
$gfx.Dispose()

if (-not $ok) {
  $bmp.Dispose()
  throw 'PrintWindow failed'
}

$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

$size = (Get-Item $Out).Length
Write-Output "$Out  ${w}x${hgt}  $([Math]::Round($size / 1kb)) KB"
