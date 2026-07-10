# Dev wrapper for running mogugi with license verification enabled.
#
# Reads PublicKeyHex/MacKeyHex from license-build.txt and injects them via
# -ldflags so the app verifies activation codes the same way a release build does.
#
# Usage:
#   .\dev-run.ps1                     # live mode
#   .\dev-run.ps1 file capture.pcapng # file replay
#   .\dev-run.ps1 list                # list NICs

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot 'keys-lib.ps1')
try {
    $lic = Get-LicenseLDFlag
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

go run -ldflags $lic.LDFlag ./cmd/mogugi @args
