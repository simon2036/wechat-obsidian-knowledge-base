param(
  # Remote SSH target (Tailscale or LAN reachable).
  [string]$RemoteHost = 'biosphere@z001.tail904288.ts.net',

  # Remote bare repo that the bridge pushes to.
  [string]$RemoteBareRepoPath = '/home/ifs1/app/wewe-rss-stack/data/obsidian/repos/folo-rss-vault.git',

  # Local vault path on this Windows machine.
  [string]$LocalVaultPath = '',

  # SSH private key used for remote access.
  [string]$SshKeyPath = '',

  # SSH known_hosts file used for remote access.
  [string]$SshKnownHostsPath = '',

  # Use a shallow clone for faster initial sync (history is not needed for local reading/indexing).
  [switch]$Shallow,

  # Allow syncing into a non-empty directory without .git (still won't delete anything).
  [switch]$Force
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

function Require-Command {
  param([string]$Name)

  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw "Missing required command '$Name'. Install it and ensure it's on PATH."
  }
}

function Assert-LastExitCode {
  param([string]$Action)
  if ($LASTEXITCODE -ne 0) {
    throw "$Action failed with exit code $LASTEXITCODE."
  }
}

Require-Command git
Require-Command ssh

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

$sshOptions = @(
  '-i', $SshKeyPath,
  '-o', 'BatchMode=yes',
  '-o', 'IdentitiesOnly=yes',
  '-o', "UserKnownHostsFile=$SshKnownHostsPath",
  '-o', 'StrictHostKeyChecking=accept-new'
)

$env:GIT_SSH_COMMAND = "ssh -i `"$SshKeyPath`" -o BatchMode=yes -o IdentitiesOnly=yes -o UserKnownHostsFile=`"$SshKnownHostsPath`" -o StrictHostKeyChecking=accept-new"

$remoteUrl = "${RemoteHost}:${RemoteBareRepoPath}"

Write-Host "Remote vault repo: $remoteUrl"
Write-Host "Local vault path: $LocalVaultPath"

# Validate remote path exists early to avoid confusing git errors.
& ssh @sshOptions $RemoteHost "test -d '$RemoteBareRepoPath' && echo OK"
Assert-LastExitCode 'Validate remote vault repo path'

if (-not (Test-Path -LiteralPath $LocalVaultPath)) {
  New-Item -ItemType Directory -Path $LocalVaultPath | Out-Null
}

$gitDir = Join-Path $LocalVaultPath '.git'

if (Test-Path -LiteralPath $gitDir) {
  Write-Host "Detected existing git repo. Pulling latest (ff-only)..."

  # Ensure origin points to the expected remote.
  $currentOrigin = (& git -C $LocalVaultPath remote get-url origin 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $currentOrigin) {
    & git -C $LocalVaultPath remote add origin $remoteUrl
    Assert-LastExitCode 'Add origin remote'
  } elseif ($currentOrigin.Trim() -ne $remoteUrl) {
    & git -C $LocalVaultPath remote set-url origin $remoteUrl
    Assert-LastExitCode 'Set origin remote url'
  }

  & git -C $LocalVaultPath fetch --prune origin
  Assert-LastExitCode 'Fetch origin'

  # Prefer main; fall back to current branch if main doesn't exist locally.
  $currentBranch = (& git -C $LocalVaultPath branch --show-current 2>$null).Trim()
  if ($currentBranch -ne 'main') {
    & git -C $LocalVaultPath checkout main 2>$null
    if ($LASTEXITCODE -ne 0) {
      & git -C $LocalVaultPath checkout -B main origin/main
      Assert-LastExitCode 'Checkout main'
    }
  }

  & git -C $LocalVaultPath pull --ff-only origin main
  Assert-LastExitCode 'Pull origin/main'

  Write-Host "Sync complete."
  exit 0
}

# No .git yet: refuse to initialize into a non-empty dir unless -Force.
$existing = Get-ChildItem -LiteralPath $LocalVaultPath -Force -ErrorAction SilentlyContinue
if ($existing -and $existing.Count -gt 0 -and -not $Force) {
  throw "LocalVaultPath is not empty and is not a git repo: $LocalVaultPath. Choose an empty directory, or rerun with -Force."
}

Write-Host "Cloning vault repo..."
if ($Shallow) {
  & git clone --depth 1 --single-branch --origin origin --branch main $remoteUrl $LocalVaultPath
} else {
  & git clone --origin origin --branch main $remoteUrl $LocalVaultPath
}
Assert-LastExitCode 'Clone vault repo'

Write-Host "Clone complete."
