# Builds assets/out/mogugi.ico (exe icon) and front/public/favicon.ico from
# assets/appicon.png, resizing with GDI+ (System.Drawing, built into
# Windows/.NET) -- no external tooling required.
#
# ICO packing is done in-script: a minimal ICONDIR + ICONDIRENTRY container
# with PNG-compressed image data per entry, which Vista+ (and
# goversioninfo/rsrc, which only copies the raw bytes without decoding
# pixels) render natively.

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$srcPath = "assets/appicon.png"
$outDir = "assets/out"
$icoPath = "$outDir/mogugi.ico"
$faviconPath = "front/public/favicon.ico"
$sizes = @(16, 32, 48, 64, 128, 256)

if (-not (Test-Path $srcPath)) {
    throw "build-icons: $srcPath not found"
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Add-Type -AssemblyName System.Drawing

# Resizes the source PNG to $Size with high-quality bicubic sampling and
# returns the PNG bytes.
function ConvertTo-ResizedPng {
    param([System.Drawing.Image]$Source, [int]$Size)

    $bmp = New-Object System.Drawing.Bitmap $Size, $Size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.Clear([System.Drawing.Color]::Transparent)
        $g.DrawImage($Source, 0, 0, $Size, $Size)

        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        # Leading comma suppresses pipeline enumeration -- without it, `return`
        # unrolls the byte[] into individual bytes and the caller ends up with
        # a boxed Object[] instead of a real byte[].
        return , $ms.ToArray()
    } finally {
        $g.Dispose()
        $bmp.Dispose()
    }
}

# Packs {size -> PNG bytes} into a Vista-style (PNG-in-ICO) .ico: ICONDIR
# header, one ICONDIRENTRY per size, then the PNG blobs back to back.
function New-IcoFile {
    param([string]$Path, [hashtable]$PngsBySize)

    $orderedSizes = $PngsBySize.Keys | Sort-Object
    $count = $orderedSizes.Count

    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter $ms
    try {
        $bw.Write([UInt16]0)       # ICONDIR.Reserved, must be 0
        $bw.Write([UInt16]1)       # ICONDIR.Type, 1 = icon
        $bw.Write([UInt16]$count)  # ICONDIR.Count

        $offset = 6 + (16 * $count)  # header + entries, before any image data
        foreach ($s in $orderedSizes) {
            $png = $PngsBySize[$s]
            $dim = if ($s -ge 256) { 0 } else { $s }  # 0 means 256 in ICO
            $bw.Write([byte]$dim)          # Width
            $bw.Write([byte]$dim)          # Height
            $bw.Write([byte]0)             # ColorCount (0 = no palette)
            $bw.Write([byte]0)             # Reserved
            $bw.Write([UInt16]1)           # Planes
            $bw.Write([UInt16]32)          # BitCount
            $bw.Write([UInt32]$png.Length) # BytesInRes
            $bw.Write([UInt32]$offset)     # ImageOffset
            $offset += $png.Length
        }
        foreach ($s in $orderedSizes) {
            $bw.Write($PngsBySize[$s])
        }
        $bw.Flush()
        [System.IO.File]::WriteAllBytes($Path, $ms.ToArray())
    } finally {
        $bw.Dispose()
        $ms.Dispose()
    }
}

$src = [System.Drawing.Image]::FromFile((Resolve-Path $srcPath))
try {
    $pngs = @{}
    foreach ($s in $sizes) {
        $pngs[$s] = ConvertTo-ResizedPng -Source $src -Size $s
    }
} finally {
    $src.Dispose()
}

New-IcoFile -Path $icoPath -PngsBySize $pngs
Write-Host "build-icons: wrote $icoPath" -ForegroundColor Green

$faviconDir = Split-Path $faviconPath -Parent
New-Item -ItemType Directory -Force -Path $faviconDir | Out-Null
Copy-Item $icoPath $faviconPath -Force
Write-Host "build-icons: wrote $faviconPath" -ForegroundColor Green
