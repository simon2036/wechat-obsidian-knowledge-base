param(
  [ValidateSet('Install', 'Status', 'RunNow', 'Uninstall')]
  [string]$Action = 'Install',

  [string]$TaskName = 'WeWe RSS Obsidian Mirror',

  [string]$TaskPath = '\WeWe RSS\',

  [TimeSpan]$DailyAt = ([TimeSpan]::Parse('07:10:00')),

  [string]$RemoteHost = 'biosphere@z001.tail904288.ts.net',

  [string]$RemoteBareRepoPath = '/home/ifs1/app/wewe-rss-stack/data/obsidian/repos/folo-rss-vault.git',

  [string]$LocalVaultPath = '',

  [string]$SshKeyPath = '',

  [string]$SshKnownHostsPath = '',

  [switch]$Shallow,

  [switch]$Force
)

$ErrorActionPreference = 'Stop'

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

function Escape-PowerShellArgument {
  param([string]$Value)

  return '"' + ($Value -replace '"', '\"') + '"'
}

function Get-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

function Get-StationRoot {
  return Split-Path -Parent (Get-RepoRoot)
}

function Get-SyncScriptPath {
  return Join-Path (Get-RepoRoot) 'scripts\sync-z001-obsidian-vault.ps1'
}

function Get-DefaultLocalVaultPath {
  return Join-Path (Get-StationRoot) 'obsidian-knowledge-base'
}

function Get-DefaultSecretRoot {
  return Join-Path (Get-StationRoot) 'secrets\wewe-rss'
}

function Get-TaskFullName {
  param(
    [string]$Name,
    [string]$Path
  )

  return ($Path.TrimEnd('\') + '\' + $Name).Replace('\\', '\')
}

Require-Command powershell.exe
Require-Command git
Require-Command ssh
Require-Command ssh-keyscan.exe
Require-Command icacls.exe

if (-not $PSBoundParameters.ContainsKey('LocalVaultPath') -or [string]::IsNullOrWhiteSpace($LocalVaultPath)) {
  $LocalVaultPath = Get-DefaultLocalVaultPath
}

if (-not $PSBoundParameters.ContainsKey('SshKeyPath') -or [string]::IsNullOrWhiteSpace($SshKeyPath)) {
  $SshKeyPath = Join-Path (Get-DefaultSecretRoot) 'z001_id_ed25519'
}

if (-not $PSBoundParameters.ContainsKey('SshKnownHostsPath') -or [string]::IsNullOrWhiteSpace($SshKnownHostsPath)) {
  $SshKnownHostsPath = Join-Path (Get-DefaultSecretRoot) 'known_hosts'
}

$syncScriptPath = Get-SyncScriptPath
if (-not (Test-Path -LiteralPath $syncScriptPath)) {
  throw "Sync script not found: $syncScriptPath"
}

$powershellExe = Join-Path $PSHOME 'powershell.exe'
$dailyAtDateTime = (Get-Date).Date + $DailyAt
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$remoteUserHost = $RemoteHost
if ($RemoteHost -notmatch '@') {
  $remoteUserHost = "biosphere@$RemoteHost"
}

function Ensure-SecretFiles {
  param(
    [string]$DestinationKeyPath,
    [string]$DestinationKnownHostsPath,
    [string]$HostForScan,
    [string]$Owner
  )

  $destinationDir = Split-Path -Parent $DestinationKeyPath
  if (-not (Test-Path -LiteralPath $destinationDir)) {
    New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
  }

  if (-not (Test-Path -LiteralPath $DestinationKeyPath)) {
    throw "Missing station SSH key: $DestinationKeyPath"
  }

  if (-not (Test-Path -LiteralPath $DestinationKnownHostsPath)) {
    New-Item -ItemType File -Path $DestinationKnownHostsPath -Force | Out-Null
  }

  $stdoutPath = [System.IO.Path]::GetTempFileName()
  $stderrPath = [System.IO.Path]::GetTempFileName()
  try {
    $process = Start-Process -FilePath (Get-Command ssh-keyscan.exe).Source `
      -ArgumentList @('-H', $HostForScan) `
      -NoNewWindow `
      -PassThru `
      -Wait `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath

    $scanOutput = Get-Content -LiteralPath $stdoutPath -ErrorAction SilentlyContinue
    if ($process.ExitCode -eq 0 -and $scanOutput) {
      Set-Content -LiteralPath $DestinationKnownHostsPath -Value $scanOutput -Encoding ascii
    }
  } finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  }

  & icacls.exe $DestinationKeyPath /inheritance:r /grant:r "$Owner:F" "SYSTEM:R" | Out-Null
  Assert-LastExitCode 'Set SSH key ACL'
  & icacls.exe $DestinationKnownHostsPath /inheritance:r /grant:r "$Owner:F" "SYSTEM:R" | Out-Null
  Assert-LastExitCode 'Set known_hosts ACL'
}

function Get-HostForScan {
  param([string]$Value)

  if ($Value -match '@(.+)$') {
    return $Matches[1]
  }

  return $Value
}

$taskArgs = @(
  '-NoProfile',
  '-ExecutionPolicy Bypass',
  '-File ' + (Escape-PowerShellArgument $syncScriptPath),
  '-RemoteHost ' + (Escape-PowerShellArgument $RemoteHost),
  '-RemoteBareRepoPath ' + (Escape-PowerShellArgument $RemoteBareRepoPath),
  '-LocalVaultPath ' + (Escape-PowerShellArgument $LocalVaultPath),
  '-SshKeyPath ' + (Escape-PowerShellArgument $SshKeyPath),
  '-SshKnownHostsPath ' + (Escape-PowerShellArgument $SshKnownHostsPath)
)

if ($Shallow) {
  $taskArgs += '-Shallow'
}

if ($Force) {
  $taskArgs += '-Force'
}

$taskAction = New-ScheduledTaskAction `
  -Execute $powershellExe `
  -Argument ($taskArgs -join ' ') `
  -WorkingDirectory (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

$taskTrigger = New-ScheduledTaskTrigger -Daily -At $dailyAtDateTime

$taskSettings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -WakeToRun `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 6)

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
switch ($Action) {
  'Install' {
    Ensure-SecretFiles `
      -DestinationKeyPath $SshKeyPath `
      -DestinationKnownHostsPath $SshKnownHostsPath `
      -HostForScan (Get-HostForScan $remoteUserHost) `
      -Owner $currentUser

    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount

    Register-ScheduledTask `
      -TaskName $TaskName `
      -TaskPath $TaskPath `
      -Action $taskAction `
      -Trigger $taskTrigger `
      -Settings $taskSettings `
      -Principal $principal `
      -Description 'Daily mirror of the WeWe RSS Obsidian vault from z001 to this Windows machine.' `
      -Force | Out-Null

    Write-Host "Installed scheduled task: $TaskPath$TaskName"
    Write-Host "Runs daily at $($dailyAtDateTime.ToString('HH:mm'))."
    Write-Host "Task command:"
    Write-Host "$powershellExe $($taskArgs -join ' ')"
    Write-Host "SSH key: $SshKeyPath"
    Write-Host "Known hosts: $SshKnownHostsPath"
  }

  'Status' {
    try {
      $task = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction Stop
      $info = Get-ScheduledTaskInfo -TaskName $TaskName -TaskPath $TaskPath
    } catch {
      $task = Get-ScheduledTask | Where-Object { $_.TaskName -eq $TaskName -and $_.TaskPath -eq $TaskPath } | Select-Object -First 1
      if (-not $task) {
        $task = Get-ScheduledTask | Where-Object { $_.TaskName -eq $TaskName } | Select-Object -First 1
      }

      if (-not $task) {
        Write-Host "Scheduled task not found: $(Get-TaskFullName -Name $TaskName -Path $TaskPath)"
        return
      }

      $info = Get-ScheduledTaskInfo -TaskName $task.TaskName -TaskPath $task.TaskPath
    }

    if ($task) {
      [pscustomobject]@{
        TaskName = $task.TaskName
        TaskPath = $task.TaskPath
        State = $task.State
        NextRunTime = $info.NextRunTime
        LastRunTime = $info.LastRunTime
        LastTaskResult = $info.LastTaskResult
        Author = $task.Author
        Description = $task.Description
      } | Format-List
    }
  }

  'RunNow' {
    Start-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath
    Write-Host "Started scheduled task: $TaskPath$TaskName"
  }

  'Uninstall' {
    Unregister-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Confirm:$false
    Write-Host "Removed scheduled task: $TaskPath$TaskName"
  }
}
