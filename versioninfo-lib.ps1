# Generates the Windows version resource linked into mogugi.exe.
#
# Without this the exe has an entirely empty Details tab: no product name, no
# description, no author. Task Manager shows the bare filename and SmartScreen
# has nothing to describe. The resource is free and works for every user,
# unlike a signature, which needs a trusted certificate to mean anything.
#
# Output is named resource_windows_amd64.syso so Go's filename build
# constraints keep it out of any non-Windows build.

function New-VersionResource {
    param(
        [Parameter(Mandatory = $true)][string]$Version,
        [string]$PackageDir = "cmd/mogugi"
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

    # FixedFileInfo needs a numeric quad; the string fields carry the real
    # semver, including any pre-release suffix.
    go tool goversioninfo `
        -o $syso `
        -ver-major $major -ver-minor $minor -ver-patch $patch -ver-build 0 `
        -file-version $Version -product-version $Version `
        $json
    if ($LASTEXITCODE -ne 0) {
        throw "goversioninfo failed"
    }

    Write-Host "Version resource: $syso ($Version)" -ForegroundColor Gray
}
