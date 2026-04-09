param(
  [string]$PnpmVersion = '8.15.8',
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'

function Assert-Command {
  param(
    [string]$Name
  )

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

function Assert-LastExitCode {
  param(
    [string]$Action
  )

  if ($LASTEXITCODE -ne 0) {
    throw "$Action failed with exit code $LASTEXITCODE."
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Assert-Command 'node'
Assert-Command 'corepack'

Push-Location $repoRoot
try {
  & corepack prepare "pnpm@$PnpmVersion" --activate
  Assert-LastExitCode 'Prepare pnpm'

  if (-not $SkipInstall) {
    & corepack "pnpm@$PnpmVersion" install --frozen-lockfile
    Assert-LastExitCode 'Install workspace dependencies'
  }

  & corepack "pnpm@$PnpmVersion" run wiki:pdf:install
  Assert-LastExitCode 'Install Playwright Chromium'

  Write-Host 'Local LLM-Wiki runtime is ready.'
  Write-Host 'Next optional step: pnpm wiki:pdf:login -- --feed <slug> --url <publisher-or-campus-login-url>'
} finally {
  Pop-Location
}
