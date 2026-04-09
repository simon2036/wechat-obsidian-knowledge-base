param(
  [switch]$TestMode
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Resolve-StationRoot {
  $candidates = New-Object System.Collections.Generic.List[string]

  foreach ($value in @(
      $PSScriptRoot,
      $(if ($PSCommandPath) { Split-Path -Parent $PSCommandPath }),
      $(if ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path }),
      $(try { if ([System.Windows.Forms.Application]::ExecutablePath) { Split-Path -Parent ([System.Windows.Forms.Application]::ExecutablePath) } } catch { $null }),
      $(try { [System.AppDomain]::CurrentDomain.BaseDirectory } catch { $null }),
      (Get-Location).Path
    )) {
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      $candidates.Add($value)
    }
  }

  foreach ($candidate in $candidates) {
    foreach ($root in @(
        $candidate,
        (Join-Path $candidate '..'),
        (Join-Path $candidate '..\..')
      )) {
      try {
        $resolved = [System.IO.Path]::GetFullPath($root)
      } catch {
        continue
      }

      if (Test-Path -LiteralPath (Join-Path $resolved 'wechat-backend')) {
        return $resolved
      }
    }
  }

  throw 'Unable to resolve station root. Expected a directory containing "wechat-backend".'
}

$repoRoot = Resolve-StationRoot
$script:AppStatePath = Join-Path $repoRoot '.llm-wiki-tools-state.json'

function Quote-PowerShellLiteral {
  param([string]$Value)

  $text = if ($null -eq $Value) { '' } else { [string]$Value }
  return "'" + ($text -replace "'", "''") + "'"
}

function Quote-PreviewArgument {
  param([string]$Value)

  if ($null -eq $Value) {
    return "''"
  }

  if ($Value -match '^[A-Za-z0-9_./:\\-]+$') {
    return $Value
  }

  return '"' + ($Value -replace '"', '\"') + '"'
}

function Get-ToolCommands {
  return @(
    @{
      Id = 'wiki:run'
      Label = 'Wiki Run'
      Script = 'scripts/llm-wiki-run.mjs'
      NeedsFeed = $true
      SupportsMonth = $true
      SupportsDryRun = $true
      SupportsForcePdf = $true
      Description = 'Incremental wiki generation'
    },
    @{
      Id = 'wiki:backfill'
      Label = 'Wiki Backfill'
      Script = 'scripts/llm-wiki-backfill.mjs'
      NeedsFeed = $true
      SupportsFromTo = $true
      SupportsDryRun = $true
      SupportsForcePdf = $true
      Description = 'Backfill wiki by month range'
    },
    @{
      Id = 'wiki:lint'
      Label = 'Wiki Lint'
      Script = 'scripts/llm-wiki-lint.mjs'
      NeedsFeed = $true
      SupportsAllFeeds = $true
      SupportsDryRun = $true
      Description = 'Check missing pages, orphan pages, and PDF issues'
    },
    @{
      Id = 'wiki:render:month'
      Label = 'Render Month'
      Script = 'scripts/llm-wiki-render-month.mjs'
      NeedsFeed = $true
      SupportsMonth = $true
      SupportsDryRun = $true
      Description = 'Rebuild one month of aggregate pages'
    },
    @{
      Id = 'wiki:pdf:sync'
      Label = 'PDF Sync'
      Script = 'scripts/llm-wiki-pdf-sync.mjs'
      NeedsFeed = $true
      SupportsAllFeeds = $true
      SupportsMonth = $true
      SupportsDryRun = $true
      SupportsNewOnly = $true
      Description = 'Sync pending PDF work'
    },
    @{
      Id = 'wiki:pdf:login'
      Label = 'PDF Login'
      Script = 'scripts/llm-wiki-pdf-login.mjs'
      NeedsFeed = $true
      SupportsUrl = $true
      SupportsChannel = $true
      SupportsProfile = $true
      SupportsUserDataDir = $true
      SupportsProfileDirectory = $true
      Description = 'Open browser and save a login session'
    },
    @{
      Id = 'wiki:pdf:attach'
      Label = 'PDF Attach'
      Script = 'scripts/llm-wiki-pdf-attach.mjs'
      NeedsFeed = $true
      SupportsMonth = $true
      SupportsArticle = $true
      SupportsFile = $true
      SupportsUrl = $true
      Description = 'Attach a manually downloaded PDF'
    },
    @{
      Id = 'wiki:glm:probe'
      Label = 'GLM Probe'
      Script = 'scripts/llm-wiki-glm-probe.mjs'
      NeedsFeed = $true
      ManualOnly = $true
      Description = 'Probe GLM Coding Plan endpoint and models'
    },
    @{
      Id = 'wiki:glm:estimate'
      Label = 'GLM Estimate'
      Script = 'scripts/llm-wiki-glm-estimate.mjs'
      NeedsFeed = $true
      SupportsMonth = $true
      SupportsAssumePeak = $true
      ManualOnly = $true
      Description = 'Estimate GLM quota usage'
    },
    @{
      Id = 'wiki:glm:run'
      Label = 'GLM Run'
      Script = 'scripts/llm-wiki-glm-run.mjs'
      NeedsFeed = $true
      SupportsMonth = $true
      SupportsNewOnly = $true
      SupportsAllowLargeBatch = $true
      ManualOnly = $true
      Description = 'Run the manual GLM summarization flow'
    }
  )
}

function Load-FeedSlugs {
  param([string]$ConfigPath)

  if (-not (Test-Path -LiteralPath $ConfigPath)) {
    return @()
  }

  $config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  return @($config.feeds.PSObject.Properties.Name | Sort-Object)
}

function Get-UiSettingsPath {
  param([string]$StationRoot)

  return Join-Path $StationRoot '.llm-wiki-tools.settings.json'
}

function Load-UiSettings {
  param([string]$StationRoot)

  $settingsPath = Get-UiSettingsPath -StationRoot $StationRoot
  if (-not (Test-Path -LiteralPath $settingsPath)) {
    return @{}
  }

  try {
    return Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return @{}
  }
}

function Save-UiSettings {
  param(
    [string]$StationRoot,
    [hashtable]$Values
  )

  $settingsPath = Get-UiSettingsPath -StationRoot $StationRoot
  $payload = [ordered]@{}
  foreach ($key in $Values.Keys) {
    $payload[$key] = $Values[$key]
  }

  $json = $payload | ConvertTo-Json -Depth 8
  Set-Content -LiteralPath $settingsPath -Value $json -Encoding UTF8
}

function Get-CommandHelpText {
  param($Command)

  $lines = New-Object System.Collections.Generic.List[string]
  switch ($Command.Id) {
    'wiki:run' {
      $lines.Add('Incremental generation for a single feed.')
      $lines.Add('Use when new articles have arrived and you want the article page, project page, month page, and quarter page updated.')
      $lines.Add('Fields: Feed, Month, Dry Run, Force PDF.')
    }
    'wiki:backfill' {
      $lines.Add('Backfill a date range by month.')
      $lines.Add('Use when you need to rebuild older content in a bounded range.')
      $lines.Add('Fields: Feed, From, To, Dry Run, Force PDF.')
    }
    'wiki:lint' {
      $lines.Add('Inspect feeds for missing pages, orphaned files, and PDF issues.')
      $lines.Add('Use All Feeds to scan every enabled feed.')
      $lines.Add('Fields: Feed, All Feeds, Dry Run.')
    }
    'wiki:render:month' {
      $lines.Add('Rebuild the derived pages for one month only.')
      $lines.Add('Use after fixing source articles or derived JSON for that month.')
      $lines.Add('Fields: Feed, Month, Dry Run.')
    }
    'wiki:pdf:sync' {
      $lines.Add('Sync pending PDF work for one feed or all feeds.')
      $lines.Add('New Only skips retry candidates and only touches recent additions.')
      $lines.Add('Fields: Feed, All Feeds, Month, Dry Run, New Only.')
    }
    'wiki:pdf:login' {
      $lines.Add('Open a browser and save the authenticated session for PDF downloads.')
      $lines.Add('Use Channel, Profile, User Data Dir, and Profile Dir to reuse your browser profile.')
      $lines.Add('Fields: Feed, URL, Channel, Profile, User Data Dir, Profile Dir.')
    }
    'wiki:pdf:attach' {
      $lines.Add('Attach a manually downloaded PDF to an article output.')
      $lines.Add('Use when a site blocks automation or requires manual login.')
      $lines.Add('Fields: Feed, Article, File, Month, URL.')
    }
    'wiki:glm:probe' {
      $lines.Add('Probe the GLM Coding Plan endpoint and record which models are usable.')
      $lines.Add('This is manual mode only.')
      $lines.Add('Fields: Feed.')
    }
    'wiki:glm:estimate' {
      $lines.Add('Estimate GLM quota usage for a feed or month.')
      $lines.Add('Assume Peak gives the conservative estimate for peak-time usage.')
      $lines.Add('Fields: Feed, Month, Assume Peak.')
    }
    'wiki:glm:run' {
      $lines.Add('Run the manual GLM summarization flow.')
      $lines.Add('This requires an interactive terminal and is not meant for scheduled tasks.')
      $lines.Add('Fields: Feed, Month, New Only, Allow Large Batch.')
    }
  }

  return ($lines -join [Environment]::NewLine)
}

function Load-AppState {
  if (-not (Test-Path -LiteralPath $script:AppStatePath)) {
    return [pscustomobject]@{
      lastCommand = 'wiki:run'
      commands = @{}
    }
  }

  try {
    return Get-Content -LiteralPath $script:AppStatePath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return [pscustomobject]@{
      lastCommand = 'wiki:run'
      commands = @{}
    }
  }
}

function Save-AppState {
  param([pscustomobject]$State)

  $directory = Split-Path -Parent $script:AppStatePath
  if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }

  $State | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $script:AppStatePath -Encoding UTF8
}

function Get-CommandMeta {
  param($Command)

  $required = @()
  if ($Command.NeedsFeed) { $required += 'Feed' }
  if ($Command.SupportsMonth) { $required += 'Month' }
  if ($Command.SupportsFromTo) { $required += 'From/To' }
  if ($Command.SupportsArticle) { $required += 'Article' }
  if ($Command.SupportsFile) { $required += 'PDF file' }
  if ($Command.ManualOnly) { $required += 'Interactive terminal' }

  $optional = @()
  if ($Command.SupportsAllFeeds) { $optional += 'All Feeds' }
  if ($Command.SupportsUrl) { $optional += 'URL' }
  if ($Command.SupportsChannel) { $optional += 'Channel' }
  if ($Command.SupportsProfile) { $optional += 'Profile' }
  if ($Command.SupportsUserDataDir) { $optional += 'User Data Dir' }
  if ($Command.SupportsProfileDirectory) { $optional += 'Profile Dir' }
  if ($Command.SupportsDryRun) { $optional += 'Dry Run' }
  if ($Command.SupportsForcePdf) { $optional += 'Force PDF' }
  if ($Command.SupportsNewOnly) { $optional += 'New Only' }
  if ($Command.SupportsAssumePeak) { $optional += 'Assume Peak' }
  if ($Command.SupportsAllowLargeBatch) { $optional += 'Allow Large Batch' }

  return [pscustomobject]@{
    required = $required
    optional = $optional
  }
}

function Format-CommandHelp {
  param(
    $Command,
    $Meta
  )

  $lines = @(
    "Command / 命令: $($Command.Label) ($($Command.Id))",
    "Description / 说明: $($Command.Description)",
    '',
    'Required / 必填:'
  )

  if ($Meta.required.Count -gt 0) {
    $lines += ($Meta.required | ForEach-Object { "  - $_" })
  } else {
    $lines += '  - None'
  }

  $lines += ''
  $lines += 'Optional / 选填:'
  if ($Meta.optional.Count -gt 0) {
    $lines += ($Meta.optional | ForEach-Object { "  - $_" })
  } else {
    $lines += '  - None'
  }

  $lines += ''
  $lines += 'Tips / 提示:'
  $lines += '  - Manual GLM commands need an interactive terminal.'
  $lines += '  - Use the preview box before running.'
  return $lines -join [Environment]::NewLine
}

function Ensure-AppStateShape {
  param($State)

  if (-not $State) {
    $State = [pscustomobject]@{}
  }

  if (-not $State.PSObject.Properties['lastCommand']) {
    $State | Add-Member -NotePropertyName lastCommand -NotePropertyValue 'wiki:run'
  }

  if (-not $State.PSObject.Properties['commands']) {
    $State | Add-Member -NotePropertyName commands -NotePropertyValue ([pscustomobject]@{})
  }

  return $State
}

function Get-CommandState {
  param(
    $State,
    [string]$CommandId
  )

  $State = Ensure-AppStateShape $State
  $existing = $State.commands.PSObject.Properties[$CommandId]
  if ($existing) {
    return $existing.Value
  }

  $created = [pscustomobject]@{
    feed = ''
    allFeeds = $false
    month = ''
    from = ''
    to = ''
    article = ''
    file = ''
    url = ''
    channel = 'msedge'
    profile = ''
    userDataDir = ''
    profileDirectory = ''
    dryRun = $false
    forcePdf = $false
    newOnly = $false
    assumePeak = $false
    allowLargeBatch = $false
  }
  $State.commands | Add-Member -NotePropertyName $CommandId -NotePropertyValue $created
  return $created
}

function Set-CommandState {
  param(
    $State,
    [string]$CommandId,
    $Values
  )

  $State = Ensure-AppStateShape $State
  $payload = [pscustomobject]@{
    feed = [string]$Values.Feed
    allFeeds = [bool]$Values.AllFeeds
    month = [string]$Values.Month
    from = [string]$Values.From
    to = [string]$Values.To
    article = [string]$Values.Article
    file = [string]$Values.File
    url = [string]$Values.Url
    channel = [string]$Values.Channel
    profile = [string]$Values.Profile
    userDataDir = [string]$Values.UserDataDir
    profileDirectory = [string]$Values.ProfileDirectory
    dryRun = [bool]$Values.DryRun
    forcePdf = [bool]$Values.ForcePdf
    newOnly = [bool]$Values.NewOnly
    assumePeak = [bool]$Values.AssumePeak
    allowLargeBatch = [bool]$Values.AllowLargeBatch
  }

  if ($State.commands.PSObject.Properties[$CommandId]) {
    $State.commands.PSObject.Properties.Remove($CommandId)
  }
  $State.commands | Add-Member -NotePropertyName $CommandId -NotePropertyValue $payload
  $State.lastCommand = $CommandId
  return $State
}

function Build-NodeArguments {
  param(
    $Command,
    $Values
  )

  $nodeArgs = New-Object System.Collections.Generic.List[string]

  if ($Command.NeedsFeed -and -not $Values.AllFeeds) {
    if ([string]::IsNullOrWhiteSpace($Values.Feed)) {
      throw 'This command requires a feed.'
    }
    $nodeArgs.Add('--feed')
    $nodeArgs.Add($Values.Feed)
  }

  if ($Values.AllFeeds) {
    $nodeArgs.Add('--all')
  }

  if ($Command.SupportsMonth -and -not [string]::IsNullOrWhiteSpace($Values.Month)) {
    $nodeArgs.Add('--month')
    $nodeArgs.Add($Values.Month)
  }

  if ($Command.SupportsFromTo) {
    if (-not [string]::IsNullOrWhiteSpace($Values.From)) {
      $nodeArgs.Add('--from')
      $nodeArgs.Add($Values.From)
    }
    if (-not [string]::IsNullOrWhiteSpace($Values.To)) {
      $nodeArgs.Add('--to')
      $nodeArgs.Add($Values.To)
    }
  }

  if ($Command.SupportsArticle) {
    if ([string]::IsNullOrWhiteSpace($Values.Article)) {
      throw 'This command requires Article.'
    }
    $nodeArgs.Add('--article')
    $nodeArgs.Add($Values.Article)
  }

  if ($Command.SupportsFile) {
    if ([string]::IsNullOrWhiteSpace($Values.File)) {
      throw 'This command requires a PDF file.'
    }
    $nodeArgs.Add('--file')
    $nodeArgs.Add($Values.File)
  }

  if ($Command.SupportsUrl -and -not [string]::IsNullOrWhiteSpace($Values.Url)) {
    $nodeArgs.Add('--url')
    $nodeArgs.Add($Values.Url)
  }

  if ($Command.SupportsChannel -and -not [string]::IsNullOrWhiteSpace($Values.Channel)) {
    $nodeArgs.Add('--channel')
    $nodeArgs.Add($Values.Channel)
  }

  if ($Command.SupportsProfile -and -not [string]::IsNullOrWhiteSpace($Values.Profile)) {
    $nodeArgs.Add('--profile')
    $nodeArgs.Add($Values.Profile)
  }

  if ($Command.SupportsUserDataDir -and -not [string]::IsNullOrWhiteSpace($Values.UserDataDir)) {
    $nodeArgs.Add('--user-data-dir')
    $nodeArgs.Add($Values.UserDataDir)
  }

  if ($Command.SupportsProfileDirectory -and -not [string]::IsNullOrWhiteSpace($Values.ProfileDirectory)) {
    $nodeArgs.Add('--profile-directory')
    $nodeArgs.Add($Values.ProfileDirectory)
  }

  if ($Command.SupportsDryRun -and $Values.DryRun) {
    $nodeArgs.Add('--dry-run')
  }

  if ($Command.SupportsForcePdf -and $Values.ForcePdf) {
    $nodeArgs.Add('--force-pdf')
  }

  if ($Command.SupportsNewOnly -and $Values.NewOnly) {
    $nodeArgs.Add('--new-only')
  }

  if ($Command.SupportsAssumePeak -and $Values.AssumePeak) {
    $nodeArgs.Add('--assume-peak')
  }

  if ($Command.SupportsAllowLargeBatch -and $Values.AllowLargeBatch) {
    $nodeArgs.Add('--allow-large-batch')
  }

  if ($Command.Id -eq 'wiki:backfill') {
    if ([string]::IsNullOrWhiteSpace($Values.From) -or [string]::IsNullOrWhiteSpace($Values.To)) {
      throw 'Backfill requires both From and To.'
    }
  }

  if ($Command.Id -eq 'wiki:render:month' -and [string]::IsNullOrWhiteSpace($Values.Month)) {
    throw 'Render Month requires Month.'
  }

  return ,$nodeArgs.ToArray()
}

function Build-PreviewText {
  param(
    [string]$BackendRoot,
    $Command,
    [string[]]$NodeArgs
  )

  $previewArgs = @($NodeArgs | ForEach-Object { Quote-PreviewArgument $_ })
  $nodeScript = Quote-PreviewArgument (".\" + $Command.Script.Replace('/', '\'))
  return @(
    "Working dir: $BackendRoot",
    "Command: node $nodeScript $($previewArgs -join ' ')",
    '',
    "Description: $($Command.Description)"
  ) -join [Environment]::NewLine
}

function Build-CommandSummary {
  param($Command, $Values)

  $parts = New-Object System.Collections.Generic.List[string]
  $parts.Add("Command: $($Command.Label) [$($Command.Id)]")
  if ($Command.NeedsFeed -and -not $Values.AllFeeds) {
    $parts.Add("Feed: $($Values.Feed)")
  } elseif ($Values.AllFeeds) {
    $parts.Add('Feed: all feeds')
  }
  if ($Values.Month) { $parts.Add("Month: $($Values.Month)") }
  if ($Values.From -or $Values.To) { $parts.Add("Range: $($Values.From) -> $($Values.To)") }
  if ($Values.Article) { $parts.Add("Article: $($Values.Article)") }
  if ($Values.File) { $parts.Add("File: $([System.IO.Path]::GetFileName($Values.File))") }
  if ($Values.Url) { $parts.Add("URL: $($Values.Url)") }
  if ($Values.Channel) { $parts.Add("Channel: $($Values.Channel)") }
  if ($Values.Profile) { $parts.Add("Profile: $($Values.Profile)") }
  if ($Values.UserDataDir) { $parts.Add("User Data Dir: $($Values.UserDataDir)") }
  if ($Values.ProfileDirectory) { $parts.Add("Profile Dir: $($Values.ProfileDirectory)") }

  $flags = New-Object System.Collections.Generic.List[string]
  if ($Values.DryRun) { $flags.Add('Dry Run') }
  if ($Values.ForcePdf) { $flags.Add('Force PDF') }
  if ($Values.NewOnly) { $flags.Add('New Only') }
  if ($Values.AssumePeak) { $flags.Add('Assume Peak') }
  if ($Values.AllowLargeBatch) { $flags.Add('Allow Large Batch') }
  if ($flags.Count -gt 0) {
    $parts.Add("Flags: $($flags -join ', ')")
  }

  return ($parts -join [Environment]::NewLine)
}

function Start-CommandWindow {
  param(
    [string]$BackendRoot,
    $Command,
    [string[]]$NodeArgs
  )

  $scriptPath = Join-Path $BackendRoot $Command.Script
  $argSegments = @($NodeArgs | ForEach-Object { Quote-PowerShellLiteral $_ })
  $nodeCall = "& node " + (Quote-PowerShellLiteral $scriptPath)
  if ($argSegments.Count -gt 0) {
    $nodeCall += ' ' + ($argSegments -join ' ')
  }

  $manualEnv = if ($Command.ManualOnly) { "`$env:LLM_WIKI_ALLOW_NON_INTERACTIVE='1'; " } else { '' }
  $commandBlock = "& { Set-Location -LiteralPath $(Quote-PowerShellLiteral $BackendRoot); ${manualEnv}${nodeCall} }"

  Start-Process -FilePath 'powershell.exe' -WorkingDirectory $BackendRoot -ArgumentList @(
    '-NoExit',
    '-ExecutionPolicy', 'Bypass',
    '-Command', $commandBlock
  ) | Out-Null
}

$stationRoot = $repoRoot
$backendRoot = Join-Path $stationRoot 'wechat-backend'
$vaultRoot = Join-Path $stationRoot 'obsidian-knowledge-base'
$configPath = Join-Path $backendRoot 'llm-wiki.config.json'
$commands = Get-ToolCommands
$feedSlugs = Load-FeedSlugs -ConfigPath $configPath
$script:AppState = Ensure-AppStateShape (Load-AppState)
$script:IsRestoringState = $false

if ($TestMode) {
  [pscustomobject]@{
    station_root = $stationRoot
    backend_root = $backendRoot
    config_path = $configPath
    feed_count = $feedSlugs.Count
    feeds = $feedSlugs
    commands = @($commands | ForEach-Object { $_.Id })
  } | ConvertTo-Json -Depth 10
  exit 0
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  [System.Windows.Forms.MessageBox]::Show('Node.js was not found. Install Node.js first.', 'LLM-Wiki Tools') | Out-Null
  exit 1
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'LLM-Wiki Tools'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(1180, 820)
$form.MinimumSize = New-Object System.Drawing.Size(1180, 820)

$font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
$form.Font = $font

function New-Label($text, $x, $y, $width = 100) {
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $text
  $label.Location = New-Object System.Drawing.Point($x, $y)
  $label.Size = New-Object System.Drawing.Size($width, 24)
  $form.Controls.Add($label)
  return $label
}

function New-TextBox($x, $y, $width = 240) {
  $textBox = New-Object System.Windows.Forms.TextBox
  $textBox.Location = New-Object System.Drawing.Point($x, $y)
  $textBox.Size = New-Object System.Drawing.Size($width, 24)
  $form.Controls.Add($textBox)
  return $textBox
}

function New-CheckBox($text, $x, $y, $width = 160) {
  $checkBox = New-Object System.Windows.Forms.CheckBox
  $checkBox.Text = $text
  $checkBox.Location = New-Object System.Drawing.Point($x, $y)
  $checkBox.Size = New-Object System.Drawing.Size($width, 24)
  $form.Controls.Add($checkBox)
  return $checkBox
}

New-Label 'Command / 命令' 20 20 110 | Out-Null
$commandCombo = New-Object System.Windows.Forms.ComboBox
$commandCombo.DropDownStyle = 'DropDownList'
$commandCombo.Location = New-Object System.Drawing.Point(140, 18)
$commandCombo.Size = New-Object System.Drawing.Size(300, 24)
$commandCombo.DisplayMember = 'Label'
$commandCombo.ValueMember = 'Id'
foreach ($command in $commands) {
  [void]$commandCombo.Items.Add([pscustomobject]$command)
}
$form.Controls.Add($commandCombo)

$runButton = New-Object System.Windows.Forms.Button
$runButton.Text = 'Run'
$runButton.Location = New-Object System.Drawing.Point(1040, 16)
$runButton.Size = New-Object System.Drawing.Size(120, 30)
$form.Controls.Add($runButton)

$copyButton = New-Object System.Windows.Forms.Button
$copyButton.Text = 'Copy Preview'
$copyButton.Location = New-Object System.Drawing.Point(900, 16)
$copyButton.Size = New-Object System.Drawing.Size(130, 30)
$form.Controls.Add($copyButton)

New-Label 'Feed / 公众号' 20 60 110 | Out-Null
$feedCombo = New-Object System.Windows.Forms.ComboBox
$feedCombo.DropDownStyle = 'DropDownList'
$feedCombo.Location = New-Object System.Drawing.Point(140, 58)
$feedCombo.Size = New-Object System.Drawing.Size(300, 24)
$feedCombo.Items.AddRange($feedSlugs)
if ($feedSlugs.Count -gt 0) {
  $feedCombo.SelectedIndex = 0
}
$form.Controls.Add($feedCombo)

$allFeedsCheck = New-CheckBox 'All Feeds / 全部' 460 58 140

New-Label 'Month / 月份' 20 100 110 | Out-Null
$monthBox = New-TextBox 140 98 120
New-Label 'From / 起始' 280 100 90 | Out-Null
$fromBox = New-TextBox 370 98 120
New-Label 'To / 结束' 510 100 80 | Out-Null
$toBox = New-TextBox 590 98 120

New-Label 'Article / 文章' 20 140 110 | Out-Null
$articleBox = New-TextBox 140 138 220
New-Label 'URL / 链接' 380 140 90 | Out-Null
$urlBox = New-TextBox 470 138 560

New-Label 'File / 文件' 20 180 110 | Out-Null
$fileBox = New-TextBox 140 178 760
$browseButton = New-Object System.Windows.Forms.Button
$browseButton.Text = 'Browse...'
$browseButton.Location = New-Object System.Drawing.Point(920, 176)
$browseButton.Size = New-Object System.Drawing.Size(110, 28)
$form.Controls.Add($browseButton)

New-Label 'Channel / 通道' 20 220 110 | Out-Null
$channelBox = New-TextBox 140 218 120
New-Label 'Profile / 配置' 280 220 100 | Out-Null
$profileBox = New-TextBox 380 218 120
New-Label 'Profile Dir / 目录' 520 220 120 | Out-Null
$profileDirBox = New-TextBox 640 218 200

New-Label 'User Data Dir / 数据目录' 20 260 150 | Out-Null
$userDataDirBox = New-TextBox 170 258 790

$dryRunCheck = New-CheckBox 'Dry Run / 预演' 20 300 120
$forcePdfCheck = New-CheckBox 'Force PDF / 强制 PDF' 150 300 150
$newOnlyCheck = New-CheckBox 'New Only / 仅新增' 310 300 140
$assumePeakCheck = New-CheckBox 'Assume Peak / 按高峰' 460 300 150
$allowLargeBatchCheck = New-CheckBox 'Allow Large Batch / 大批量' 620 300 180

$openBackendButton = New-Object System.Windows.Forms.Button
$openBackendButton.Text = 'Open backend'
$openBackendButton.Location = New-Object System.Drawing.Point(20, 340)
$openBackendButton.Size = New-Object System.Drawing.Size(120, 28)
$form.Controls.Add($openBackendButton)

$openVaultButton = New-Object System.Windows.Forms.Button
$openVaultButton.Text = 'Open vault'
$openVaultButton.Location = New-Object System.Drawing.Point(150, 340)
$openVaultButton.Size = New-Object System.Drawing.Size(120, 28)
$form.Controls.Add($openVaultButton)

New-Label 'Preview / 预览' 20 390 120 | Out-Null
$previewBox = New-Object System.Windows.Forms.TextBox
$previewBox.Location = New-Object System.Drawing.Point(20, 420)
$previewBox.Size = New-Object System.Drawing.Size(760, 320)
$previewBox.Multiline = $true
$previewBox.ReadOnly = $true
$previewBox.ScrollBars = 'Vertical'
$previewBox.Font = New-Object System.Drawing.Font('Consolas', 10)
$form.Controls.Add($previewBox)

New-Label 'Help / 参数说明' 800 60 160 | Out-Null
$helpBox = New-Object System.Windows.Forms.TextBox
$helpBox.Location = New-Object System.Drawing.Point(800, 90)
$helpBox.Size = New-Object System.Drawing.Size(340, 650)
$helpBox.Multiline = $true
$helpBox.ReadOnly = $true
$helpBox.ScrollBars = 'Vertical'
$helpBox.Font = New-Object System.Drawing.Font('Consolas', 10)
$helpBox.BackColor = [System.Drawing.SystemColors]::Window
$form.Controls.Add($helpBox)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Location = New-Object System.Drawing.Point(20, 750)
$statusLabel.Size = New-Object System.Drawing.Size(1120, 24)
$statusLabel.ForeColor = [System.Drawing.Color]::DimGray
$form.Controls.Add($statusLabel)

$fileDialog = New-Object System.Windows.Forms.OpenFileDialog
$fileDialog.Filter = 'PDF files (*.pdf)|*.pdf|All files (*.*)|*.*'

function Get-CurrentCommand {
  return $commandCombo.SelectedItem
}

function Get-CurrentValues {
  return @{
    Feed = [string]$feedCombo.SelectedItem
    AllFeeds = [bool]$allFeedsCheck.Checked
    Month = $monthBox.Text.Trim()
    From = $fromBox.Text.Trim()
    To = $toBox.Text.Trim()
    Article = $articleBox.Text.Trim()
    File = $fileBox.Text.Trim()
    Url = $urlBox.Text.Trim()
    Channel = $channelBox.Text.Trim()
    Profile = $profileBox.Text.Trim()
    UserDataDir = $userDataDirBox.Text.Trim()
    ProfileDirectory = $profileDirBox.Text.Trim()
    DryRun = [bool]$dryRunCheck.Checked
    ForcePdf = [bool]$forcePdfCheck.Checked
    NewOnly = [bool]$newOnlyCheck.Checked
    AssumePeak = [bool]$assumePeakCheck.Checked
    AllowLargeBatch = [bool]$allowLargeBatchCheck.Checked
  }
}

function Apply-CommandValues {
  param($CommandState)

  $script:IsRestoringState = $true
  try {
    if ($null -ne $CommandState.feed -and $feedSlugs -contains [string]$CommandState.feed) {
      $feedCombo.SelectedItem = [string]$CommandState.feed
    }
    $allFeedsCheck.Checked = [bool]$CommandState.allFeeds
    $monthBox.Text = [string]$CommandState.month
    $fromBox.Text = [string]$CommandState.from
    $toBox.Text = [string]$CommandState.to
    $articleBox.Text = [string]$CommandState.article
    $fileBox.Text = [string]$CommandState.file
    $urlBox.Text = [string]$CommandState.url
    $channelBox.Text = if ([string]::IsNullOrWhiteSpace([string]$CommandState.channel)) { 'msedge' } else { [string]$CommandState.channel }
    $profileBox.Text = [string]$CommandState.profile
    $userDataDirBox.Text = [string]$CommandState.userDataDir
    $profileDirBox.Text = [string]$CommandState.profileDirectory
    $dryRunCheck.Checked = [bool]$CommandState.dryRun
    $forcePdfCheck.Checked = [bool]$CommandState.forcePdf
    $newOnlyCheck.Checked = [bool]$CommandState.newOnly
    $assumePeakCheck.Checked = [bool]$CommandState.assumePeak
    $allowLargeBatchCheck.Checked = [bool]$CommandState.allowLargeBatch
  } finally {
    $script:IsRestoringState = $false
  }
}

function Select-CommandById {
  param([string]$CommandId)

  for ($index = 0; $index -lt $commandCombo.Items.Count; $index += 1) {
    $item = $commandCombo.Items[$index]
    if ($item.Id -eq $CommandId) {
      $commandCombo.SelectedIndex = $index
      return
    }
  }

  if ($commandCombo.Items.Count -gt 0) {
    $commandCombo.SelectedIndex = 0
  }
}

function Update-UiState {
  $command = Get-CurrentCommand
  if (-not $command) {
    return
  }

  $allFeedsCheck.Enabled = [bool]$command.SupportsAllFeeds
  if (-not $command.SupportsAllFeeds) {
    $allFeedsCheck.Checked = $false
  }

  $feedCombo.Enabled = -not $allFeedsCheck.Checked
  $monthBox.Enabled = [bool]$command.SupportsMonth
  $fromBox.Enabled = [bool]$command.SupportsFromTo
  $toBox.Enabled = [bool]$command.SupportsFromTo
  $articleBox.Enabled = [bool]$command.SupportsArticle
  $fileBox.Enabled = [bool]$command.SupportsFile
  $browseButton.Enabled = [bool]$command.SupportsFile
  $urlBox.Enabled = [bool]$command.SupportsUrl
  $channelBox.Enabled = [bool]$command.SupportsChannel
  $profileBox.Enabled = [bool]$command.SupportsProfile
  $userDataDirBox.Enabled = [bool]$command.SupportsUserDataDir
  $profileDirBox.Enabled = [bool]$command.SupportsProfileDirectory
  $dryRunCheck.Enabled = [bool]$command.SupportsDryRun
  $forcePdfCheck.Enabled = [bool]$command.SupportsForcePdf
  $newOnlyCheck.Enabled = [bool]$command.SupportsNewOnly
  $assumePeakCheck.Enabled = [bool]$command.SupportsAssumePeak
  $allowLargeBatchCheck.Enabled = [bool]$command.SupportsAllowLargeBatch

  if (-not $command.SupportsDryRun) { $dryRunCheck.Checked = $false }
  if (-not $command.SupportsForcePdf) { $forcePdfCheck.Checked = $false }
  if (-not $command.SupportsNewOnly) { $newOnlyCheck.Checked = $false }
  if (-not $command.SupportsAssumePeak) { $assumePeakCheck.Checked = $false }
  if (-not $command.SupportsAllowLargeBatch) { $allowLargeBatchCheck.Checked = $false }

  $meta = Get-CommandMeta $command
  $helpBox.Text = Format-CommandHelp -Command $command -Meta $meta
  $statusLabel.Text = if ($meta.required.Count -gt 0) {
    'Required fields: ' + ($meta.required -join ', ')
  } else {
    'Required fields: none'
  }

  try {
    $args = Build-NodeArguments -Command $command -Values (Get-CurrentValues)
    $previewBox.Text = Build-PreviewText -BackendRoot $backendRoot -Command $command -NodeArgs $args
  } catch {
    $previewBox.Text = @(
      "Working dir: $backendRoot",
      '',
      "Incomplete parameters: $($_.Exception.Message)",
      '',
      "Description: $($command.Description)"
    ) -join [Environment]::NewLine
  }

  if (-not $script:IsRestoringState) {
    $script:AppState = Set-CommandState -State $script:AppState -CommandId $command.Id -Values (Get-CurrentValues)
    Save-AppState -State $script:AppState
  }
}

$browseButton.Add_Click({
  if ($fileDialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    $fileBox.Text = $fileDialog.FileName
    Update-UiState
  }
})

$openBackendButton.Add_Click({ Start-Process explorer.exe $backendRoot | Out-Null })
$openVaultButton.Add_Click({ Start-Process explorer.exe $vaultRoot | Out-Null })

$copyButton.Add_Click({
  [System.Windows.Forms.Clipboard]::SetText($previewBox.Text)
  [System.Windows.Forms.MessageBox]::Show('Preview copied.', 'LLM-Wiki Tools') | Out-Null
})

$runButton.Add_Click({
  try {
    $command = Get-CurrentCommand
    $script:AppState = Set-CommandState -State $script:AppState -CommandId $command.Id -Values (Get-CurrentValues)
    Save-AppState -State $script:AppState
    $args = Build-NodeArguments -Command $command -Values (Get-CurrentValues)
    Start-CommandWindow -BackendRoot $backendRoot -Command $command -NodeArgs $args
  } catch {
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'LLM-Wiki Tools') | Out-Null
  }
})

$commandCombo.Add_SelectedIndexChanged({
  if (-not $script:IsRestoringState -and $commandCombo.SelectedItem) {
    $commandState = Get-CommandState -State $script:AppState -CommandId $commandCombo.SelectedItem.Id
    Apply-CommandValues -CommandState $commandState
    $script:AppState = Set-CommandState -State $script:AppState -CommandId $commandCombo.SelectedItem.Id -Values (Get-CurrentValues)
    Save-AppState -State $script:AppState
  }
})

$handlers = @($commandCombo, $feedCombo, $allFeedsCheck, $monthBox, $fromBox, $toBox, $articleBox, $fileBox, $urlBox, $channelBox, $profileBox, $userDataDirBox, $profileDirBox, $dryRunCheck, $forcePdfCheck, $newOnlyCheck, $assumePeakCheck, $allowLargeBatchCheck)
foreach ($control in $handlers) {
  if ($control -is [System.Windows.Forms.TextBox]) {
    $control.Add_TextChanged({ Update-UiState })
  } elseif ($control -is [System.Windows.Forms.ComboBox]) {
    $control.Add_SelectedIndexChanged({ Update-UiState })
  } elseif ($control -is [System.Windows.Forms.CheckBox]) {
    $control.Add_CheckedChanged({ Update-UiState })
  }
}

$initialCommandId = if ($script:AppState.lastCommand) { [string]$script:AppState.lastCommand } else { 'wiki:run' }
Select-CommandById -CommandId $initialCommandId
$channelBox.Text = 'msedge'
if (-not $commandCombo.SelectedItem) {
  $commandCombo.SelectedIndex = 0
}
if ($script:AppState.lastCommand) {
  $initialState = Get-CommandState -State $script:AppState -CommandId $commandCombo.SelectedItem.Id
  Apply-CommandValues -CommandState $initialState
}
Update-UiState

[void]$form.ShowDialog()
