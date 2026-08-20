# Release script for MOGUGI
#
# Builds frontend, backend (with version embedded via -ldflags),
# and packages the result into dist/mogugi_<version>.zip.
#
# Usage:
#   .\release.ps1                  # uses cmd/mogugi/main.go default version
#   .\release.ps1 -Version 0.2.1   # build & package as 0.2.1
#   .\release.ps1 -SkipTest        # skip lint + both test suites
#   .\release.ps1 -Force           # override the working-tree and tag guards
#   .\release.ps1 -Tagline '...'   # carry a one-line tagline into the exe/About tab

param(
    [string]$Version = "",
    [switch]$SkipTest,
    [switch]$Force,
    [string]$Tagline = ''
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

# Steps are numbered for the operator; the Go test step disappears under
# -SkipTest, so the total is computed rather than hard-coded.
$stepTotal = if ($SkipTest) { 4 } else { 5 }
$stepNo = 0
function Write-Step($name) {
    $script:stepNo++
    Write-Host "`n[$script:stepNo/$script:stepTotal] $name" -ForegroundColor Yellow
}

# ── Resolve version ───────────────────────────────────────────────────────────
if ([string]::IsNullOrWhiteSpace($Version)) {
    # Read default from cmd/mogugi/main.go
    $constsPath = "cmd/mogugi/main.go"
    $line = Select-String -Path $constsPath -Pattern '^var Version = "(.+)"' | Select-Object -First 1
    if (-not $line) {
        Write-Host "Could not find Version in $constsPath" -ForegroundColor Red
        exit 1
    }
    $Version = $line.Matches[0].Groups[1].Value
    Write-Host "Using version from $constsPath -> $Version" -ForegroundColor Gray
}

if ($Version -notmatch '^\d+\.\d+\.\d+(-[\w.]+)?$') {
    Write-Host "Invalid version '$Version' (expected semver like 0.2.0)" -ForegroundColor Red
    exit 1
}

# ── Repository guards ────────────────────────────────────────────────────────
# The artifact carries its version only in -ldflags; nothing ties the exe back
# to a commit. Building from a dirty tree therefore ships something that
# matches no commit and cannot be identified afterwards. Probes use commands
# that exit 0 either way, so no $LASTEXITCODE games are needed.
$hasGit = ($null -ne (Get-Command git -ErrorAction SilentlyContinue)) -and (Test-Path ".git")
if (-not $hasGit) {
    Write-Host "git unavailable or not a repository; skipping tree and tag guards" -ForegroundColor Gray
} else {
    $dirty = @(git status --porcelain)
    if ($dirty.Count -gt 0 -and -not $Force) {
        Write-Host "Working tree is not clean:" -ForegroundColor Red
        $dirty | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
        Write-Host "Commit or stash first, or pass -Force." -ForegroundColor Red
        exit 1
    }

    $branch = "$(git rev-parse --abbrev-ref HEAD)".Trim()
    if ($branch -ne "master") {
        Write-Host "Warning: building from branch '$branch', not master." -ForegroundColor Yellow
    }

    if (@(git tag --list "v$Version").Count -gt 0 -and -not $Force) {
        Write-Host "Tag v$Version already exists — that version is published." -ForegroundColor Red
        Write-Host "Bump the version, or pass -Force to rebuild its artifacts." -ForegroundColor Red
        exit 1
    }

    # Never package something that would look like a downgrade on the releases
    # page. Compares the numeric core only, so pre-release suffixes don't throw.
    $latestTag = @(git tag --list "v*" --sort=-v:refname) | Select-Object -First 1
    if ($latestTag) {
        $latestCore = ($latestTag -replace '^v', '') -replace '-.*$', ''
        $thisCore = $Version -replace '-.*$', ''
        if ([version]$thisCore -lt [version]$latestCore -and -not $Force) {
            Write-Host "Version $Version is older than the latest tag $latestTag." -ForegroundColor Red
            Write-Host "Bump the version, or pass -Force if this is deliberate." -ForegroundColor Red
            exit 1
        }
    }
}

Write-Host "=== MOGUGI Release v$Version ===" -ForegroundColor Cyan

. (Join-Path $PSScriptRoot 'keys-lib.ps1')
try {
    $lic = Get-LicenseLDFlag
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
Write-Host "Embedding license public key + mac key" -ForegroundColor Gray

# ── Icons ────────────────────────────────────────────────────────────────────
# Fatal here, unlike build.ps1's dev build: a release must carry the icon.
Write-Step "Building icons..."
try {
    & (Join-Path $PSScriptRoot 'assets/build-icons.ps1')
} catch {
    Write-Host "icon build failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# ── Frontend ─────────────────────────────────────────────────────────────────
Write-Step "Frontend: version sync, lint, tests, build"
# Picked up by vite.config.mjs as __APP_TAGLINE__; empty is fine, no tagline ships.
$env:MOGUGI_TAGLINE = $Tagline
Push-Location front

$prevPref = $ErrorActionPreference
# Set when the version files have been edited but the build has not yet
# succeeded; the finally block puts them back so a failed run leaves no
# half-applied bump behind.
$rollback = $null
$frontendError = $null

try {
    # Sync package.json (and the lock file's own two version fields) so
    # __APP_VERSION__ matches the release tag.
    #
    # These are targeted text edits rather than a ConvertFrom-Json /
    # ConvertTo-Json round-trip, for two reasons that both broke the build
    # before:
    #   * Set-Content -Encoding utf8 writes a BOM under Windows PowerShell 5.1,
    #     and vite.config.mjs reads package.json with JSON.parse, which rejects
    #     it ("Unexpected token"). The whole frontend build fails.
    #   * ConvertTo-Json reflows the entire file (indentation and spacing),
    #     turning a one-line version bump into a diff touching every line.
    $pkgFull = (Resolve-Path "package.json").Path
    $pkgRaw = [System.IO.File]::ReadAllText($pkgFull)
    if ($pkgRaw -notmatch '"version"\s*:\s*"([^"]+)"') {
        throw "Could not find a version field in front/package.json"
    }
    $pkgVersion = $Matches[1]

    $lockFull = if (Test-Path "package-lock.json") { (Resolve-Path "package-lock.json").Path } else { $null }
    $lockRaw = if ($lockFull) { [System.IO.File]::ReadAllText($lockFull) } else { $null }

    if ($pkgVersion -ne $Version) {
        Write-Host "Updating version $pkgVersion -> $Version" -ForegroundColor Gray
        $rollback = @{ Pkg = $pkgRaw; Lock = $lockRaw; From = $pkgVersion }

        # Count 1: the package's own version, never a dependency's.
        $newPkg = [regex]::Replace($pkgRaw, '("version"\s*:\s*")[^"]+(")', "`${1}$Version`${2}", 1)
        [System.IO.File]::WriteAllText($pkgFull, $newPkg, $utf8NoBom)

        # The lock file repeats the project's own version twice at the top (the
        # root object and packages[""]); everything after that belongs to a
        # dependency. npm install would fix these anyway, but doing it here
        # keeps the resulting diff intentional instead of a surprise.
        if ($lockRaw) {
            $newLock = [regex]::Replace($lockRaw, '("version"\s*:\s*")' + [regex]::Escape($pkgVersion) + '(")', "`${1}$Version`${2}", 2)
            [System.IO.File]::WriteAllText($lockFull, $newLock, $utf8NoBom)
        }
    }

    # Suppress NativeCommandError from npm's stderr writes (vite emits
    # warnings to stderr even on success).
    $ErrorActionPreference = "Continue"

    & npm install 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

    if (-not $SkipTest) {
        # Lint before bundling: it is seconds, and it is the only check here
        # that reads .vue templates, which have no component tests behind them.
        # Uses the non-fixing `lint` script on purpose — a release must never
        # rewrite sources and then package the rewritten copy.
        & npm run lint 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "frontend lint failed" }
        Write-Host "Lint OK" -ForegroundColor Green

        & npm test 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "frontend tests failed" }
        Write-Host "Frontend tests OK" -ForegroundColor Green
    }

    & npm run build 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }

    $ErrorActionPreference = $prevPref

    # Copy to embed dir consumed by go:embed.
    $staticPath = "../cmd/mogugi/static"
    if (Test-Path $staticPath) {
        Get-ChildItem -Path $staticPath -Exclude ".keep" | Remove-Item -Recurse -Force
    } else {
        New-Item -ItemType Directory -Force -Path $staticPath | Out-Null
        New-Item -ItemType File -Force -Path "$staticPath/.keep" | Out-Null
    }
    Copy-Item -Path "dist/*" -Destination $staticPath -Recurse -Force
    # Trim what browsers never fetch from the embed: source maps (debug
    # only) and legacy font formats (woff2 covers every modern browser).
    Get-ChildItem -Path $staticPath -Recurse -Include *.map, *.eot, *.ttf, *.woff |
        Remove-Item -Force

    Write-Host "Frontend OK" -ForegroundColor Green
    $rollback = $null   # bump is earned; keep it
} catch {
    $frontendError = $_.Exception.Message
} finally {
    $ErrorActionPreference = $prevPref
    if ($rollback) {
        [System.IO.File]::WriteAllText($pkgFull, $rollback.Pkg, $utf8NoBom)
        if ($lockFull -and $rollback.Lock) {
            [System.IO.File]::WriteAllText($lockFull, $rollback.Lock, $utf8NoBom)
        }
        Write-Host "Rolled version files back to $($rollback.From)" -ForegroundColor Gray
    }
    Pop-Location
    Remove-Item Env:\MOGUGI_TAGLINE -ErrorAction SilentlyContinue
}

if ($frontendError) {
    Write-Host $frontendError -ForegroundColor Red
    exit 1
}

# ── Go tests ─────────────────────────────────────────────────────────────────
if (-not $SkipTest) {
    Write-Step "Running Go tests..."
    # Not ./... : front/node_modules contains a vendored Go package (flatted),
    # which ./... walks into. Nothing there is ours, and a compile error in a
    # transitive npm package should not be able to block a release.
    go test ./cmd/... ./lib/...
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Tests failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "Tests OK" -ForegroundColor Green
}

# ── Backend build with embedded version ──────────────────────────────────────
Write-Step "Building Backend (release flags)..."

# Must run before go build: the linker picks the .syso up off disk.
. (Join-Path $PSScriptRoot 'versioninfo-lib.ps1')
try {
    New-VersionResource -Version $Version -Tagline $Tagline
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

$binDir = "bin"
if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir | Out-Null }

$ldflags = "-s -w -X main.Version=$Version $($lic.LDFlag)"
$apiBin  = "$binDir/mogugi.exe"

go build -ldflags $ldflags -trimpath -o $apiBin ./cmd/mogugi
if ($LASTEXITCODE -ne 0) { Write-Host "mogugi build failed" -ForegroundColor Red; exit 1 }

Write-Host "Built $apiBin" -ForegroundColor Green

# ── Package ─────────────────────────────────────────────────────────────────
Write-Step "Packaging..."

$distDir = "dist"
if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }

$releaseExe = "$distDir/mogugi_$Version.exe"
$releaseZip = "$distDir/mogugi_$Version.zip"

# A previously packaged build left running holds a lock on its own exe, and
# the raw Access-denied that surfaces here is unhelpfully far from the cause.
foreach ($stale in @($releaseExe, $releaseZip)) {
    if (-not (Test-Path $stale)) { continue }
    try {
        Remove-Item $stale -Force
    } catch {
        Write-Host "Cannot replace $stale — the file is in use." -ForegroundColor Red
        Write-Host "A previously packaged mogugi is probably still running; close it and re-run." -ForegroundColor Red
        exit 1
    }
}

Copy-Item $apiBin $releaseExe
$exeInfo = Get-Item $releaseExe
Write-Host "Packaged $releaseExe ($([math]::Round($exeInfo.Length / 1MB, 2)) MB)" -ForegroundColor Green

Compress-Archive -Path $releaseExe -DestinationPath $releaseZip -CompressionLevel Optimal
$zipInfo = Get-Item $releaseZip
Write-Host "Packaged $releaseZip ($([math]::Round($zipInfo.Length / 1MB, 2)) MB)" -ForegroundColor Green

Write-Host "`n=== Release v$Version ready ===" -ForegroundColor Green
Write-Host "Artifacts:" -ForegroundColor Cyan
Write-Host "  $releaseExe" -ForegroundColor Cyan
Write-Host "  $releaseZip" -ForegroundColor Cyan
Write-Host "Next steps (manual):" -ForegroundColor Cyan
Write-Host "  git tag v$Version" -ForegroundColor Gray
Write-Host "  git push --tags" -ForegroundColor Gray
Write-Host "  gh release create v$Version $releaseExe $releaseZip --title `"v$Version`" --notes `"...`"" -ForegroundColor Gray
