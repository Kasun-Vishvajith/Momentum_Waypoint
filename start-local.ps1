$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not $env:DEMO_CLOCK) { $env:DEMO_CLOCK = '2026-06-23T15:00:00+05:30' }
$waypointPython = Get-Command python -ErrorAction SilentlyContinue
if ($waypointPython) { & $waypointPython.Source backend/server.py; exit $LASTEXITCODE }
$waypointBundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (Test-Path $waypointBundledPython) { & $waypointBundledPython backend/server.py; exit $LASTEXITCODE }
throw 'Install Python 3.12 or newer, then run python backend/server.py.'
