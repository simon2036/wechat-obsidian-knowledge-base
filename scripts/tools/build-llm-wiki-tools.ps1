[CmdletBinding()]
param(
  [string]$OutputPath = '',
  [switch]$Force,
  [switch]$SkipModuleInstall
)

$ErrorActionPreference = 'Stop'

$stationRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$scriptPath = Join-Path $stationRoot 'scripts\gui\llm-wiki-tools.ps1'

if (-not (Test-Path -LiteralPath $scriptPath)) {
  throw "Missing GUI script: $scriptPath"
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $stationRoot 'llm-wiki-tools.exe'
}

$moduleName = 'ps2exe'
$module = Get-Module -ListAvailable -Name $moduleName | Select-Object -First 1
if (-not $module) {
  if ($SkipModuleInstall) {
    throw "PowerShell module '$moduleName' is not installed."
  }

  Install-PackageProvider -Name NuGet -Force -Scope CurrentUser | Out-Null
  Install-Module -Name $moduleName -Scope CurrentUser -Force -AllowClobber
  $module = Get-Module -ListAvailable -Name $moduleName | Select-Object -First 1
}

Import-Module $moduleName -Force

if ((Test-Path -LiteralPath $OutputPath) -and -not $Force) {
  throw "Output file already exists: $OutputPath. Use -Force to overwrite."
}

$iconPath = $null
$compileArgs = @{
  inputFile = $scriptPath
  outputFile = $OutputPath
  noConsole = $true
  sta = $true
  x64 = $true
  title = 'LLM-Wiki Tools'
  description = 'GUI launcher for LLM-Wiki and PDF automation'
}

if ($iconPath -and (Test-Path -LiteralPath $iconPath)) {
  $compileArgs.iconFile = $iconPath
}

Invoke-ps2exe @compileArgs

Write-Host "Built: $OutputPath"
