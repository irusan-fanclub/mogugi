# Dev wrapper for running mogugi with license verification enabled.
#
# Reads PublicKeyHex/MacKeyHex from license-build.txt and injects them via
# -ldflags so the app verifies activation codes the same way a release build does.
#
# license.dat normally lives next to the executable, but `go run` builds into a
# fresh temp directory every time, so an activation would be thrown away after
# each run. MOGUGI_DATA_DIR points the data dir (license.dat, config, logs) at
# the repo root instead: you activate once and every later dev run reuses it. Set the variable
# yourself beforehand to use a different directory.
#
# Usage:
#   .\dev-run.ps1                     # live mode
#   .\dev-run.ps1 --version           # print version

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot 'keys-lib.ps1')
try {
    $lic = Get-LicenseLDFlag
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

if (-not $env:MOGUGI_DATA_DIR) {
    $env:MOGUGI_DATA_DIR = $PSScriptRoot
}
$licenseFile = Join-Path $env:MOGUGI_DATA_DIR 'license.dat'
if (Test-Path $licenseFile) {
    Write-Host "license: $licenseFile" -ForegroundColor DarkGray
} else {
    Write-Host "license: none at $licenseFile - activate once in the UI and it will persist" -ForegroundColor Yellow
}

go run -ldflags $lic.LDFlag ./cmd/mogugi @args
