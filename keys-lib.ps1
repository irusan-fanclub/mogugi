# Shared license-key processing for release.ps1 and dev-run.ps1.
# Dot-source via:  . (Join-Path $PSScriptRoot 'keys-lib.ps1')

function Get-LicenseKeyLDFlag {
    param([string]$Path = "release-keys.txt")

    if (-not (Test-Path $Path)) { throw "$Path not found" }
    $lines = Get-Content $Path | Where-Object { $_.Trim() -ne "" -and -not $_.Trim().StartsWith("#") }
    if ($lines.Count -eq 0) { throw "$Path contains no keys" }

    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hashes = foreach ($line in $lines) {
        $bytes = [Text.Encoding]::UTF8.GetBytes($line.Trim())
        [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLower()
    }

    [pscustomobject]@{
        LDFlag = "-X github.com/irusan-fanclub/mabidilmeter/lib/license.KeyHashes=$($hashes -join ',')"
        Count  = $hashes.Count
    }
}
