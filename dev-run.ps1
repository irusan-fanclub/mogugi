# Dev wrapper for running dilmeterapi with license check enabled.
#
# Hashes release-keys.txt entries and injects them via -ldflags so the
# license check passes the same way it does in a release build.
#
# Usage:
#   .\dev-run.ps1                     # live mode
#   .\dev-run.ps1 file capture.pcapng # file replay
#   .\dev-run.ps1 list                # list NICs

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot 'keys-lib.ps1')
try {
    $lic = Get-LicenseKeyLDFlag
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

go run -ldflags $lic.LDFlag ./cmd/dilmeterapi @args
