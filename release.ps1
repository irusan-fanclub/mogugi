# Release script for Mabidilmeter
#
# Builds frontend, backend (with version embedded via -ldflags),
# and packages the result into dist/dilmeterapi-vX.Y.Z.zip.
#
# Usage:
#   .\release.ps1                  # uses constants.go default version
#   .\release.ps1 -Version 0.2.1   # build & package as 0.2.1

param(
    [string]$Version = "",
    [switch]$SkipTest
)

$ErrorActionPreference = "Stop"

# ── Resolve version ───────────────────────────────────────────────────────────
if ([string]::IsNullOrWhiteSpace($Version)) {
    # Read default from lib/constants/const.go
    $constsPath = "lib/constants/const.go"
    $line = Select-String -Path $constsPath -Pattern '^var Version = "(.+)"' | Select-Object -First 1
    if (-not $line) {
        Write-Host "Could not find Version in $constsPath" -ForegroundColor Red
        exit 1
    }
    $Version = $line.Matches[0].Groups[1].Value
    Write-Host "Using version from $constsPath -> $Version" -ForegroundColor Gray
}

if ($Version -notmatch '^\d+\.\d+\.\d+(-[\w.]+)?$') {
    Write-Host "Invalid version '$Version' (expected semver like 0.2.0)" -ForegroundColor Red
    exit 1
}

Write-Host "=== Mabidilmeter Release v$Version ===" -ForegroundColor Cyan

. (Join-Path $PSScriptRoot 'keys-lib.ps1')
try {
    $lic = Get-LicenseLDFlag
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
Write-Host "Embedding license public key + mac key" -ForegroundColor Gray

# ── Frontend build ────────────────────────────────────────────────────────────
Write-Host "`n[1/4] Building Frontend..." -ForegroundColor Yellow
Push-Location front

# Sync package.json version so __APP_VERSION__ matches the release tag.
$pkgPath = "package.json"
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
if ($pkg.version -ne $Version) {
    Write-Host "Updating package.json version $($pkg.version) -> $Version" -ForegroundColor Gray
    $pkg.version = $Version
    ($pkg | ConvertTo-Json -Depth 32) | Set-Content -Path $pkgPath -Encoding utf8
}

# Suppress NativeCommandError from npm's stderr writes (vite emits
# warnings to stderr even on success).
$prevPref = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& npm install 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = $prevPref; Pop-Location; Write-Host "npm install failed" -ForegroundColor Red; exit 1 }

& npm run build 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = $prevPref; Pop-Location; Write-Host "frontend build failed" -ForegroundColor Red; exit 1 }
$ErrorActionPreference = $prevPref

# Copy to embed dir consumed by go:embed.
$staticPath = "../cmd/dilmeterapi/static"
if (Test-Path $staticPath) {
    Get-ChildItem -Path $staticPath -Exclude ".keep" | Remove-Item -Recurse -Force
} else {
    New-Item -ItemType Directory -Force -Path $staticPath | Out-Null
    New-Item -ItemType File -Force -Path "$staticPath/.keep" | Out-Null
}
Copy-Item -Path "dist/*" -Destination $staticPath -Recurse -Force
Write-Host "Frontend OK" -ForegroundColor Green
Pop-Location

# ── Tests ────────────────────────────────────────────────────────────────────
if (-not $SkipTest) {
    Write-Host "`n[2/4] Running Go tests..." -ForegroundColor Yellow
    go test ./...
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Tests failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "Tests OK" -ForegroundColor Green
}

# ── Backend build with embedded version ──────────────────────────────────────
Write-Host "`n[3/4] Building Backend (release flags)..." -ForegroundColor Yellow

$binDir = "bin"
if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir | Out-Null }

$ldflags = "-s -w -X github.com/irusan-fanclub/mabidilmeter/lib/constants.Version=$Version $($lic.LDFlag)"
$apiBin  = "$binDir/dilmeterapi.exe"

go build -ldflags $ldflags -trimpath -o $apiBin ./cmd/dilmeterapi
if ($LASTEXITCODE -ne 0) { Write-Host "dilmeterapi build failed" -ForegroundColor Red; exit 1 }

Write-Host "Built $apiBin" -ForegroundColor Green

# ── Package ─────────────────────────────────────────────────────────────────
Write-Host "`n[4/4] Packaging..." -ForegroundColor Yellow

$distDir = "dist"
if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }

$releaseExe = "$distDir/mometer_$Version.exe"
$releaseZip = "$distDir/mometer_$Version.zip"
if (Test-Path $releaseExe) { Remove-Item $releaseExe -Force }
if (Test-Path $releaseZip) { Remove-Item $releaseZip -Force }

Copy-Item $apiBin $releaseExe
$exeInfo = Get-Item $releaseExe
Write-Host "Packaged $releaseExe ($([math]::Round($exeInfo.Length / 1MB, 2)) MB)" -ForegroundColor Green

Compress-Archive -Path $releaseExe -DestinationPath $releaseZip -CompressionLevel Optimal
$zipInfo = Get-Item $releaseZip
Write-Host "Packaged $releaseZip ($([math]::Round($zipInfo.Length / 1MB, 2)) MB)" -ForegroundColor Green

Write-Host "`n=== Release v$Version ready ===" -ForegroundColor Green
Write-Host "Artifacts:" -ForegroundColor Cyan
Write-Host "  $releaseExe" -ForegroundColor Cyan
Write-Host "  $releaseZip" -ForegroundColor Cyan
Write-Host "Next steps (manual):" -ForegroundColor Cyan
Write-Host "  git tag v$Version" -ForegroundColor Gray
Write-Host "  git push --tags" -ForegroundColor Gray
Write-Host "  gh release create v$Version $releaseExe $releaseZip --title `"v$Version`" --notes `"...`"" -ForegroundColor Gray
