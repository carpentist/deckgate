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
$process = Start-Process -FilePath $exe -ArgumentList "--uninstall-hooks" -Wait -PassThru -WindowStyle Hidden

$resultPath = Join-Path $env:LOCALAPPDATA "Deckgate\cli-result.json"
if (Test-Path -LiteralPath $resultPath) {
  Get-Content -LiteralPath $resultPath -Raw
}

if ($process.ExitCode -ne 0) {
  Write-Error "Hook removal failed with exit code $($process.ExitCode)."
  exit $process.ExitCode
}

Write-Host "Hooks removed. Other Claude Code settings were preserved."
exit 0
