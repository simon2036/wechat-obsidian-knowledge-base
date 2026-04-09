# WeChat Obsidian AI Archive Docs

这组文档对应的是一条完整链路：

- `wechat-backend` 负责微信公众号订阅、刷新、feed 输出、全文回抓与归档脚本
- `obsidian-knowledge-base` 负责承载本地 vault 与 `WeWe-RSS-AI/`
- `z001` 负责线上运行、远端 worktree 与 bare repo
- Windows 这台机器作为总站，统一保管代码、知识库和远端备份

## 当前约定

- 总站根目录：
  - `D:\opt\app\wechat-obsidian-knowledge-base`
- 代码仓：
  - `D:\opt\app\wechat-obsidian-knowledge-base\wechat-backend`
- 本地知识库：
  - `D:\opt\app\wechat-obsidian-knowledge-base\obsidian-knowledge-base`
- AI 主库：
  - `D:\opt\app\wechat-obsidian-knowledge-base\obsidian-knowledge-base\WeWe-RSS-AI`
- 远端备份：
  - `D:\opt\app\wechat-obsidian-knowledge-base\backups`

## 阅读顺序

1. [ops/STATUS.md](./ops/STATUS.md)
2. [ops/STATION-STRUCTURE.md](./ops/STATION-STRUCTURE.md)
3. [ops/NEW-MACHINE-DEPLOYMENT.md](./ops/NEW-MACHINE-DEPLOYMENT.md)
4. [ops/RUNBOOK.md](./ops/RUNBOOK.md)
5. [ops/MANUAL-TRIGGERS.md](./ops/MANUAL-TRIGGERS.md)
6. [dev/ARCHIVE-BRIDGE.md](./dev/ARCHIVE-BRIDGE.md)
7. [dev/CONTENT-CLEANING-DESIGN.md](./dev/CONTENT-CLEANING-DESIGN.md)
8. [dev/ROADMAP.md](./dev/ROADMAP.md)
9. [ops/LLM-WIKI-STATUS-2026-04-09.md](./ops/LLM-WIKI-STATUS-2026-04-09.md)
