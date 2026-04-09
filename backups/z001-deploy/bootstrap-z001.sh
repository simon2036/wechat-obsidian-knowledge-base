#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$SCRIPT_DIR"
STACK_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BRIDGE_CONFIG_DIR="$STACK_ROOT/data/folo-obsidian-bridge/config"
BRIDGE_STATE_DIR="$STACK_ROOT/data/folo-obsidian-bridge/state"
OBSIDIAN_REPOS_DIR="$STACK_ROOT/data/obsidian/repos"
OBSIDIAN_WORKTREES_DIR="$STACK_ROOT/data/obsidian/worktrees"
WEWE_RSS_MYSQL_DIR="$STACK_ROOT/data/wewe-rss/mysql"
USER_SYSTEMD_DIR="$HOME/.config/systemd/user"

mkdir -p "$STACK_ROOT" "$BRIDGE_CONFIG_DIR" "$BRIDGE_STATE_DIR" "$OBSIDIAN_REPOS_DIR" "$OBSIDIAN_WORKTREES_DIR" "$WEWE_RSS_MYSQL_DIR" "$USER_SYSTEMD_DIR"

if [[ ! -f "$DEPLOY_DIR/.env" ]]; then
  cp "$DEPLOY_DIR/.env.example" "$DEPLOY_DIR/.env"
fi

if [[ ! -f "$BRIDGE_CONFIG_DIR/feeds.json" ]]; then
  cp "$DEPLOY_DIR/feeds.example.json" "$BRIDGE_CONFIG_DIR/feeds.json"
fi

sed "s#__STACK_ROOT__#$STACK_ROOT#g" "$DEPLOY_DIR/systemd-user/wewe-rss-compose.service" > "$USER_SYSTEMD_DIR/wewe-rss-compose.service"
sed "s#__STACK_ROOT__#$STACK_ROOT#g" "$DEPLOY_DIR/systemd-user/folo-obsidian-bridge.service" > "$USER_SYSTEMD_DIR/folo-obsidian-bridge.service"
sed "s#__STACK_ROOT__#$STACK_ROOT#g" "$DEPLOY_DIR/systemd-user/wewe-rss-funnel.service" > "$USER_SYSTEMD_DIR/wewe-rss-funnel.service"
cp "$DEPLOY_DIR/systemd-user/wewe-rss-funnel.timer" "$USER_SYSTEMD_DIR/wewe-rss-funnel.timer"

systemctl --user daemon-reload

docker compose -f "$DEPLOY_DIR/docker-compose.yml" --env-file "$DEPLOY_DIR/.env" build bridge
systemctl --user enable --now wewe-rss-compose.service
systemctl --user enable --now folo-obsidian-bridge.service
systemctl --user enable --now wewe-rss-funnel.service
systemctl --user enable --now wewe-rss-funnel.timer

echo "Bootstrap completed."
