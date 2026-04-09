param(
  [string]$RemoteHost = 'biosphere@z001.tail904288.ts.net',
  [string]$RemoteDeployDir = '/home/ifs1/app/wewe-rss-stack/deploy/z001',
  [string]$SshKeyPath = '',
  [string]$SshKnownHostsPath = '',
  [string[]]$FeedUrl,
  [int]$Limit = 10,
  [int]$TimeoutMs = 120000,
  [int]$ConnectTimeoutSeconds = 10,
  [switch]$NoDiscover,
  [switch]$IncludeAllFeed,
  [switch]$RepairAll,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$Limit = [Math]::Max(10, $Limit)
$TimeoutMs = [Math]::Max(30000, $TimeoutMs)

function Get-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

function Get-StationRoot {
  return Split-Path -Parent (Get-RepoRoot)
}

function Get-DefaultSecretRoot {
  return Join-Path (Get-StationRoot) 'secrets\wewe-rss'
}

function Assert-LastExitCode {
  param(
    [string]$Action
  )
  if ($LASTEXITCODE -ne 0) {
    throw "$Action failed with exit code $LASTEXITCODE."
  }
}

function Invoke-Remote {
  param(
    [string]$Command
  )

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
    Write-Host "SSH command failed."
    Write-Host "RemoteHost: $RemoteHost"
    Write-Host "RemoteCmd:  $Command"
    Write-Host ""
    Write-Host "Troubleshooting:"
    Write-Host "- Verify you can run: ssh $RemoteHost"
    Write-Host "- Verify Tailscale is connected (tailnet) and not hijacked by a proxy"
    Write-Host "- If on Windows, check whether port 22 to the tailnet host is reachable"
    throw "ssh failed with exit code $LASTEXITCODE."
  }
}

# Preflight: make sure we can reach host and the service exists.
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

Invoke-Remote "cd $RemoteDeployDir && docker compose ps obsidian-archive"

if ($FeedUrl -and $FeedUrl.Count -gt 0) {
  Write-Host "Note: -FeedUrl is ignored by the one-click wrapper. Use the worker directly if you need custom feed URLs."
}

$workerArgs = @(
  'cd', $RemoteDeployDir, '&&',
  'docker', 'compose', 'run', '--rm', '--no-deps', '-T',
  'obsidian-archive',
  'node', '/app/scripts/obsidian-archive-worker.mjs',
  '--once',
  '--vault', '/vault/WeWe-RSS-AI',
  '--base-url', 'http://app:4000',
  '--mode', 'fulltext',
  '--limit', $Limit,
  '--timeout', $TimeoutMs,
  '--repair-feed-sourced'
)

if ($DryRun) {
  $workerArgs += '--dry-run'
}

if ($NoDiscover) {
  $workerArgs += '--no-discover'
}

if ($IncludeAllFeed) {
  $workerArgs += '--include-all'
}

if ($RepairAll) {
  $workerArgs += '--repair-all'
}

$remoteCmd = ($workerArgs -join ' ')

Write-Host "Triggering manual archive sync on $RemoteHost ..."
Write-Host "Remote: $remoteCmd"
Invoke-Remote $remoteCmd

Write-Host "Manual archive sync finished."
