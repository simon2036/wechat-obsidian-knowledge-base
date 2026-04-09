param(
  [string]$RemoteHost = 'biosphere@z001.tail904288.ts.net',
  [string]$RemoteSourceDir = '/home/ifs1/app/wewe-rss-src',
  [string]$RemoteDeployDir = '/home/ifs1/app/wewe-rss-stack/deploy/z001',
  [string]$SshKeyPath = '',
  [string]$SshKnownHostsPath = '',
  [switch]$SkipStart
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
  param(
    [string]$Action
  )

  if ($LASTEXITCODE -ne 0) {
    throw "$Action failed with exit code $LASTEXITCODE."
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

$sshArgs = @(
  '-i', $SshKeyPath,
  '-o', 'BatchMode=yes',
  '-o', 'IdentitiesOnly=yes',
  '-o', "UserKnownHostsFile=$SshKnownHostsPath",
  '-o', 'StrictHostKeyChecking=accept-new'
)

$scpArgs = @(
  '-i', $SshKeyPath,
  '-o', 'BatchMode=yes',
  '-o', 'IdentitiesOnly=yes',
  '-o', "UserKnownHostsFile=$SshKnownHostsPath",
  '-o', 'StrictHostKeyChecking=accept-new'
)

$repoRoot = Get-RepoRoot
$gitSha = (git -C $repoRoot rev-parse --short=12 HEAD).Trim()
Assert-LastExitCode 'Resolve git SHA'

if (-not $gitSha) {
  throw 'Unable to resolve git SHA for deployment.'
}

$imageTag = "z001-$gitSha"
$startFlag = if ($SkipStart) { '0' } else { '1' }
$archivePath = Join-Path $env:TEMP "wewe-rss-$imageTag.tar"
$remoteScriptPath = Join-Path $env:TEMP "wewe-rss-$imageTag.sh"

Write-Host "Deploying $imageTag from $repoRoot to $RemoteHost"

$remoteScript = @'
set -euo pipefail

remote_source_dir="$1"
remote_deploy_dir="$2"
image_tag="$3"
start_flag="$4"

compose_file="$remote_deploy_dir/docker-compose.yml"
env_file="$remote_deploy_dir/.env"
bridge_feeds_file="$remote_deploy_dir/../../data/folo-obsidian-bridge/config/feeds.json"
worktree_root="$remote_deploy_dir/../../data/obsidian/worktrees/folo-rss-vault"
host_uid="$(id -u biosphere 2>/dev/null || id -u)"
host_gid="$(id -g biosphere 2>/dev/null || id -g)"

upsert_env() {
  key="$1"
  value="$2"

  if grep -q "^${key}=" "$env_file"; then
    sed -i "s#^${key}=.*#${key}=${value}#" "$env_file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$env_file"
  fi
}

python3 - "$compose_file" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

image_line = "    image: wewe-rss:${WEWE_RSS_IMAGE_TAG}"
if image_line not in text:
    text = text.replace("    image: cooderl/wewe-rss:latest", image_line)

required = [
    "      CRON_EXPRESSION: ${CRON_EXPRESSION}",
    "      UPDATE_DELAY_TIME: ${UPDATE_DELAY_TIME}",
    "      MAX_REQUEST_PER_MINUTE: ${MAX_REQUEST_PER_MINUTE}",
]

anchor = "      SERVER_ORIGIN_URL: ${SERVER_ORIGIN_URL}"
if anchor not in text:
    raise SystemExit("Could not find app environment anchor in docker-compose.yml")

for line in required:
    if line not in text:
        text = text.replace(anchor, anchor + "\n" + line, 1)
        anchor = line

path.write_text(text)
PY

python3 - "$bridge_feeds_file" <<'PY'
from pathlib import Path
import json
import sys

path = Path(sys.argv[1])
feeds = json.loads(path.read_text())
changed = False

for item in feeds:
    if item.get("id") == "all":
        expected = "http://app:4000/feeds/all.atom?mode=fulltext"
        if item.get("fetch_url") != expected:
            item["fetch_url"] = expected
            changed = True

if changed:
    path.write_text(json.dumps(feeds, ensure_ascii=False, indent=2) + "\n")
PY

python3 - "$compose_file" "$remote_source_dir" <<'PY'
from pathlib import Path
import sys

compose_path = Path(sys.argv[1])
source_dir = sys.argv[2]
text = compose_path.read_text()

service_block = f"""
  obsidian-archive:
    image: wewe-rss-archive:${{WEWE_RSS_IMAGE_TAG}}
    restart: unless-stopped
    depends_on:
      app:
        condition: service_healthy
    user: "${{HOST_UID}}:${{HOST_GID}}"
    working_dir: /app
    command: ["node", "/app/scripts/obsidian-archive-worker.mjs"]
    environment:
      OBSIDIAN_BASE_URL: http://app:4000
      OBSIDIAN_VAULT_PATH: /vault/WeWe-RSS-AI
      OBSIDIAN_DISCOVER_FEEDS: "true"
      OBSIDIAN_INCLUDE_ALL_FEED: "false"
      OBSIDIAN_FEED_MODE: fulltext
      OBSIDIAN_FEED_LIMIT: "10"
      OBSIDIAN_TIMEOUT_MS: "120000"
      OBSIDIAN_ARCHIVE_INTERVAL_MINUTES: "1440"
      OBSIDIAN_REPAIR_FEED_SOURCED: "true"
      OBSIDIAN_GIT_SYNC: "true"
      OBSIDIAN_GIT_REMOTE: origin
      OBSIDIAN_GIT_BRANCH: main
      OBSIDIAN_GIT_REMOTE_PATH: /repos/folo-rss-vault.git
      GIT_AUTHOR_NAME: WeWe RSS Archive Bot
      GIT_AUTHOR_EMAIL: archive-bot@z001.local
    volumes:
      - {source_dir}:/app:ro
      - ${{STACK_ROOT}}/data/obsidian/worktrees/folo-rss-vault:/vault
      - ${{STACK_ROOT}}/data/obsidian/repos:/repos
"""

anchor = "\n  caddy:"
if anchor not in text:
    raise SystemExit("Could not find caddy anchor in docker-compose.yml")

obsidian_anchor = "\n  obsidian-archive:"
if obsidian_anchor in text:
    start = text.index(obsidian_anchor)
    end = text.index(anchor, start)
    text = text[:start] + "\n" + service_block.rstrip() + text[end:]
else:
    text = text.replace(anchor, "\n" + service_block.rstrip() + anchor, 1)

compose_path.write_text(text)
PY

upsert_env "WEWE_RSS_IMAGE_TAG" "$image_tag"
upsert_env "CRON_EXPRESSION" "35 5,17 * * *"
upsert_env "UPDATE_DELAY_TIME" "120"
upsert_env "MAX_REQUEST_PER_MINUTE" "60"
upsert_env "HOST_UID" "$host_uid"
upsert_env "HOST_GID" "$host_gid"

docker build --target app -t "wewe-rss:${image_tag}" "$remote_source_dir"
docker build --target archive -t "wewe-rss-archive:${image_tag}" "$remote_source_dir"

if [ "$start_flag" = "1" ]; then
  mkdir -p "$worktree_root/WeWe-RSS-AI"
  docker run --rm -v "$worktree_root:/vault" alpine sh -lc "mkdir -p /vault/WeWe-RSS-AI && chown -R $host_uid:$host_gid /vault/WeWe-RSS-AI"
  cd "$remote_deploy_dir"
  docker compose up -d app bridge obsidian-archive
fi
'@

try {
  if (Test-Path $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
  }

  & tar.exe `
    --exclude=.git `
    --exclude=node_modules `
    --exclude=coverage `
    --exclude=dist `
    --exclude=.turbo `
    -cf $archivePath `
    -C $repoRoot `
    .
  Assert-LastExitCode 'Create source archive'

  & ssh @sshArgs $RemoteHost "rm -rf $RemoteSourceDir && mkdir -p $RemoteSourceDir /tmp/wewe-rss-deploy"
  Assert-LastExitCode 'Prepare remote directories'

  & scp @scpArgs $archivePath "${RemoteHost}:/tmp/wewe-rss-deploy/source.tar"
  Assert-LastExitCode 'Upload source archive'

  & ssh @sshArgs $RemoteHost "tar -xf /tmp/wewe-rss-deploy/source.tar -C $RemoteSourceDir && rm -f /tmp/wewe-rss-deploy/source.tar"
  Assert-LastExitCode 'Extract source archive'

  $remoteScriptLf = $remoteScript -replace "`r`n", "`n"
  [System.IO.File]::WriteAllText(
    $remoteScriptPath,
    $remoteScriptLf,
    [System.Text.UTF8Encoding]::new($false)
  )

  & scp @scpArgs $remoteScriptPath "${RemoteHost}:/tmp/wewe-rss-deploy/run.sh"
  Assert-LastExitCode 'Upload remote deploy script'

  & ssh @sshArgs $RemoteHost "chmod +x /tmp/wewe-rss-deploy/run.sh && bash /tmp/wewe-rss-deploy/run.sh $RemoteSourceDir $RemoteDeployDir $imageTag $startFlag && rm -f /tmp/wewe-rss-deploy/run.sh"
  Assert-LastExitCode 'Build and restart remote app'

  Write-Host "Deploy finished with image tag $imageTag"
} finally {
  if (Test-Path $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
  }
  if (Test-Path $remoteScriptPath) {
    Remove-Item -LiteralPath $remoteScriptPath -Force
  }
}
