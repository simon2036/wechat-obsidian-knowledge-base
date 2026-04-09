# WeChat Obsidian Station

article + obsidian AI 的总站目录。

## 目录

```text
D:\opt\app\wechat-obsidian-knowledge-base\
  wechat-backend\
  obsidian-knowledge-base\
  scripts\
  secrets\
    wewe-rss\
  backups\
    z001-source\
    z001-deploy\
```

## 说明

- `wechat-backend`：公众号订阅、文章刷新、全文归档、GUI、部署脚本和文档
- `obsidian-knowledge-base`：本地 Obsidian vault，主库目录是 `WeWe-RSS-AI`
- `secrets\wewe-rss`：连接 `z001` 的 SSH 材料
- `backups`：`z001` 远端源码和部署配置备份

## 约定

- GUI 一键打开：`open-wewe-rss-dash.cmd`
- 新机器初始化：
  - 主目录入口：`initialize-station.cmd`
  - 实际脚本：`scripts\initialize-station.ps1`
- 一键导出并发布：
  - 主目录入口：`publish-station-to-github.cmd`
  - 实际脚本：`scripts\publish-station-to-github.ps1`
- 代码入口：`wechat-backend`
- AI 主库入口：`obsidian-knowledge-base\WeWe-RSS-AI`
- GitHub 发布版本只保留目录结构和模板，不包含真实知识库数据、密钥和远端生产备份

## 文档入口

- [wechat-backend/docs/README.md](./wechat-backend/docs/README.md)
- [wechat-backend/docs/obsidian-ai-archive/README.md](./wechat-backend/docs/obsidian-ai-archive/README.md)

## LLM Wiki Tools

- Double-click `open-llm-wiki-tools.cmd`
- Main UI implementation: `scripts\gui\llm-wiki-tools.ps1`
- The launcher lets you select a command, feed, month, PDF file, or GLM options without memorizing CLI syntax
- Rebuild the executable with `scripts\tools\build-llm-wiki-tools.cmd`
- The generated executable is expected at `llm-wiki-tools.exe` in the station root
- If the exe is missing, `open-llm-wiki-tools.cmd` still works because it falls back to the PowerShell launcher

## Script Layout

The root keeps only common entry points:

- `open-llm-wiki-tools.cmd`
- `open-wewe-rss-dash.cmd`
- `initialize-station.cmd`
- `publish-station-to-github.cmd`
- `llm-wiki-tools.exe`

Supporting scripts live under `scripts\`:

- `scripts\gui` for the LLM-Wiki launcher implementation
- `scripts\launch` for the Dash proxy
- `scripts\setup` for station initialization
- `scripts\publish` for snapshot publishing
- `scripts\tools` for build and helper utilities
