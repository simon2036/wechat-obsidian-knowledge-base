param(
  [string]$RemoteHost = 'biosphere@z001.tail904288.ts.net',
  [string]$RemoteDeployDir = '/home/ifs1/app/wewe-rss-stack/deploy/z001',
  [string]$LocalVaultPath = '',
  [string]$RemoteVaultWorktree = '/home/ifs1/app/wewe-rss-stack/data/obsidian/worktrees/folo-rss-vault',
  [string]$SshKeyPath = '',
  [string]$SshKnownHostsPath = '',
  [int]$ConnectTimeoutSeconds = 10,
  [int]$LogTail = 30
)

$ErrorActionPreference = 'Stop'

function Get-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

function Get-StationRoot {
  return Split-Path -Parent (Get-RepoRoot)
}

function Get-DefaultLocalVaultPath {
  return Join-Path (Get-StationRoot) 'obsidian-knowledge-base'
}

function Get-DefaultSecretRoot {
  return Join-Path (Get-StationRoot) 'secrets\wewe-rss'
}

function Assert-LastExitCode {
  param([string]$Action)
  if ($LASTEXITCODE -ne 0) {
    throw "$Action failed with exit code $LASTEXITCODE."
  }
}

function Invoke-Remote {
  param([string]$Command)

  $sshArgs = @(
    '-i', $SshKeyPath,
    '-o', "ConnectTimeout=$ConnectTimeoutSeconds",
    '-o', 'BatchMode=yes',
    '-o', 'IdentitiesOnly=yes',
    '-o', "UserKnownHostsFile=$SshKnownHostsPath",
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ServerAliveInterval=10',
    '-o', 'ServerAliveCountMax=3'
  )

  & ssh @sshArgs $RemoteHost $Command
  if ($LASTEXITCODE -ne 0) {
    throw "ssh failed with exit code $LASTEXITCODE."
  }
}

if (-not $PSBoundParameters.ContainsKey('LocalVaultPath') -or [string]::IsNullOrWhiteSpace($LocalVaultPath)) {
  $LocalVaultPath = Get-DefaultLocalVaultPath
}

if (-not $PSBoundParameters.ContainsKey('SshKeyPath') -or [string]::IsNullOrWhiteSpace($SshKeyPath)) {
  $SshKeyPath = Join-Path (Get-DefaultSecretRoot) 'z001_id_ed25519'
}

if (-not $PSBoundParameters.ContainsKey('SshKnownHostsPath') -or [string]::IsNullOrWhiteSpace($SshKnownHostsPath)) {
  $SshKnownHostsPath = Join-Path (Get-DefaultSecretRoot) 'known_hosts'
}

if (-not (Test-Path -LiteralPath $SshKeyPath)) {
  throw "Missing SSH key: $SshKeyPath"
}

$knownHostsDir = Split-Path -Parent $SshKnownHostsPath
if (-not (Test-Path -LiteralPath $knownHostsDir)) {
  New-Item -ItemType Directory -Path $knownHostsDir -Force | Out-Null
}

if (-not (Test-Path -LiteralPath $SshKnownHostsPath)) {
  New-Item -ItemType File -Path $SshKnownHostsPath -Force | Out-Null
}

Write-Host "Remote archive status for $RemoteHost"
Invoke-Remote "cd $RemoteDeployDir && docker compose ps obsidian-archive"
Write-Host ""
Write-Host "Recent remote archive logs:"
Invoke-Remote "cd $RemoteDeployDir && docker compose logs --tail $LogTail obsidian-archive"
Write-Host ""

Write-Host "Remote canonical vault status (WeWe-RSS-AI):"
$remoteVaultCommand = "bash -lc 'set -e; cd $RemoteVaultWorktree; echo tracked_files:; git ls-files -- WeWe-RSS-AI | wc -l; echo git_status:; git status --short -- WeWe-RSS-AI || true; echo; echo latest_files:; find WeWe-RSS-AI -maxdepth 3 -type f | sort | tail -n 5 || true'"
Invoke-Remote $remoteVaultCommand
Write-Host ""

if (Test-Path -LiteralPath $LocalVaultPath) {
  Write-Host "Local mirror status for $LocalVaultPath"
  $gitDir = Join-Path $LocalVaultPath '.git'
  $localAiVaultPath = Join-Path $LocalVaultPath 'WeWe-RSS-AI'
  if (Test-Path -LiteralPath $gitDir) {
    & git -C $LocalVaultPath status --short
    Assert-LastExitCode 'Check local vault git status'
    Write-Host ""
    if (Test-Path -LiteralPath $localAiVaultPath) {
      $fileCount = (Get-ChildItem -LiteralPath $localAiVaultPath -Recurse -File | Measure-Object).Count
      Write-Host "Canonical AI vault exists: $localAiVaultPath"
      Write-Host "Canonical AI vault file count: $fileCount"
    } else {
      Write-Warning "Canonical AI vault missing locally: $localAiVaultPath"
      Write-Warning "The Windows mirror is still on the old Feeds-only state."
    }
  } else {
    Write-Host "No git repo found at local vault path."
  }
} else {
  Write-Host "Local vault path does not exist yet: $LocalVaultPath"
}
