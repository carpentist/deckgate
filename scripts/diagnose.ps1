[CmdletBinding()]
param(
  [string]$AppPath = ""
)

$ErrorActionPreference = "Stop"

function Resolve-WatcherApp {
  param([string]$ExplicitPath)

  if ($ExplicitPath) {
    return $ExplicitPath
  }

  $candidates = @()
  if ($env:LOCALAPPDATA) {
    $candidates += (Join-Path $env:LOCALAPPDATA "Programs\Deckgate\Deckgate.exe")
  }
  if ($env:ProgramFiles) {
    $candidates += (Join-Path $env:ProgramFiles "Deckgate\Deckgate.exe")
  }
  if (${env:ProgramFiles(x86)}) {
    $candidates += (Join-Path ${env:ProgramFiles(x86)} "Deckgate\Deckgate.exe")
  }

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }
  return $null
}

$exe = Resolve-WatcherApp -ExplicitPath $AppPath
if (-not $exe -or -not (Test-Path -LiteralPath $exe)) {
  Write-Error "Deckgate was not found. Use -AppPath '<path to Deckgate.exe>'."
  exit 1
}

Write-Host "Using: $exe"
$process = Start-Process -FilePath $exe -ArgumentList "--diagnose" -Wait -PassThru -WindowStyle Hidden

$diagnosePath = Join-Path $env:LOCALAPPDATA "Deckgate\diagnose.json"
if (Test-Path -LiteralPath $diagnosePath) {
  Write-Host ""
  Write-Host "=== Watcher diagnostics ==="
  Get-Content -LiteralPath $diagnosePath -Raw
}

Write-Host ""
Write-Host "=== Claude Code ==="
$claude = Get-Command claude -ErrorAction SilentlyContinue
if ($claude) {
  Write-Host "Path: $($claude.Source)"
  & claude --version
} else {
  Write-Warning "claude was not found on PATH."
}

$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
if (Test-Path -LiteralPath $settingsPath) {
  $raw = Get-Content -LiteralPath $settingsPath -Raw
  $relayCount = ([regex]::Matches($raw, "--ccw-hook-relay")).Count
  $gateCount = ([regex]::Matches($raw, "--ccw-hook-gate")).Count
  Write-Host "Settings: $settingsPath"
  Write-Host "Relay hooks: $relayCount"
  Write-Host "Approval gate hooks: $gateCount"
} else {
  Write-Host "Settings: $settingsPath (not found)"
}

Write-Host ""
Write-Host "=== Claude processes ==="
Get-Process claude -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, StartTime

if ($process.ExitCode -ne 0) {
  Write-Error "Diagnostics failed with exit code $($process.ExitCode)."
  exit $process.ExitCode
}

exit 0
