param(
  [string]$RemoteHost = 'biosphere@z001.tail904288.ts.net',
  [string]$RemoteBareRepoPath = '/home/ifs1/app/wewe-rss-stack/data/obsidian/repos/folo-rss-vault.git',
  [string]$LocalVaultPath = '',
  [string]$SshKeyPath = '',
  [string]$SshKnownHostsPath = '',
  [TimeSpan]$DailyAt = ([TimeSpan]::Parse('07:10:00')),
  [string]$StateDir = "$env:LOCALAPPDATA\WeWeRSS",
  [switch]$Once
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
    throw "Missing required command '$Name'."
  }
}

function Assert-LastExitCode {
  param([string]$ActionName)
  if ($LASTEXITCODE -ne 0) {
    throw "$ActionName failed with exit code $LASTEXITCODE."
  }
}

function Get-NextRunTime {
  param([TimeSpan]$TimeOfDay)

  $now = Get-Date
  $todayTarget = $now.Date + $TimeOfDay
  if ($now -lt $todayTarget) {
    return $todayTarget
  }

  return $todayTarget.AddDays(1)
}

function Get-LockPath {
  param([string]$Root)

  return Join-Path $Root 'mirror.lock'
}

Require-Command powershell.exe

if (-not $PSBoundParameters.ContainsKey('LocalVaultPath') -or [string]::IsNullOrWhiteSpace($LocalVaultPath)) {
  $LocalVaultPath = Get-DefaultLocalVaultPath
}

if (-not $PSBoundParameters.ContainsKey('SshKeyPath') -or [string]::IsNullOrWhiteSpace($SshKeyPath)) {
  $SshKeyPath = Join-Path (Get-DefaultSecretRoot) 'z001_id_ed25519'
}

if (-not $PSBoundParameters.ContainsKey('SshKnownHostsPath') -or [string]::IsNullOrWhiteSpace($SshKnownHostsPath)) {
  $SshKnownHostsPath = Join-Path (Get-DefaultSecretRoot) 'known_hosts'
}

if (-not (Test-Path -LiteralPath $StateDir)) {
  New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
}

$lockPath = Get-LockPath $StateDir
$statePath = Join-Path $StateDir 'mirror-state.json'
$logPath = Join-Path $StateDir 'mirror.log'

if (Test-Path -LiteralPath $lockPath) {
  Write-Host "Another mirror agent instance is already running."
  return
}

New-Item -ItemType File -Path $lockPath -Force | Out-Null

try {
  $syncScript = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')).Path 'scripts\sync-z001-obsidian-vault.ps1'
  $nextRun = Get-NextRunTime -TimeOfDay $DailyAt
  $state = $null
  if (Test-Path -LiteralPath $statePath) {
    try {
      $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
      if ($state.nextRunAt) {
        $parsed = [datetime]::Parse($state.nextRunAt)
        if ((Get-Date) -ge $parsed) {
          $nextRun = Get-Date
        } else {
          $nextRun = $parsed
        }
      }
    } catch {
      $state = $null
    }
  } else {
    $nextRun = Get-Date
  }

  while ($true) {
    $now = Get-Date
    if ($now -ge $nextRun) {
      $timestamp = $now.ToString('s')
      Add-Content -LiteralPath $logPath -Value "[$timestamp] mirror sync starting"

      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript `
        -RemoteHost $RemoteHost `
        -RemoteBareRepoPath $RemoteBareRepoPath `
        -LocalVaultPath $LocalVaultPath `
        -SshKeyPath $SshKeyPath `
        -SshKnownHostsPath $SshKnownHostsPath
      Assert-LastExitCode 'Mirror sync'

      $state = @{
        lastRunAt = (Get-Date).ToString('o')
        nextRunAt = (Get-NextRunTime -TimeOfDay $DailyAt).ToString('o')
      }
      Set-Content -LiteralPath $statePath -Value ($state | ConvertTo-Json -Depth 4) -Encoding utf8
      Add-Content -LiteralPath $logPath -Value "[$timestamp] mirror sync finished"
      $nextRun = Get-NextRunTime -TimeOfDay $DailyAt
    }

    $sleepSeconds = [Math]::Max(60, [int](($nextRun - (Get-Date)).TotalSeconds))
    Start-Sleep -Seconds $sleepSeconds
  }
} finally {
  if (Test-Path -LiteralPath $lockPath) {
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
  }
}
