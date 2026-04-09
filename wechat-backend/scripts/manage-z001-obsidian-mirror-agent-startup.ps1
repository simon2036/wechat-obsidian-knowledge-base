param(
  [ValidateSet('Install', 'Status', 'RunNow', 'Uninstall')]
  [string]$Action = 'Install',

  [string]$AgentScriptPath = '',

  [string]$StartupFolder = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup",

  [string]$ShortcutName = 'WeWe RSS Obsidian Mirror Agent.cmd'
)

$ErrorActionPreference = 'Stop'

function Assert-LastExitCode {
  param([string]$ActionName)
  if ($LASTEXITCODE -ne 0) {
    throw "$ActionName failed with exit code $LASTEXITCODE."
  }
}

function Get-DefaultAgentScriptPath {
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  return Join-Path $repoRoot 'scripts\z001-obsidian-mirror-agent.ps1'
}

function Get-ShortcutPath {
  return Join-Path $StartupFolder $ShortcutName
}

function Get-AgentCommand {
  $powershellExe = Join-Path $PSHOME 'powershell.exe'
  return @(
    '@echo off'
    'start "" /min ' + '"' + $powershellExe + '" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $AgentScriptPath + '"'
  ) -join [Environment]::NewLine
}

if (-not $PSBoundParameters.ContainsKey('AgentScriptPath') -or [string]::IsNullOrWhiteSpace($AgentScriptPath)) {
  $AgentScriptPath = Get-DefaultAgentScriptPath
}

if (-not (Test-Path -LiteralPath $AgentScriptPath)) {
  throw "Agent script not found: $AgentScriptPath"
}

$shortcutPath = Get-ShortcutPath

switch ($Action) {
  'Install' {
    if (-not (Test-Path -LiteralPath $StartupFolder)) {
      New-Item -ItemType Directory -Path $StartupFolder -Force | Out-Null
    }

    Set-Content -LiteralPath $shortcutPath -Value (Get-AgentCommand) -Encoding ASCII
    Write-Host "Installed startup agent: $shortcutPath"
  }

  'Status' {
    if (Test-Path -LiteralPath $shortcutPath) {
      Write-Host "Installed startup agent: $shortcutPath"
      Get-Content -LiteralPath $shortcutPath
    } else {
      Write-Host "Startup agent not installed."
    }
  }

  'RunNow' {
    Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') `
      -ArgumentList @(
        '-NoProfile',
        '-WindowStyle', 'Hidden',
        '-ExecutionPolicy', 'Bypass',
        '-File', $AgentScriptPath
      )
    Write-Host "Started startup agent."
  }

  'Uninstall' {
    if (Test-Path -LiteralPath $shortcutPath) {
      Remove-Item -LiteralPath $shortcutPath -Force
    }
    Write-Host "Removed startup agent: $shortcutPath"
  }
}
