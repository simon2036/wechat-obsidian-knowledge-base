[CmdletBinding()]
param(
  [string]$StationRoot = '',
  [switch]$CreateLocalEnvTemplates
)

$ErrorActionPreference = 'Stop'

function Ensure-Directory {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Ensure-TextFile {
  param(
    [string]$Path,
    [string]$Content
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    Ensure-Directory (Split-Path -Parent $Path)
    Set-Content -LiteralPath $Path -Value $Content -Encoding UTF8
  }
}

function Ensure-EmptyFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    Ensure-Directory (Split-Path -Parent $Path)
    Set-Content -LiteralPath $Path -Value '' -NoNewline
  }
}

function Copy-IfMissing {
  param(
    [string]$Source,
    [string]$Destination
  )

  if ((Test-Path -LiteralPath $Source) -and -not (Test-Path -LiteralPath $Destination)) {
    Ensure-Directory (Split-Path -Parent $Destination)
    Copy-Item -LiteralPath $Source -Destination $Destination
  }
}

if ([string]::IsNullOrWhiteSpace($StationRoot)) {
  $StationRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

$StationRoot = (Resolve-Path -LiteralPath $StationRoot).Path
$backendRoot = Join-Path $StationRoot 'wechat-backend'

if (-not (Test-Path -LiteralPath $backendRoot)) {
  throw "Missing wechat-backend directory: $backendRoot"
}

foreach ($relativePath in @(
  'scripts',
  'obsidian-knowledge-base',
  'obsidian-knowledge-base\Feeds',
  'obsidian-knowledge-base\WeWe-RSS-AI',
  'obsidian-knowledge-base\.wewe-rss-archive',
  'obsidian-knowledge-base\.obsidian',
  'secrets',
  'secrets\wewe-rss',
  'backups',
  'backups\z001-source',
  'backups\z001-deploy'
)) {
  Ensure-Directory (Join-Path $StationRoot $relativePath)
}

Ensure-TextFile (Join-Path $StationRoot 'secrets\README.md') @'
# Secrets

This directory stores station-local SSH materials for z001.

The GitHub snapshot keeps placeholders only.
'@

Ensure-TextFile (Join-Path $StationRoot 'secrets\wewe-rss\README.md') @'
# z001 SSH Placeholder

Put these files here on a real machine:

- z001_id_ed25519
- known_hosts
'@
Ensure-EmptyFile (Join-Path $StationRoot 'secrets\wewe-rss\.gitkeep')

Ensure-TextFile (Join-Path $StationRoot 'backups\README.md') @'
# z001 Backups

This directory keeps local-only z001 source and deploy backups.

- `z001-source` is for the remote source snapshot.
- `z001-deploy` is for the remote deploy snapshot.
'@
Ensure-TextFile (Join-Path $StationRoot 'backups\z001-source\README.md') @'
# z001 Source Placeholder

Store the remote source backup here if you need an offline copy.
'@
Ensure-TextFile (Join-Path $StationRoot 'backups\z001-deploy\README.md') @'
# z001 Deploy Template

This directory contains the public deploy template plus any private local backup files you choose to keep.
'@
Ensure-EmptyFile (Join-Path $StationRoot 'backups\z001-source\.gitkeep')
Ensure-EmptyFile (Join-Path $StationRoot 'backups\z001-deploy\.gitkeep')

Ensure-TextFile (Join-Path $StationRoot 'obsidian-knowledge-base\README.md') @'
# Obsidian Knowledge Base

This is the local vault root.

- `WeWe-RSS-AI` is the AI main library.
- `Feeds` is the compatibility layer.
'@
Ensure-TextFile (Join-Path $StationRoot 'obsidian-knowledge-base\.gitignore') @'
.obsidian/workspace*.json
.obsidian/cache
'@
Ensure-EmptyFile (Join-Path $StationRoot 'obsidian-knowledge-base\Feeds\.gitkeep')
Ensure-EmptyFile (Join-Path $StationRoot 'obsidian-knowledge-base\WeWe-RSS-AI\.gitkeep')

if ($CreateLocalEnvTemplates) {
  Copy-IfMissing `
    (Join-Path $backendRoot 'apps\server\.env.local.example') `
    (Join-Path $backendRoot 'apps\server\.env')
  Copy-IfMissing `
    (Join-Path $backendRoot 'apps\web\.env.local.example') `
    (Join-Path $backendRoot 'apps\web\.env')
}

$summary = @(
  "Station root: $StationRoot",
  "Backend repo: $backendRoot",
  "AI vault: $(Join-Path $StationRoot 'obsidian-knowledge-base\WeWe-RSS-AI')",
  "Secrets dir: $(Join-Path $StationRoot 'secrets\wewe-rss')",
  "Backups dir: $(Join-Path $StationRoot 'backups')"
)

Write-Host ($summary -join [Environment]::NewLine)
Write-Host 'Station initialization complete.'

if ($CreateLocalEnvTemplates) {
  Write-Host 'Local .env files were created from example templates when missing.'
}
