# Shared license build-flag processing for release.ps1 and dev-run.ps1.
# Dot-source via:  . (Join-Path $PSScriptRoot 'keys-lib.ps1')

function Get-LicenseLDFlag {
    param([string]$Path = "license-build.txt")

    if (-not (Test-Path $Path)) {
        throw "$Path not found (run 'go run ./cmd/keygen' and save PublicKeyHex/MacKeyHex into it)"
    }

    $vals = @{}
    foreach ($line in Get-Content $Path) {
        if ($line -match '^\s*(\w+)\s*=\s*([0-9a-fA-F]+)\s*$') { $vals[$matches[1]] = $matches[2] }
    }
    if (-not $vals.PublicKeyHex -or -not $vals.MacKeyHex) {
        throw "$Path must define PublicKeyHex=<hex> and MacKeyHex=<hex>"
    }

    $pkg = "github.com/irusan-fanclub/mabidilmeter/lib/license"
    [pscustomobject]@{
        LDFlag = "-X $pkg.PublicKeyHex=$($vals.PublicKeyHex) -X $pkg.MacKeyHex=$($vals.MacKeyHex)"
    }
}
