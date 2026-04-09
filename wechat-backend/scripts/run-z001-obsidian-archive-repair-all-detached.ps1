param(
  [string]$RemoteHost = 'biosphere@z001.tail904288.ts.net',
  [string]$RemoteDeployDir = '/home/ifs1/app/wewe-rss-stack/deploy/z001',
  [string]$SshKeyPath = '',
  [string]$SshKnownHostsPath = '',
  [string]$RepairContainerName = 'z001-obsidian-archive-repair-all',
  [string]$VaultPath = '/vault/WeWe-RSS-AI',
  [string]$BaseUrl = 'http://app:4000',
  [string]$Mode = 'fulltext',
  [int]$Limit = 10,
  [int]$TimeoutMs = 120000,
  [int]$ConnectTimeoutSeconds = 10
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
    Write-Host "SSH command failed."
    Write-Host "RemoteHost: $RemoteHost"
    Write-Host "RemoteCmd:  $Command"
    throw "ssh failed with exit code $LASTEXITCODE."
  }
}

$repoRoot = Get-RepoRoot
$tempRoot = Join-Path $env:TEMP 'wewe-rss-deploy'
if (-not (Test-Path -LiteralPath $tempRoot)) {
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
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

$scpArgs = @(
  '-i', $SshKeyPath,
  '-o', 'BatchMode=yes',
  '-o', 'IdentitiesOnly=yes',
  '-o', "UserKnownHostsFile=$SshKnownHostsPath",
  '-o', 'StrictHostKeyChecking=accept-new'
)

$remoteScript = @'
set -euo pipefail

remote_deploy_dir="$1"
repair_container_name="$2"
vault_path="$3"
base_url="$4"
mode="$5"
limit="$6"
timeout_ms="$7"

cd "$remote_deploy_dir"

if docker inspect "$repair_container_name" >/dev/null 2>&1; then
  status="$(docker inspect -f '{{.State.Status}}' "$repair_container_name")"
  if [ "$status" = "running" ]; then
    echo "Repair container already running: $repair_container_name"
    exit 0
  fi

  docker rm -f "$repair_container_name" >/dev/null
fi

docker compose run -d --name "$repair_container_name" --no-deps -T obsidian-archive \
  node /app/scripts/obsidian-archive-worker.mjs \
  --once \
  --vault "$vault_path" \
  --base-url "$base_url" \
  --mode "$mode" \
  --limit "$limit" \
  --timeout "$timeout_ms" \
  --repair-all

for attempt in $(seq 1 10); do
  if docker inspect "$repair_container_name" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker inspect "$repair_container_name" >/dev/null 2>&1
echo "Started detached repair container: $repair_container_name"
'@

$remoteScriptPath = Join-Path $tempRoot ("repair-all-" + [guid]::NewGuid().ToString('n') + ".sh")

try {
  if (-not (Test-Path -LiteralPath $repoRoot)) {
    throw "Repository root not found: $repoRoot"
  }

  $remoteScriptLf = $remoteScript -replace "`r`n", "`n"
  [System.IO.File]::WriteAllText(
    $remoteScriptPath,
    $remoteScriptLf,
    [System.Text.UTF8Encoding]::new($false)
  )

  $remoteTempDir = '/tmp/wewe-rss-deploy'
  $remoteTempScript = "$remoteTempDir/" + [System.IO.Path]::GetFileName($remoteScriptPath)

  Invoke-Remote "mkdir -p $remoteTempDir"
  & scp @scpArgs $remoteScriptPath "${RemoteHost}:$remoteTempScript"
  Assert-LastExitCode 'Upload detached repair script'

  Invoke-Remote "chmod +x $remoteTempScript && bash $remoteTempScript $RemoteDeployDir $RepairContainerName $VaultPath $BaseUrl $Mode $Limit $TimeoutMs && rm -f $remoteTempScript"
  Write-Host "Detached repair-all started on $RemoteHost"
  Write-Host "Container: $RepairContainerName"
} finally {
  if (Test-Path -LiteralPath $remoteScriptPath) {
    Remove-Item -LiteralPath $remoteScriptPath -Force -ErrorAction SilentlyContinue
  }
}
