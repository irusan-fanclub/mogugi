# Generates the Windows version resource linked into mogugi.exe.
#
# Without this the exe has an entirely empty Details tab: no product name, no
# description, no author. Task Manager shows the bare filename and SmartScreen
# has nothing to describe. The resource is free and works for every user,
# unlike a signature, which needs a trusted certificate to mean anything.
#
# Output is named resource_windows_amd64.syso so Go's filename build
# constraints keep it out of any non-Windows build.

# Resolves the versioninfo JSON path to hand to goversioninfo: the tracked
# file untouched when $Tagline is empty (the existing FileDescription ships
# as-is), or a TEMP copy with FileDescription rewritten to "mogugi — <tagline>"
# otherwise. Never mutates the tracked versioninfo.json.
function Get-TaglinedVersionInfoJson {
    param(
        [Parameter(Mandatory = $true)][string]$JsonPath,
        [string]$Tagline = ''
    )

    if ([string]::IsNullOrWhiteSpace($Tagline)) {
        return $JsonPath
    }

    $data = Get-Content -Raw -Path $JsonPath | ConvertFrom-Json
    $data.StringFileInfo.FileDescription = "mogugi — $Tagline"

    $tempPath = Join-Path ([System.IO.Path]::GetTempPath()) "mogugi-versioninfo-$([guid]::NewGuid().ToString('N')).json"
    # Set-Content -Encoding utf8 adds a BOM under Windows PowerShell 5.1;
    # goversioninfo's JSON parser rejects that, so write raw UTF-8 instead.
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($tempPath, ($data | ConvertTo-Json -Depth 10), $utf8NoBom)
    return $tempPath
}

function New-VersionResource {
    param(
        [Parameter(Mandatory = $true)][string]$Version,
        [string]$PackageDir = "cmd/mogugi",
        [string]$Tagline = ''
    )

    if ($Version -notmatch '^(\d+)\.(\d+)\.(\d+)') {
        throw "New-VersionResource: '$Version' is not a semver-like version"
    }
    $major, $minor, $patch = [int]$Matches[1], [int]$Matches[2], [int]$Matches[3]

    $json = Join-Path $PackageDir "versioninfo.json"
    if (-not (Test-Path $json)) {
        throw "New-VersionResource: $json not found"
    }
    $syso = Join-Path $PackageDir "resource_windows_amd64.syso"
    $resolvedJson = Get-TaglinedVersionInfoJson -JsonPath $json -Tagline $Tagline

    # Icon is optional: assets/build-icons.ps1 produces it, but a dev build
    # that skipped/failed icon generation should still link, just iconless.
    $iconArgs = @()
    $iconPath = Join-Path $PSScriptRoot "assets/out/mogugi.ico"
    if (Test-Path $iconPath) {
        $iconArgs = @('-icon', $iconPath)
    }

    # FixedFileInfo needs a numeric quad; the string fields carry the real
    # semver, including any pre-release suffix.
    go tool goversioninfo `
        -o $syso `
        -ver-major $major -ver-minor $minor -ver-patch $patch -ver-build 0 `
        -file-version $Version -product-version $Version `
        @iconArgs `
        $resolvedJson
    if ($LASTEXITCODE -ne 0) {
        throw "goversioninfo failed"
    }

    Write-Host "Version resource: $syso ($Version)" -ForegroundColor Gray
}
