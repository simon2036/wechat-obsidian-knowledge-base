param(
  [switch]$ForceInstall
)

$ErrorActionPreference = 'Stop'

function Ensure-Tls12 {
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  } catch {
    # Ignore if the runtime does not expose the flag.
  }
}

function Test-ModuleAvailable {
  param([string]$Name)

  return [bool](Get-Module -ListAvailable -Name $Name)
}

if (-not $ForceInstall -and (Test-ModuleAvailable -Name 'ps2exe')) {
  return [pscustomobject]@{
    module = 'ps2exe'
    installed = $true
    source = 'existing'
  }
}

Ensure-Tls12

try {
  Set-PSRepository -Name 'PSGallery' -InstallationPolicy Trusted -ErrorAction SilentlyContinue
} catch {
  # Ignore if the repository is unavailable or already configured.
}

Install-Module -Name 'ps2exe' -Scope CurrentUser -Force -AllowClobber -ErrorAction Stop

return [pscustomobject]@{
  module = 'ps2exe'
  installed = $true
  source = 'install'
}
