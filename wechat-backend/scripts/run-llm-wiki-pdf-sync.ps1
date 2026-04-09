param(
  [string]$RepoRoot = '',
  [string]$Month = '',
  [switch]$All,
  [switch]$RetryFailed
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  throw "Missing required command 'node'."
}

$scriptPath = Join-Path $RepoRoot 'scripts\llm-wiki-pdf-sync.mjs'
if (-not (Test-Path -LiteralPath $scriptPath)) {
  throw "PDF sync script not found: $scriptPath"
}

$args = @($scriptPath)
if ($All) {
  $args += '--all'
}
if (-not [string]::IsNullOrWhiteSpace($Month)) {
  $args += @('--month', $Month)
}
if (-not $RetryFailed) {
  $args += '--new-only'
}

Push-Location $RepoRoot
try {
  & $nodeCmd.Source @args
  if ($LASTEXITCODE -ne 0) {
    throw "PDF sync failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}
