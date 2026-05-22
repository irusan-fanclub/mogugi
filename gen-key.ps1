# Generate license keys in the MOGU-YYYY-XXXXXX format.
#
# Usage:
#   .\gen-key.ps1              # one key
#   .\gen-key.ps1 -Count 5     # five keys
#   .\gen-key.ps1 -Append      # also append to release-keys.txt

param(
    [int]$Count = 1,
    [switch]$Append
)

# Confusables removed (0/O, 1/I) to keep keys easy to read & type.
# Length 32 divides 256 evenly → uniform sampling, no rejection needed.
$alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".ToCharArray()
$year = (Get-Date).Year
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$buf = New-Object byte[] 1

$keys = 1..$Count | ForEach-Object {
    $suffix = -join (1..6 | ForEach-Object {
        $rng.GetBytes($buf)
        $alphabet[$buf[0] % $alphabet.Length]
    })
    "MOGU-$year-$suffix"
}

$keys | ForEach-Object { Write-Host $_ }

if ($Append) {
    Add-Content -Path "release-keys.txt" -Value $keys
    Write-Host "`nAppended $Count key(s) to release-keys.txt" -ForegroundColor Green
}
