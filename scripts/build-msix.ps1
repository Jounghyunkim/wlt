<#
  Packs the already-built wlt.exe into an MSIX for the Microsoft Store.

  Prerequisite: a release build (`source ./build-env.sh && npm run tauri build`, or
  `npm run tauri build -- --no-bundle`), so src-tauri/target/release/wlt.exe exists.

  Usage:
    npm run msix                       # -> src-tauri/target/msix/WLT_<version>_x64.msix (unsigned; the Store signs it)
    npm run msix -- -Register          # also register the unpacked layout for a local test (needs Developer Mode)

  makeappx / makepri come from the Microsoft.Windows.SDK.BuildTools NuGet package,
  downloaded once into src-tauri/target/msix-tools (no Windows SDK install needed).
#>
param(
  [switch]$Register
)

$ErrorActionPreference = "Stop"
$sdkVersion = "10.0.28000.2957"

$root = Split-Path -Parent $PSScriptRoot
$tauri = Join-Path $root "src-tauri"
$release = Join-Path $tauri "target\release"
$outDir = Join-Path $tauri "target\msix"
$layout = Join-Path $outDir "layout"

# ── Tools ──────────────────────────────────────────────────────────────
$toolsDir = Join-Path $tauri "target\msix-tools\$sdkVersion"
$pkgDir = Join-Path $toolsDir "pkg"
if (-not (Test-Path $pkgDir)) {
  New-Item -ItemType Directory -Force $toolsDir | Out-Null
  $zip = Join-Path $toolsDir "pkg.zip"
  $url = "https://api.nuget.org/v3-flatcontainer/microsoft.windows.sdk.buildtools/$sdkVersion/microsoft.windows.sdk.buildtools.$sdkVersion.nupkg"
  Write-Host "Downloading Windows SDK build tools $sdkVersion ..."
  Invoke-WebRequest $url -OutFile $zip -UseBasicParsing
  Expand-Archive $zip -DestinationPath $pkgDir -Force
  Remove-Item $zip
}
$binDir = Get-ChildItem (Join-Path $pkgDir "bin") -Directory | Sort-Object Name | Select-Object -Last 1
$makeappx = Join-Path $binDir.FullName "x64\makeappx.exe"
$makepri = Join-Path $binDir.FullName "x64\makepri.exe"

# ── Inputs ─────────────────────────────────────────────────────────────
$exe = Join-Path $release "wlt.exe"
if (-not (Test-Path $exe)) { throw "$exe not found. Build first: npm run tauri build -- --no-bundle" }

$conf = Get-Content (Join-Path $tauri "tauri.conf.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$parts = ($conf.version -replace "[-+].*$", "").Split(".")
while ($parts.Count -lt 3) { $parts += "0" }
# The Store requires the fourth part to be 0.
$version = "$($parts[0]).$($parts[1]).$($parts[2]).0"

# ── Layout ─────────────────────────────────────────────────────────────
if (Test-Path $layout) { Remove-Item $layout -Recurse -Force }
$assets = Join-Path $layout "Assets"
New-Item -ItemType Directory -Force $assets | Out-Null

Copy-Item $exe $layout
# GNU toolchain builds link WebView2Loader.dll dynamically (see scripts/ensure-webview2-loader.mjs).
$loader = Join-Path $release "WebView2Loader.dll"
if (Test-Path $loader) { Copy-Item $loader $layout }

$manifest = (Get-Content (Join-Path $tauri "msix\AppxManifest.xml") -Raw -Encoding UTF8).Replace("{{VERSION}}", $version)
[System.IO.File]::WriteAllText((Join-Path $layout "AppxManifest.xml"), $manifest, (New-Object System.Text.UTF8Encoding $false))
if ($manifest -match 'Publisher="CN=00000000-0000-0000-0000-000000000000"') {
  Write-Warning "AppxManifest.xml still has the placeholder identity. Replace it with the Partner Center values before uploading."
}

# Every tile/icon size, rendered from the 512px icon. `inset` < 1 leaves padding around the icon on tiles.
Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Image]::FromFile((Join-Path $tauri "icons\icon.png"))
function Save-Icon([string]$name, [int]$size, [double]$inset = 1.0, [int]$width = $size) {
  $bmp = New-Object System.Drawing.Bitmap $width, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $inner = [int][Math]::Round($size * $inset)
  $g.DrawImage($source, [int](($width - $inner) / 2), [int](($size - $inner) / 2), $inner, $inner)
  $g.Dispose()
  $bmp.Save((Join-Path $assets $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
try {
  foreach ($scale in 100, 200) {
    $f = $scale / 100
    Save-Icon "Square44x44Logo.scale-$scale.png" (44 * $f)
    Save-Icon "StoreLogo.scale-$scale.png" (50 * $f)
    Save-Icon "Square71x71Logo.scale-$scale.png" (71 * $f) 0.7
    Save-Icon "Square150x150Logo.scale-$scale.png" (150 * $f) 0.6
    Save-Icon "Square310x310Logo.scale-$scale.png" (310 * $f) 0.6
    Save-Icon "Wide310x150Logo.scale-$scale.png" (150 * $f) 0.6 (310 * $f)
  }
  # Taskbar / Start list / Explorer icons; "unplated" = drawn without the accent-colored backplate.
  foreach ($size in 16, 24, 32, 48, 256) {
    Save-Icon "Square44x44Logo.targetsize-$size.png" $size
    Save-Icon "Square44x44Logo.targetsize-${size}_altform-unplated.png" $size
  }
} finally {
  $source.Dispose()
}

# ── resources.pri (lets Windows pick the scale/targetsize variants) ────
$priConfig = Join-Path $outDir "priconfig.xml"
& $makepri createconfig /cf $priConfig /dq ko-KR /pv 10.0.0 /o | Out-Null
if ($LASTEXITCODE -ne 0) { throw "makepri createconfig failed ($LASTEXITCODE)" }
# Drop the <packaging> section: it splits scale-200 into a resource pack, but we ship one package.
[xml]$cfg = Get-Content $priConfig -Raw
$packaging = $cfg.SelectSingleNode("//packaging")
if ($packaging) { [void]$packaging.ParentNode.RemoveChild($packaging); $cfg.Save($priConfig) }
& $makepri new /pr $layout /cf $priConfig /mn (Join-Path $layout "AppxManifest.xml") /of (Join-Path $layout "resources.pri") /o | Out-Null
if ($LASTEXITCODE -ne 0) { throw "makepri new failed ($LASTEXITCODE)" }

# ── Pack ───────────────────────────────────────────────────────────────
$msix = Join-Path $outDir "WLT_${version}_x64.msix"
& $makeappx pack /d $layout /p $msix /o | Out-Null
if ($LASTEXITCODE -ne 0) { throw "makeappx pack failed ($LASTEXITCODE)" }
Write-Host "MSIX: $msix ($([Math]::Round((Get-Item $msix).Length / 1MB, 1)) MB, version $version)"

if ($Register) {
  # Loose-file registration: no signature needed, but Windows must be in Developer Mode.
  Add-AppxPackage -Register (Join-Path $layout "AppxManifest.xml") -ForceApplicationShutdown
  Write-Host "Registered. Start 'WLT' from the Start menu. Remove with: Get-AppxPackage *WLT* | Remove-AppxPackage"
}
