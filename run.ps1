# Runs the built bin/mogugi.exe from a terminal so Ctrl+C quits it.
#
# mogugi.exe is a GUI program, so a plain `.\bin\mogugi.exe` returns to the
# prompt at once, and PSReadLine then reads Ctrl+C as an ordinary key: mogugi
# never sees it. Waiting here keeps Ctrl+C a console signal that mogugi handles
# as a clean quit. (`| Out-Host` also waits, but on Ctrl+C PowerShell kills the
# piped program before it finishes shutting down.)
#
# Usage:
#   .\run.ps1                         # live mode
#   .\run.ps1 --version               # any mogugi arguments pass through

$ErrorActionPreference = "Stop"

$exe = Join-Path $PSScriptRoot 'bin\mogugi.exe'
if (-not (Test-Path $exe)) {
    Write-Host "not built yet: run .\build.ps1 first" -ForegroundColor Red
    exit 1
}

$p = if ($args) { Start-Process $exe -ArgumentList $args -NoNewWindow -PassThru } else { Start-Process $exe -NoNewWindow -PassThru }
# A blocking .NET wait is not cut short by Ctrl+C, so mogugi finishes its quit.
$p.WaitForExit()
exit $p.ExitCode
