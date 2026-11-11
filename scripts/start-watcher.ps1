[CmdletBinding()]
param(
  [string]$AppPath = ""
)

$ErrorActionPreference = "Stop"

if (-not $AppPath) {
  $candidates = @()
  if ($env:LOCALAPPDATA) {
    $candidates += (Join-Path $env:LOCALAPPDATA "Programs\Deckgate\Deckgate.exe")
  }
  if ($env:ProgramFiles) {
    $candidates += (Join-Path $env:ProgramFiles "Deckgate\Deckgate.exe")
  }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      $AppPath = $candidate
      break
    }
  }
}

if (-not $AppPath -or -not (Test-Path -LiteralPath $AppPath)) {
  Write-Error "Deckgate was not found. Use -AppPath '<path to Deckgate.exe>'."
  exit 1
}

Start-Process -FilePath $AppPath
Write-Host "Deckgate started."
