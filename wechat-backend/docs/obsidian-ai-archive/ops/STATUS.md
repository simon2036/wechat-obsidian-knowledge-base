# 当前状态

Last updated: 2026-04-08

这是一份人工维护的运行快照，不替代实时监控。动态状态以命令输出为准。

## 当前形态

```text
z001
  ├─ WeWe RSS app
  ├─ bridge
  ├─ obsidian-archive sidecar
  ├─ vault git worktree
  └─ bare repo

Windows station
  ├─ wechat-backend
  ├─ obsidian-knowledge-base
  ├─ backups
  ├─ Obsidian
  └─ Codex Desktop / CLI
```

## 当前主库约定

- 总站根目录：
  - `D:\opt\app\wechat-obsidian-knowledge-base`
- AI 主库：
  - `D:\opt\app\wechat-obsidian-knowledge-base\obsidian-knowledge-base\WeWe-RSS-AI`
- 旧兼容目录：
  - `Feeds\`
- 远端 worktree：
  - `/home/ifs1/app/wewe-rss-stack/data/obsidian/worktrees/folo-rss-vault`
- 远端 bare repo：
  - `/home/ifs1/app/wewe-rss-stack/data/obsidian/repos/folo-rss-vault.git`
- 远端源码备份：
  - `D:\opt\app\wechat-obsidian-knowledge-base\backups\z001-source`
- 远端部署备份：
  - `D:\opt\app\wechat-obsidian-knowledge-base\backups\z001-deploy`

## 已知结果

- `content_source = original_page`: `640`
- `content_source = feed`: `0`
- 悬空无序列表符号行：`0`

## 当前能力

- 新文章会归档到 `WeWe-RSS-AI/`
- feed 正文不可靠时会优先回抓 `mp.weixin.qq.com` 原文页
- 每篇文章同时保存 Markdown 与 `_raw/*.json`
- 可以手动触发归档
- 可以后台跑整库 `repair-all`
- Windows 可以保留本地镜像并每日同步

## 注意事项

- Windows 是总站和消费端，不是生产数据库
- `Feeds/` 可能仍存在，但不再作为 AI 正文主库
- `/home/ifs1/app/wewe-rss-src` 在 `z001` 上不是 Git 仓库，只是运行源码副本
