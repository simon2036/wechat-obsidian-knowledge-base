param(
  [string]$RemoteHost = 'biosphere@z001.tail904288.ts.net',
  [string]$RemoteDeployDir = '/home/ifs1/app/wewe-rss-stack/deploy/z001',
  [string]$RepairContainerName = 'z001-obsidian-archive-repair-all',
  [string]$SshKeyPath = '',
  [string]$SshKnownHostsPath = '',
  [int]$ConnectTimeoutSeconds = 10,
  [int]$LogTail = 120
)

$ErrorActionPreference = 'Stop'

function Get-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

function Get-StationRoot {
  return Split-Path -Parent (Get-RepoRoot)
}

function Get-DefaultSecretRoot {
  return Join-Path (Get-StationRoot) 'secrets\wewe-rss'
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

Write-Host "Detached repair-all status for $RemoteHost"
$remoteCommand = "bash -lc 'set -euo pipefail; cd $RemoteDeployDir; echo service:; docker compose ps obsidian-archive; echo; echo repair_container:; container_id=`$(docker ps -aq --filter ""name=^/${RepairContainerName}$"" | sed -n ''1p''); if [ -n ""`$container_id"" ]; then docker inspect -f ""id={{.Id}},name={{.Name}},status={{.State.Status}},exit={{.State.ExitCode}},started={{.State.StartedAt}},finished={{.State.FinishedAt}}"" ""`$container_id""; echo; echo logs:; docker logs --tail $LogTail ""`$container_id"" || true; else echo ""not found: $RepairContainerName""; fi'"
Invoke-Remote $remoteCommand
