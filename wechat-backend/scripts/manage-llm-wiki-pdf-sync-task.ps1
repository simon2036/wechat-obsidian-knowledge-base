param(
  [ValidateSet('Install', 'Status', 'RunNow', 'Uninstall')]
  [string]$Action = 'Install',

  [string]$TaskName = 'LLM Wiki PDF Sync',

  [string]$TaskPath = '\',

  [string[]]$RunTimes = @('09:15', '21:15'),

  [string]$RepoRoot = '',

  [string]$Month = ''
)

$ErrorActionPreference = 'Stop'

function Require-Command {
  param([string]$Name)

  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw "Missing required command '$Name'."
  }
}

function Escape-PowerShellArgument {
  param([string]$Value)

  return '"' + ($Value -replace '"', '\"') + '"'
}

function Normalize-TaskPath {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return '\'
  }

  $normalized = $Value
  if (-not $normalized.StartsWith('\')) {
    $normalized = '\' + $normalized
  }
  if (-not $normalized.EndsWith('\')) {
    $normalized = $normalized + '\'
  }

  return $normalized
}

function Get-TaskFullName {
  param(
    [string]$Name,
    [string]$Path
  )

  return (Normalize-TaskPath $Path).TrimEnd('\') + '\' + $Name
}

function Resolve-InstalledTask {
  param(
    [string]$Name,
    [string]$PreferredPath
  )

  $normalizedPath = Normalize-TaskPath $PreferredPath
  try {
    return Get-ScheduledTask -TaskName $Name -TaskPath $normalizedPath -ErrorAction Stop
  } catch {
    $allTasks = Get-ScheduledTask | Where-Object { $_.TaskName -eq $Name }
    if ($allTasks) {
      return $allTasks | Select-Object -First 1
    }
  }

  return $null
}

function Get-NextTriggerStart {
  param(
    [TimeSpan]$AnchorTime
  )

  $now = Get-Date
  $nextStart = $now.Date + $AnchorTime
  if ($nextStart -le $now) {
    $nextStart = $nextStart.AddDays(1)
  }

  return $nextStart
}

function Get-NormalizedRunTimes {
  param([string[]]$Values)

  $normalized = @()
  foreach ($value in ($Values | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })) {
    $time = [TimeSpan]::Parse(([string]$value).Trim())
    $normalized += $time.ToString('hh\:mm')
  }

  if ($normalized.Count -lt 1 -or $normalized.Count -gt 2) {
    throw 'RunTimes must contain 1 or 2 values in HH:mm format.'
  }

  return $normalized | Sort-Object -Unique
}

function Get-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

Require-Command powershell.exe
Require-Command node

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = Get-RepoRoot
}

$scriptPath = Join-Path $RepoRoot 'scripts\run-llm-wiki-pdf-sync.ps1'
if (-not (Test-Path -LiteralPath $scriptPath)) {
  throw "Runner script not found: $scriptPath"
}

$powershellExe = Join-Path $PSHOME 'powershell.exe'
$TaskPath = Normalize-TaskPath $TaskPath
$normalizedRunTimes = Get-NormalizedRunTimes -Values $RunTimes
$triggerDateTimes = @(
  foreach ($runTime in $normalizedRunTimes) {
    Get-NextTriggerStart -AnchorTime ([TimeSpan]::Parse($runTime))
  }
)

$taskArgs = @(
  '-NoProfile',
  '-ExecutionPolicy Bypass',
  '-File ' + (Escape-PowerShellArgument $scriptPath),
  '-RepoRoot ' + (Escape-PowerShellArgument $RepoRoot),
  '-All'
)

if (-not [string]::IsNullOrWhiteSpace($Month)) {
  $taskArgs += '-Month ' + (Escape-PowerShellArgument $Month)
}

$taskAction = New-ScheduledTaskAction `
  -Execute $powershellExe `
  -Argument ($taskArgs -join ' ') `
  -WorkingDirectory $RepoRoot

$taskTriggers = @(
  foreach ($triggerDateTime in $triggerDateTimes) {
    New-ScheduledTaskTrigger -Daily -At $triggerDateTime
  }
)

$taskSettings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 6)

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

switch ($Action) {
  'Install' {
    $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
    $registeredTaskPath = $TaskPath

    try {
      Register-ScheduledTask `
        -TaskName $TaskName `
        -TaskPath $registeredTaskPath `
        -Action $taskAction `
        -Trigger $taskTriggers `
        -Settings $taskSettings `
        -Principal $principal `
        -Description 'Periodic sync for LLM-Wiki PDF downloads on explicitly allowed feeds.' `
        -Force `
        -ErrorAction Stop | Out-Null
    } catch {
      if ($registeredTaskPath -eq '\') {
        throw
      }

      $registeredTaskPath = '\'
      Register-ScheduledTask `
        -TaskName $TaskName `
        -TaskPath $registeredTaskPath `
        -Action $taskAction `
        -Trigger $taskTriggers `
        -Settings $taskSettings `
        -Principal $principal `
        -Description 'Periodic sync for LLM-Wiki PDF downloads on explicitly allowed feeds.' `
        -Force | Out-Null
    }

    Write-Host "Installed scheduled task: $(Get-TaskFullName -Name $TaskName -Path $registeredTaskPath)"
    Write-Host "Runs daily at: $($normalizedRunTimes -join ', ')."
    if ($registeredTaskPath -ne $TaskPath) {
      Write-Host "Requested task path $TaskPath could not be used on this machine. Installed under root path instead."
    }
    Write-Host "Task command:"
    Write-Host "$powershellExe $($taskArgs -join ' ')"
  }

  'Status' {
    $task = Resolve-InstalledTask -Name $TaskName -PreferredPath $TaskPath
    if (-not $task) {
      Write-Host "Scheduled task not found: $(Get-TaskFullName -Name $TaskName -Path $TaskPath)"
      return
    }

    $info = Get-ScheduledTaskInfo -TaskName $task.TaskName -TaskPath $task.TaskPath
    [pscustomobject]@{
      TaskName = $task.TaskName
      TaskPath = $task.TaskPath
      State = $task.State
      NextRunTime = $info.NextRunTime
      LastRunTime = $info.LastRunTime
      LastTaskResult = $info.LastTaskResult
      Description = $task.Description
    } | Format-List
  }

  'RunNow' {
    $task = Resolve-InstalledTask -Name $TaskName -PreferredPath $TaskPath
    if (-not $task) {
      throw "Scheduled task not found: $(Get-TaskFullName -Name $TaskName -Path $TaskPath)"
    }

    Start-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath
    Write-Host "Started scheduled task: $(Get-TaskFullName -Name $task.TaskName -Path $task.TaskPath)"
  }

  'Uninstall' {
    $task = Resolve-InstalledTask -Name $TaskName -PreferredPath $TaskPath
    if (-not $task) {
      Write-Host "Scheduled task not found: $(Get-TaskFullName -Name $TaskName -Path $TaskPath)"
      return
    }

    Unregister-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -Confirm:$false
    Write-Host "Removed scheduled task: $(Get-TaskFullName -Name $task.TaskName -Path $task.TaskPath)"
  }
}
