<#
  Renders the Store "16:9 super hero art" (no product title, per Store rules):
  store/hero-3840x2160.png and store/hero-1920x1080.png.
  The Store overlays the title and buttons on the left, so the artwork sits on the right.
#>
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$W = 3840; $H = 2160
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

function Color([string]$hex, [int]$alpha = 255) {
  $c = [System.Drawing.ColorTranslator]::FromHtml($hex)
  [System.Drawing.Color]::FromArgb($alpha, $c.R, $c.G, $c.B)
}
function RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc($x, $y, 2 * $r, 2 * $r, 180, 90)
  $p.AddArc($x + $w - 2 * $r, $y, 2 * $r, 2 * $r, 270, 90)
  $p.AddArc($x + $w - 2 * $r, $y + $h - 2 * $r, 2 * $r, 2 * $r, 0, 90)
  $p.AddArc($x, $y + $h - 2 * $r, 2 * $r, 2 * $r, 90, 90)
  $p.CloseFigure()
  $p
}
function Glow([float]$cx, [float]$cy, [float]$r, [string]$hex, [int]$alpha) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddEllipse($cx - $r, $cy - $r, 2 * $r, 2 * $r)
  $b = New-Object System.Drawing.Drawing2D.PathGradientBrush $p
  $b.CenterColor = Color $hex $alpha
  $b.SurroundColors = @((Color $hex 0))
  $g.FillPath($b, $p)
  $b.Dispose(); $p.Dispose()
}

# Background: the icon's dark slate gradient, with soft green / purple light.
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point $W, $H), (Color "#232733"), (Color "#0e1014")
$g.FillRectangle($bg, 0, 0, $W, $H)
Glow 2750 1000 1300 "#50fa7b" 38
Glow 3300 1750 900 "#bd93f9" 34
Glow 900 400 1100 "#6272a4" 26

# Faint split-view terminal windows behind the glyph (a nod to tabs + split panes).
$panes = @(
  @{ x = 1650; y = 330;  w = 1100; h = 1500 },
  @{ x = 2800; y = 330;  w = 820;  h = 720 },
  @{ x = 2800; y = 1110; w = 820;  h = 720 }
)
$lineColors = @("#50fa7b", "#f8f8f2", "#bd93f9", "#f8f8f2", "#8be9fd", "#f8f8f2")
$rand = New-Object System.Random 7
foreach ($pane in $panes) {
  $path = RoundRect $pane.x $pane.y $pane.w $pane.h 36
  $fill = New-Object System.Drawing.SolidBrush (Color "#ffffff" 10)
  $edge = New-Object System.Drawing.Pen (Color "#ffffff" 34), 3
  $g.FillPath($fill, $path); $g.DrawPath($edge, $path)
  # Title bar dots
  foreach ($i in 0..2) {
    $dot = New-Object System.Drawing.SolidBrush (Color "#ffffff" 40)
    $g.FillEllipse($dot, $pane.x + 40 + $i * 46, $pane.y + 36, 22, 22)
    $dot.Dispose()
  }
  # Text lines
  $y = $pane.y + 120
  $n = 0
  while ($y -lt $pane.y + $pane.h - 70) {
    $len = ($pane.w - 120) * (0.25 + $rand.NextDouble() * 0.65)
    $pen = New-Object System.Drawing.Pen (Color $lineColors[$n % $lineColors.Count] 46), 18
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($pen, $pane.x + 60, $y, $pane.x + 60 + $len, $y)
    $pen.Dispose()
    $y += 64; $n++
  }
  $fill.Dispose(); $edge.Dispose(); $path.Dispose()
}

# The ">_" mark from app-icon.svg (1024 grid), scaled up and centered on the right.
$s = 2.15
$ox = 2620 - 515 * $s; $oy = 1080 - 520 * $s
function P([float]$x, [float]$y) { New-Object System.Drawing.PointF ($ox + $x * $s), ($oy + $y * $s) }
# Soft halo (wide, faint strokes first), then the solid mark.
foreach ($pass in @(@{ w = 84 * $s + 220; a = 8 }, @{ w = 84 * $s + 150; a = 12 }, @{ w = 84 * $s + 90; a = 18 }, @{ w = 84 * $s + 40; a = 28 }, @{ w = 84 * $s; a = 255 })) {
  $green = New-Object System.Drawing.Pen (Color "#50fa7b" $pass.a), $pass.w
  $green.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $green.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $green.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $g.DrawLines($green, [System.Drawing.PointF[]]@((P 260 340), (P 450 512), (P 260 684)))
  $purple = New-Object System.Drawing.Pen (Color "#bd93f9" $pass.a), $pass.w
  $purple.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $purple.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLine($purple, (P 520 700), (P 770 700))
  $green.Dispose(); $purple.Dispose()
}

$g.Dispose()
$out = $PSScriptRoot
$bmp.Save((Join-Path $out "hero-3840x2160.png"), [System.Drawing.Imaging.ImageFormat]::Png)

$small = New-Object System.Drawing.Bitmap 1920, 1080
$g2 = [System.Drawing.Graphics]::FromImage($small)
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g2.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g2.DrawImage($bmp, 0, 0, 1920, 1080)
$g2.Dispose()
$small.Save((Join-Path $out "hero-1920x1080.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$small.Dispose(); $bmp.Dispose()
Write-Host "Saved hero-3840x2160.png and hero-1920x1080.png in $out"
