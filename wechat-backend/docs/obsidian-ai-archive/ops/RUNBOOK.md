# 运维 Runbook

## 日常巡检

先看 `z001`：

```bash
cd /home/ifs1/app/wewe-rss-stack/deploy/z001
docker compose ps
docker compose logs --tail 200 app
docker compose logs --tail 200 bridge
docker compose logs --tail 200 obsidian-archive
```

再看 Windows 总站本地镜像：

```powershell
git -C D:\opt\app\wechat-obsidian-knowledge-base\obsidian-knowledge-base status
pnpm archive:obsidian:status
```

## 健康状态

- `app` 是 `healthy`
- `bridge` 能持续更新 feed
- `obsidian-archive` 能写入 `WeWe-RSS-AI/`
- 日志里能看到 `archive-sync-complete`
- Windows 本地镜像可以正常 `pull`

## 输出停止更新时先查什么

1. 查 `app`
   - WeRead 登录是否失效
   - 是否被限流
   - 是否连文章列表都拿不到
2. 查 `obsidian-archive`
   - 原文页回抓是否超时
   - 文件写入是否失败
   - Git push 是否失败
3. 查权限
   - 是否存在旧的 `root:root` 文件阻碍更新
4. 查 Windows 镜像
   - 是本地 `pull` 失败，还是远端根本没写入

## 正文突然变短时先查什么

1. 看 `_raw/*.json`
   - `content_source`
   - `content_fetch_status`
   - `content_quality_reason`
2. 看远端日志
   - 是否成功回抓 `original_page`
   - 是否命中短正文或壳内容判定
3. 必要时跑一次后台 `repair-all`

## Windows 看不到新文章时先查什么

1. 远端 worktree 下是否已经生成 Markdown
2. bare repo 是否已有新提交
3. 本地镜像是否已拉到新提交
4. 你看的是否还是旧的 `Feeds\` 目录

## 故障优先级

- 第一优先：主体文字不丢
- 第二优先：AI 主库路径稳定
- 第三优先：自动同步恢复
- 最后才是排版和清洗细节
