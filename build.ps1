# Dev build script — fast iterate-and-test loop.
#
# Builds the frontend, copies it into cmd/mogugi/static/ for go:embed,
# and builds the backend into bin/mogugi.exe.
#
# Does NOT touch version files or produce dist/ artifacts; for that, use
# release.ps1.
#
# Usage:
#   .\build.ps1                # full rebuild (frontend + backend)
#   .\build.ps1 -BackendOnly   # skip frontend build (Go-only changes)
#   .\build.ps1 -FrontendOnly  # skip Go build (front-only changes)
#   .\build.ps1 -Install       # run `npm install` before building
#   .\build.ps1 -Test          # also run go test ./... and build cmd/dilmetertest

param(
    [switch]$BackendOnly,
    [switch]$FrontendOnly,
    [switch]$Install,
    [switch]$Test
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=== Build ===" -ForegroundColor Cyan

# ── Frontend ────────────────────────────────────────────────────────────────
if (-not $BackendOnly) {
    Write-Host "`n[frontend] building..." -ForegroundColor Yellow
    Push-Location front

    # npm/vite write progress + warnings to stderr even on success;
    # downgrade to non-fatal so PowerShell doesn't terminate the script.
    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = "Continue"

    if ($Install -or -not (Test-Path "node_modules")) {
        Write-Host "  npm install..." -ForegroundColor Gray
        & npm install 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = $prevPref; Pop-Location; Write-Host "npm install failed" -ForegroundColor Red; exit 1 }
    }

    & npm run build 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = $prevPref; Pop-Location; Write-Host "frontend build failed" -ForegroundColor Red; exit 1 }
    $ErrorActionPreference = $prevPref
    Pop-Location

    # Sync to go:embed dir.
    $staticDir = "cmd/mogugi/static"
    if (Test-Path $staticDir) {
        Get-ChildItem -Path $staticDir -Exclude ".keep" | Remove-Item -Recurse -Force
    } else {
        New-Item -ItemType Directory -Force -Path $staticDir | Out-Null
        New-Item -ItemType File -Force -Path "$staticDir/.keep" | Out-Null
    }
    Copy-Item -Path "front/dist/*" -Destination $staticDir -Recurse -Force
}

# ── Tests (opt-in) ──────────────────────────────────────────────────────────
if ($Test -and -not $FrontendOnly) {
    Write-Host "`n[test] go test ./..." -ForegroundColor Yellow
    go test ./...
    if ($LASTEXITCODE -ne 0) { Write-Host "tests failed" -ForegroundColor Red; exit 1 }
}

# ── Backend ─────────────────────────────────────────────────────────────────
if (-not $FrontendOnly) {
    Write-Host "`n[backend] go build ./cmd/mogugi..." -ForegroundColor Yellow
    if (-not (Test-Path "bin")) { New-Item -ItemType Directory -Path "bin" | Out-Null }
    $apiBin = "bin/mogugi.exe"
    go build -o $apiBin ./cmd/mogugi
    if ($LASTEXITCODE -ne 0) { Write-Host "backend build failed" -ForegroundColor Red; exit 1 }
    $info = Get-Item $apiBin
    Write-Host "  $apiBin ($([math]::Round($info.Length / 1MB, 2)) MB)" -ForegroundColor Green

    if ($Test) {
        Write-Host "`n[backend] go build ./cmd/dilmetertest..." -ForegroundColor Yellow
        go build -o bin/dilmetertest.exe ./cmd/dilmetertest
        if ($LASTEXITCODE -ne 0) { Write-Host "dilmetertest build failed" -ForegroundColor Red; exit 1 }
    }
}

Write-Host "`n=== OK ===" -ForegroundColor Green
