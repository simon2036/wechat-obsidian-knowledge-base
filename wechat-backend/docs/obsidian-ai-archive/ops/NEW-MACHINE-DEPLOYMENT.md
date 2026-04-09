# 新机器一键部署指南

Last updated: 2026-04-08

目标不是解释实现细节，而是让你在一台新的 Linux 或 Windows 机器上，把当前这套能力恢复出来：

- 微信公众号订阅
- 公众号文章刷新
- 全文归档到 Obsidian AI 主库
- Windows 本地镜像同步

## 总站目录标准

Windows 新机器统一采用这个目录结构：

```text
D:\opt\app\wechat-obsidian-knowledge-base\
  wechat-backend\
  obsidian-knowledge-base\
  backups\
    z001-source\
    z001-deploy\
```

其中：

- `wechat-backend` 是代码仓
- `obsidian-knowledge-base` 是独立 vault 仓
- `backups` 用于保留 `z001` 运行源码和部署配置备份

## 场景 A：新 Linux 生产机恢复

### 1. 准备条件

- Docker
- Docker Compose
- Git
- Node.js 20
- `pnpm` 8.6.1 以上
- 能访问 GitHub 和微信相关页面的网络

### 2. 拉取代码仓

```bash
git clone https://github.com/simon2036/wechat-obsidian-knowledge-base.git
cd wechat-obsidian-knowledge-base
```

### 3. 配环境变量

至少准备：

- `MYSQL_ROOT_PASSWORD`
- `AUTH_CODE`

如果直接用 `docker-compose.override.yml`，建议写入 `.env`：

```bash
cat > .env <<'EOF'
MYSQL_ROOT_PASSWORD=replace-with-your-password
AUTH_CODE=replace-with-your-auth-code
EOF
```

### 4. 启动基础服务

```bash
docker compose up -d db app web
```

如果需要完整链路：

```bash
docker compose up -d
```

### 5. 验证基础服务

```bash
docker compose ps
docker compose logs --tail 200 app
curl http://127.0.0.1:4000
```

验收标准：

- `app` 是 `healthy`
- Web 能打开
- `/feeds` 可访问

### 6. 登录 WeRead

通过 Web 管理界面扫码登录 WeRead。

注意：

- 不要勾选自动退出
- 至少准备一个可用账号

### 7. 添加公众号订阅

- 进入公众号源页面
- 粘贴公众号分享链接
- 完成订阅

可手动测试一次刷新：

```bash
curl "http://127.0.0.1:4000/feeds/MP_WXS_xxx.atom?update=true"
```

### 8. 启动全文归档链路

```bash
node ./scripts/obsidian-archive-worker.mjs --once
```

常驻运行：

```bash
node ./scripts/obsidian-archive-worker.mjs
```

验收标准：

- 远端 vault 内生成 `WeWe-RSS-AI/`
- 每篇文章有 `.md`
- 同目录下有 `_raw/*.json`

### 9. 建立远端 bare repo

按当前线上约定保留两个目录：

- worktree:
  - `/home/ifs1/app/wewe-rss-stack/data/obsidian/worktrees/folo-rss-vault`
- bare repo:
  - `/home/ifs1/app/wewe-rss-stack/data/obsidian/repos/folo-rss-vault.git`

### 10. 验证归档链路

```bash
node --test ./scripts/obsidian-archive.test.mjs
node ./scripts/obsidian-archive-worker.mjs --once --repair-feed-sourced
```

验收标准：

- `content_source = original_page` 可以正常出现
- 文章不是空壳
- 列表项不会出现悬空 `-`

## 场景 B：新 Windows 总站恢复

### 1. 准备条件

- Git
- PowerShell
- Obsidian
- Node.js 20
- 能通过 SSH / Tailscale / 局域网访问 `z001`

### 2. 创建总站目录

```powershell
New-Item -ItemType Directory -Force -Path D:\opt\app\wechat-obsidian-knowledge-base | Out-Null
```

### 3. 克隆代码仓到 `wechat-backend`

```powershell
git clone https://github.com/simon2036/wechat-obsidian-knowledge-base.git D:\opt\app\wechat-obsidian-knowledge-base\wechat-backend
cd D:\opt\app\wechat-obsidian-knowledge-base\wechat-backend
```

```powershell
pnpm wiki:setup:local
```

### 4. 同步 vault 镜像到 `obsidian-knowledge-base`

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sync-z001-obsidian-vault.ps1
```

首次大库建议：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sync-z001-obsidian-vault.ps1 -Shallow
```

### 5. 配自动同步

优先用计划任务：

```powershell
pnpm archive:obsidian:mirror:install
pnpm archive:obsidian:mirror:status
```

没有管理员权限时：

```powershell
pnpm archive:obsidian:mirror:startup:install
pnpm archive:obsidian:mirror:startup:status
```

### 6. 打开 AI 主库

Obsidian / Codex 统一使用：

- `D:\opt\app\wechat-obsidian-knowledge-base\obsidian-knowledge-base\WeWe-RSS-AI`

不要再把 `Feeds\` 当正文主库。

## 恢复顺序建议

1. 恢复 `wechat-backend`
2. 恢复 `obsidian-knowledge-base`
3. 恢复或拷回 `backups`
4. 校验 `z001` 服务
5. 跑一次手动归档
6. 校验 Windows 镜像

## 最小验收清单

- Web 管理界面能打开
- WeRead 账号可登录
- 公众号订阅可添加
- feed 能刷新
- `WeWe-RSS-AI/` 有 Markdown 输出
- `_raw/*.json` 同步生成
- Windows 能拉到本地镜像
- Obsidian / Codex 能直接读正文

## 常见问题

### 1. GitHub 推送过慢或超时

优先推当前快照，不要把无关历史一起推。

### 2. feed 有输出，但正文还是空

先看：

- `content_source`
- `content_fetch_status`
- `content_quality_reason`

必要时执行：

```bash
node ./scripts/obsidian-archive-worker.mjs --once --repair-all
```

### 3. Windows 能看到仓库，但看不到全文

通常是你还在看 `Feeds\`，而不是：

- `WeWe-RSS-AI`

### 4. WeRead 账号经常失效

先确认：

- 没勾选自动退出
- 账号状态不是“失效，需要重登”
- 不是请求过频导致临时冷却

## 结论

恢复的不是单个 `wewe-rss` 服务，而是整条链路：

- 订阅链路
- 全文回抓链路
- Obsidian AI 主库
- Windows 本地镜像
