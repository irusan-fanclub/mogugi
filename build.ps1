# Build script for Mabidilmeter
# Builds frontend, backend, and runs tests

param(
    [switch]$SkipTest,
    [switch]$FrontendOnly,
    [switch]$BackendOnly
)

$ErrorActionPreference = "Stop"

Write-Host "=== Mabidilmeter Build Script ===" -ForegroundColor Cyan

# Build Frontend
if (-not $BackendOnly) {
    Write-Host "`n[1/4] Building Frontend..." -ForegroundColor Yellow
    Push-Location front
    try {
        Write-Host "Installing dependencies..." -ForegroundColor Gray
        npm install
        
        Write-Host "Building frontend..." -ForegroundColor Gray
        npm run build
        
        Write-Host "Copying frontend to static folder..." -ForegroundColor Gray
        $staticPath = "../cmd/dilmeterapi/static"
        if (Test-Path $staticPath) {
            # Remove all files except .keep
            Get-ChildItem -Path $staticPath -Exclude ".keep" | Remove-Item -Recurse -Force
        } else {
            New-Item -ItemType Directory -Force -Path $staticPath | Out-Null
            New-Item -ItemType File -Force -Path "$staticPath/.keep" | Out-Null
        }
        Copy-Item -Path "dist/*" -Destination $staticPath -Recurse -Force
        
        Write-Host "Frontend build completed successfully!" -ForegroundColor Green
    }
    catch {
        Write-Host "Frontend build failed: $_" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Pop-Location
}

# Run Tests
if (-not $SkipTest -and -not $FrontendOnly) {
    Write-Host "`n[2/4] Running Go Tests..." -ForegroundColor Yellow
    try {
        go test ./...
        Write-Host "All tests passed!" -ForegroundColor Green
    }
    catch {
        Write-Host "Tests failed: $_" -ForegroundColor Red
        exit 1
    }
}

# Build Backend - dilmeterapi
if (-not $FrontendOnly) {
    Write-Host "`n[3/4] Building Backend (dilmeterapi)..." -ForegroundColor Yellow
    try {
        go build -o bin/dilmeterapi.exe ./cmd/dilmeterapi
        Write-Host "dilmeterapi built successfully!" -ForegroundColor Green
    }
    catch {
        Write-Host "dilmeterapi build failed: $_" -ForegroundColor Red
        exit 1
    }
}

# Build Backend - dilmetertest
if (-not $FrontendOnly) {
    Write-Host "`n[4/4] Building Backend (dilmetertest)..." -ForegroundColor Yellow
    try {
        go build -o bin/dilmetertest.exe ./cmd/dilmetertest
        Write-Host "dilmetertest built successfully!" -ForegroundColor Green
    }
    catch {
        Write-Host "dilmetertest build failed: $_" -ForegroundColor Red
        exit 1
    }
}

Write-Host "`n=== Build Completed Successfully! ===" -ForegroundColor Green
Write-Host "Output directory: bin/" -ForegroundColor Cyan
