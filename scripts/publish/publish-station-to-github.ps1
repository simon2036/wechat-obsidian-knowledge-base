[CmdletBinding()]
param(
  [string]$StationRoot = '',
  [string]$BackendRepoRoot = '',
  [string]$ExportRoot = '',
  [string]$RepositoryUrl = 'https://github.com/simon2036/wechat-obsidian-knowledge-base.git',
  [string]$RemoteName = 'origin',
  [string]$BranchName = 'main',
  [string]$CommitMessage = 'publish station snapshot',
  [bool]$ForcePush = $true,
  [switch]$SkipRemoteVerify,
  [switch]$NoPush
)

$ErrorActionPreference = 'Stop'

function Ensure-Directory {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Remove-PathIfExists {
  param([string]$Path)

  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

function Copy-FileIfExists {
  param(
    [string]$Source,
    [string]$Destination
  )

  if (Test-Path -LiteralPath $Source) {
    Ensure-Directory (Split-Path -Parent $Destination)
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
  }
}

function Copy-DirectoryContentsIfExists {
  param(
    [string]$Source,
    [string]$Destination
  )

  if (Test-Path -LiteralPath $Source) {
    Ensure-Directory $Destination
    Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
    }
  }
}

function Write-EmptyFile {
  param([string]$Path)

  Ensure-Directory (Split-Path -Parent $Path)
  Set-Content -LiteralPath $Path -Value '' -NoNewline
}

function Assert-PathExists {
  param(
    [string]$Path,
    [string]$Label
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Missing required path in remote snapshot: $Label ($Path)"
  }
}

function Assert-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required tool: $Name"
  }
}

Assert-Command git
Assert-Command tar

if ([string]::IsNullOrWhiteSpace($StationRoot)) {
  $StationRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

$StationRoot = (Resolve-Path -LiteralPath $StationRoot).Path

if ([string]::IsNullOrWhiteSpace($BackendRepoRoot)) {
  $BackendRepoRoot = Join-Path $StationRoot 'wechat-backend'
}

$BackendRepoRoot = (Resolve-Path -LiteralPath $BackendRepoRoot).Path

if ([string]::IsNullOrWhiteSpace($ExportRoot)) {
  $ExportRoot = Join-Path $env:TEMP 'wechat-obsidian-knowledge-base-github-export'
}

if ($ExportRoot -eq $StationRoot) {
  throw 'ExportRoot cannot be the same as StationRoot.'
}

if (-not (Test-Path -LiteralPath (Join-Path $BackendRepoRoot '.git'))) {
  throw "Backend git repository not found: $BackendRepoRoot"
}

Write-Host "Station root: $StationRoot"
Write-Host "Backend repo: $BackendRepoRoot"
Write-Host "Export root: $ExportRoot"

Remove-PathIfExists $ExportRoot
Ensure-Directory $ExportRoot

# Root files
Copy-FileIfExists (Join-Path $StationRoot 'README.md') (Join-Path $ExportRoot 'README.md')
Copy-FileIfExists (Join-Path $StationRoot '.gitignore') (Join-Path $ExportRoot '.gitignore')
Copy-FileIfExists (Join-Path $StationRoot 'initialize-station.cmd') (Join-Path $ExportRoot 'initialize-station.cmd')
Copy-FileIfExists (Join-Path $StationRoot 'open-llm-wiki-tools.cmd') (Join-Path $ExportRoot 'open-llm-wiki-tools.cmd')
Copy-FileIfExists (Join-Path $StationRoot 'open-wewe-rss-dash.cmd') (Join-Path $ExportRoot 'open-wewe-rss-dash.cmd')
Copy-FileIfExists (Join-Path $StationRoot 'publish-station-to-github.cmd') (Join-Path $ExportRoot 'publish-station-to-github.cmd')
Copy-DirectoryContentsIfExists (Join-Path $StationRoot 'scripts') (Join-Path $ExportRoot 'scripts')

# Secrets placeholders
Copy-FileIfExists (Join-Path $StationRoot 'secrets\README.md') (Join-Path $ExportRoot 'secrets\README.md')
Copy-FileIfExists (Join-Path $StationRoot 'secrets\wewe-rss\README.md') (Join-Path $ExportRoot 'secrets\wewe-rss\README.md')
Write-EmptyFile (Join-Path $ExportRoot 'secrets\wewe-rss\.gitkeep')

# Obsidian placeholders
Copy-FileIfExists (Join-Path $StationRoot 'obsidian-knowledge-base\README.md') (Join-Path $ExportRoot 'obsidian-knowledge-base\README.md')
Copy-FileIfExists (Join-Path $StationRoot 'obsidian-knowledge-base\.gitignore') (Join-Path $ExportRoot 'obsidian-knowledge-base\.gitignore')
Write-EmptyFile (Join-Path $ExportRoot 'obsidian-knowledge-base\Feeds\.gitkeep')
Write-EmptyFile (Join-Path $ExportRoot 'obsidian-knowledge-base\WeWe-RSS-AI\.gitkeep')

# Backup docs and sanitized deploy template
Copy-FileIfExists (Join-Path $StationRoot 'backups\README.md') (Join-Path $ExportRoot 'backups\README.md')
Copy-FileIfExists (Join-Path $StationRoot 'backups\z001-source\README.md') (Join-Path $ExportRoot 'backups\z001-source\README.md')
Copy-FileIfExists (Join-Path $StationRoot 'backups\z001-deploy\README.md') (Join-Path $ExportRoot 'backups\z001-deploy\README.md')
Write-EmptyFile (Join-Path $ExportRoot 'backups\z001-source\.gitkeep')
Write-EmptyFile (Join-Path $ExportRoot 'backups\z001-deploy\.gitkeep')

foreach ($relativePath in @(
  'backups\z001-deploy\.env.example',
  'backups\z001-deploy\feeds.example.json',
  'backups\z001-deploy\bootstrap-z001.sh',
  'backups\z001-deploy\docker-compose.yml',
  'backups\z001-deploy\caddy\Caddyfile'
)) {
  Copy-FileIfExists (Join-Path $StationRoot $relativePath) (Join-Path $ExportRoot $relativePath)
}

Copy-DirectoryContentsIfExists `
  (Join-Path $StationRoot 'backups\z001-deploy\systemd-user') `
  (Join-Path $ExportRoot 'backups\z001-deploy\systemd-user')

# Export backend repository at HEAD into nested folder
$archivePath = Join-Path $env:TEMP 'wechat-backend-export.tar'
Remove-PathIfExists $archivePath

git -C $BackendRepoRoot archive --format=tar --output=$archivePath HEAD
if ($LASTEXITCODE -ne 0) {
  throw 'git archive failed.'
}

Ensure-Directory (Join-Path $ExportRoot 'wechat-backend')
tar -xf $archivePath -C (Join-Path $ExportRoot 'wechat-backend')
if ($LASTEXITCODE -ne 0) {
  throw 'tar extraction failed.'
}

Remove-PathIfExists $archivePath

# Guardrails
$forbiddenNames = @('.env', 'feeds.json', 'z001_id_ed25519', 'known_hosts')
$violations = Get-ChildItem -Path $ExportRoot -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $forbiddenNames -contains $_.Name }

if ($violations) {
  $violationList = ($violations.FullName | Sort-Object) -join "`n"
  throw "Forbidden files detected in export:`n$violationList"
}

$exportReadme = Get-Content -LiteralPath (Join-Path $ExportRoot 'README.md') -Raw
if ($exportReadme -notmatch 'article \+ obsidian AI') {
  throw 'Exported root README does not contain the expected project tagline.'
}

Push-Location $ExportRoot
$expectedHead = ''
try {
  Remove-PathIfExists '.git'

  git init -b $BranchName | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'git init failed.' }

  git config user.name 'Codex'
  git config user.email 'codex@noreply.local'
  git add .
  if ($LASTEXITCODE -ne 0) { throw 'git add failed.' }

  git commit -m $CommitMessage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'git commit failed.' }

  $expectedHead = (git rev-parse HEAD).Trim()
  if (-not $expectedHead) { throw 'git rev-parse HEAD failed.' }

  if (-not $NoPush) {
    $existingRemote = (git remote | Where-Object { $_ -eq $RemoteName })
    if ($existingRemote) {
      git remote remove $RemoteName | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "git remote remove $RemoteName failed." }
    }

    git remote add $RemoteName $RepositoryUrl
    if ($LASTEXITCODE -ne 0) { throw 'git remote add failed.' }

    if ($ForcePush) {
      git push $RemoteName $BranchName --force
    } else {
      git push $RemoteName $BranchName
    }

    if ($LASTEXITCODE -ne 0) { throw 'git push failed.' }
  }
} finally {
  Pop-Location
}

if (-not $NoPush -and -not $SkipRemoteVerify) {
  $verifyRoot = Join-Path $env:TEMP 'wechat-obsidian-knowledge-base-github-verify'
  Remove-PathIfExists $verifyRoot

  git clone --depth 1 --branch $BranchName $RepositoryUrl $verifyRoot | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'Remote verification clone failed.'
  }

  try {
    foreach ($requiredPath in @(
      'README.md',
      'initialize-station.cmd',
      'open-llm-wiki-tools.cmd',
      'publish-station-to-github.cmd',
      'scripts\publish\publish-station-to-github.ps1',
      'obsidian-knowledge-base\Feeds\.gitkeep',
      'obsidian-knowledge-base\WeWe-RSS-AI\.gitkeep',
      'secrets\wewe-rss\.gitkeep',
      'backups\z001-source\.gitkeep',
      'backups\z001-deploy\.env.example',
      'backups\z001-deploy\docker-compose.yml',
      'backups\z001-deploy\feeds.example.json',
      'wechat-backend\README.md'
    )) {
      Assert-PathExists (Join-Path $verifyRoot $requiredPath) $requiredPath
    }

    $remoteViolations = Get-ChildItem -Path $verifyRoot -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $forbiddenNames -contains $_.Name }
    if ($remoteViolations) {
      $remoteViolationList = ($remoteViolations.FullName | Sort-Object) -join "`n"
      throw "Forbidden files detected in remote snapshot:`n$remoteViolationList"
    }

    $remoteReadme = Get-Content -LiteralPath (Join-Path $verifyRoot 'README.md') -Raw
    if ($remoteReadme -notmatch 'article \+ obsidian AI') {
      throw 'Remote README verification failed: expected tagline not found.'
    }

    $remoteHead = (git -C $verifyRoot rev-parse HEAD).Trim()
    if (-not $remoteHead) {
      throw 'Remote verification failed: unable to resolve HEAD.'
    }
    if ($expectedHead -and $remoteHead -ne $expectedHead) {
      throw "Remote verification failed: expected HEAD $expectedHead but found $remoteHead."
    }

    Write-Host "Remote snapshot verified at commit $remoteHead"
  } finally {
    Remove-PathIfExists $verifyRoot
  }
}

Write-Host "Station snapshot exported to $ExportRoot"
if ($NoPush) {
  Write-Host 'Push skipped because -NoPush was provided.'
}
