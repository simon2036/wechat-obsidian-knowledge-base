# PDF Auto Sync

Last updated: 2026-04-09

## 目标

给 LLM-Wiki 增加一层可持续运行的 PDF 同步能力：

- 判断哪些文章已经成功生成 PDF
- 判断哪些新文章还没有处理 PDF
- 判断哪些文章之前失败过，但是否要重试由调用方式决定
- 只对明确允许的公众号执行 PDF 自动处理

## 允许名单

默认所有公众号都不参与 PDF 自动同步。

只有在 `llm-wiki.config.json` 里同时满足下面两个条件，`pdf:sync` 和计划任务才会处理这个 feed：

```json
{
  "feeds": {
    "<feed-slug>": {
      "pdf_enabled": true,
      "pdf_auto_sync_enabled": true
    }
  }
}
```

可选的首次自动同步窗口：

```json
{
  "pdf_auto_sync_initial_lookback_days": 30
}
```

说明：

- 首次自动同步、还没有历史 `pdfSync.lastRunAt` 时
- 默认按文章 `published_at` 只自动扫描最近 `30` 天
- 更老的历史缺口会进入 `deferred_count`
- 需要时再按月手工补

如果只想手工处理，不想进入自动任务：

```json
{
  "pdf_enabled": true,
  "pdf_auto_sync_enabled": false
}
```

## 命令

单个公众号同步：

```powershell
corepack pnpm@8.15.8 run wiki:pdf:sync -- --feed 榴莲忘返-aidd-de39c3
```

查看所有允许公众号的待处理状态，不写文件：

```powershell
corepack pnpm@8.15.8 run wiki:pdf:sync -- --all --dry-run
```

只处理新文章，不把失败重跑算进本轮：

```powershell
corepack pnpm@8.15.8 run wiki:pdf:sync -- --all --new-only
```

处理所有允许公众号：

```powershell
corepack pnpm@8.15.8 run wiki:pdf:sync -- --all
```

只扫某个月：

```powershell
corepack pnpm@8.15.8 run wiki:pdf:sync -- --all --month 2025-03
```

## 返回结果

`pdf:sync` 会返回每个 feed 的摘要字段：

- `allowed`
- `auto_sync_enabled`
- `new_only`
- `scan_mode`
- `last_pdf_sync_at`
- `window_start_at`
- `article_count_scanned`
- `generated_count`
- `manual_import_count`
- `pending_new_count`
- `pending_retry_count`
- `deferred_count`
- `blocked_count`
- `processed`
- `skipped`
- `failures`
- `sync_status`

常见含义：

- `sync_status = up_to_date`
  - 当前没有待处理 PDF
- `sync_status = processed`
  - 本次实际处理了待同步文章
- `sync_status = not_allowed`
  - 这个公众号没有被允许进入 PDF 自动链路

## 自动重试边界

系统会把下面几类文章视为“可重试”：

- 没有 article JSON 输出
- article JSON 存在，但 `pdf_status = failed`
- article JSON 存在，但 `pdf_status = dependency_missing` 且现在本机已有 Playwright/Chromium
- article JSON 里写的是 `generated`，但目标 PDF 文件实际不存在

默认不会自动吃掉整库历史积压：

- 首次自动同步只处理最近窗口内的文章
- 更老的未处理条目进入 `deferred_count`
- 需要时再按月手工回填

计划任务默认还会额外带上 `--new-only`：

- 只处理新文章
- 不自动重跑 `pdf_status = failed`
- 不自动重跑 `pdf_status = dependency_missing`
- 如果你要主动补失败项，再手工跑 `wiki:pdf:sync` 或按月 `wiki:run --force-pdf`

不会自动覆盖的情况：

- `pdf_status = manual_import`
- `pdf_status = skipped`
- 公众号没有启用 `pdf_enabled`

## 定期执行

安装计划任务：

```powershell
corepack pnpm@8.15.8 run wiki:pdf:sync:install
```

查看计划任务状态：

```powershell
corepack pnpm@8.15.8 run wiki:pdf:sync:status
```

立即手工触发一次：

```powershell
corepack pnpm@8.15.8 run wiki:pdf:sync:run-now
```

卸载计划任务：

```powershell
corepack pnpm@8.15.8 run wiki:pdf:sync:uninstall
```

默认行为：

- 任务名：`LLM Wiki PDF Sync`
- 每天运行 `2` 次
- 默认时间：`09:15`、`21:15`
- 默认安装在任务计划程序根路径 `\`

如果你要改成每天一次：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\manage-llm-wiki-pdf-sync-task.ps1 -Action Install -RunTimes 08:15
```

如果你要改成每天两次但换时点：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\manage-llm-wiki-pdf-sync-task.ps1 -Action Install -RunTimes 08:15,20:30
```

## 运行日志

每次真实执行都会把结果写入：

- Vault 状态目录：`obsidian-knowledge-base\.llm-wiki\runs\`
- Feed 级日志：`WeWe-RSS-AI\Wikis\<feed>\log.md`
- Hub 日志：`WeWe-RSS-AI\Hub\log.md`

## 付费 PDF 的边界

`pdf:sync` 适合自动抓取这些来源：

- arXiv
- bioRxiv
- medRxiv
- Nature 开放 PDF
- Springer / Wiley / ScienceDirect 中可直接访问的 PDF

对 ACS 这类带 Cloudflare 或强机构登录的网站：

- 自动化可能被拦截
- 推荐先手工登录
- 如果自动下载仍失败，改用 `wiki:pdf:attach`

手工导入示例：

```powershell
corepack pnpm@8.15.8 run wiki:pdf:attach -- --feed 榴莲忘返-aidd-de39c3 --month 2025-03 --article 5aa30e49 --file "C:\Users\73623\Downloads\copper-kras-cox2-axis-a-therapeutic-vulnerability-in-pancreatic-cancer.pdf" --url https://pubs.acs.org/doi/pdf/10.1021/acs.jmedchem.4c03159
```
