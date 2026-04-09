# WeChat Obsidian Knowledge Base

article + obsidian AI 的一体化工程。

## 功能

- 管理微信公众号订阅源
- 拉取和刷新文章
- 归档正文到 `WeWe-RSS-AI` Markdown 主库
- 同步到本地 Windows Obsidian / Codex 目录
- 保留 `z001` 远端部署与镜像脚本

## 目录

```text
apps/server   服务端
apps/web      GUI 界面
scripts/      部署、同步、归档脚本
docs/         运维和设计文档
```

## 快速开始

```bash
pnpm install
pnpm build:web
pnpm start:server
```

默认通过 `/dash` 打开 Web 界面。

## 推荐运行结构

```text
D:\opt\app\wechat-obsidian-knowledge-base\
  wechat-backend\
  obsidian-knowledge-base\
  secrets\
```

- `wechat-backend` 存放代码
- `obsidian-knowledge-base` 存放本地知识库
- `secrets\wewe-rss` 存放连接 `z001` 的 SSH 材料

## 常用命令

```bash
pnpm archive:obsidian:status
pnpm archive:obsidian:repair-all:status
pnpm archive:obsidian:mirror:startup:status
```

## LLM Wiki

新增了一套 sidecar 工具链，用于在 `WeWe-RSS-AI/` 原始归档之上生成：

- `Hub/` 总导航 wiki
- `Wikis/<feed>/` 每个公众号自己的独立 wiki
- `output/json/` 结构化副产物

配置文件：

```text
llm-wiki.config.json
```

首版默认启用了：

- `榴莲忘返-aidd-de39c3`

常用命令：

```bash
node ./scripts/llm-wiki-run.mjs --feed 榴莲忘返-aidd-de39c3 --month 2025-03
node ./scripts/llm-wiki-backfill.mjs --feed 榴莲忘返-aidd-de39c3 --from 2025-01 --to 2025-03
node ./scripts/llm-wiki-lint.mjs --feed 榴莲忘返-aidd-de39c3
node ./scripts/llm-wiki-render-month.mjs --feed 榴莲忘返-aidd-de39c3 --month 2025-03
pnpm wiki:setup:local
pnpm wiki:pdf:install
pnpm wiki:pdf:login -- --feed 榴莲忘返-aidd-de39c3
pnpm wiki:pdf:attach -- --feed 榴莲忘返-aidd-de39c3 --month 2025-03 --article 5aa30e49 --file D:\Downloads\acs-paper.pdf --url https://pubs.acs.org/doi/pdf/10.1021/acs.jmedchem.4c03159
pnpm wiki:run -- --feed 榴莲忘返-aidd-de39c3 --month 2025-03 --force-pdf
node --test ./scripts/llm-wiki.test.mjs
```

说明：

- 若配置了 `GLM_API_KEY`、`GLM_BASE_URL`、`GLM_MODEL`，会优先走 GLM。
- 若未配置 GLM，当前实现会自动回退到本地规则抽取器 `local-rules`。
- PDF 生成依赖 `playwright`；缺依赖时会安全降级，不阻塞 Markdown 和 JSON 输出。
- 新机器先执行 `pnpm wiki:pdf:install` 安装 Chromium。
- `pnpm wiki:setup:local` 会同时准备兼容的 `pnpm` 版本、安装依赖并安装 Chromium。
- PDF 生成会先尝试抓取原始 PDF 下载，失败后再回退为网页打印。
- 对需要登录的论文站点，先执行 `pnpm wiki:pdf:login -- --feed <slug> --channel msedge --url <登录页或期刊页>` 完成一次人工登录，后续再用 `--force-pdf` 刷新目标月份。
- `榴莲忘返-aidd-de39c3` 已预置一个机构登录示例目标：`https://pubs.acs.org/doi/10.1021/acs.jmedchem.4c03159`。因此可以直接执行 `pnpm wiki:pdf:login -- --feed 榴莲忘返-aidd-de39c3`。
- 如果 ACS 页面要求机构访问，按站点提示选择 institution login，搜索 `Zhejiang University` / `浙江大学`，再输入你的工号完成认证。
- 如果 ACS 在“受自动化控制的浏览器”里卡在 Cloudflare 验证，改用你平时正常使用的 Edge profile 先手工完成验证和机构登录，再通过 `--user-data-dir` 与 `--profile-directory` 让脚本复用该 profile。
- 如果自动化最终仍然拿不到付费 PDF，就先在普通浏览器里手工下载 PDF，再用 `pnpm wiki:pdf:attach -- --feed <slug> --article <hash> --file <local.pdf> --url <publisher-pdf-url>` 回填到对应 article 输出。
- 当前已内置 `arXiv`、`bioRxiv`、`medRxiv`、`ACS`、`Science`、`Nature`、`Springer`、`ScienceDirect`、`Wiley`、`Cell` 的常见 PDF 下载规则。

## 文档

- [docs/README.md](./docs/README.md)
- [docs/obsidian-ai-archive/ops/ZJU-INSTITUTIONAL-PDF-LOGIN.md](./docs/obsidian-ai-archive/ops/ZJU-INSTITUTIONAL-PDF-LOGIN.md)
- [docs/obsidian-ai-archive/ops/PDF-AUTO-SYNC.md](./docs/obsidian-ai-archive/ops/PDF-AUTO-SYNC.md)
- [docs/obsidian-ai-archive/README.md](./docs/obsidian-ai-archive/README.md)
- [docs/obsidian-ai-archive/ops/NEW-MACHINE-DEPLOYMENT.md](./docs/obsidian-ai-archive/ops/NEW-MACHINE-DEPLOYMENT.md)

## PDF Auto Sync

Only feeds explicitly allowed in `llm-wiki.config.json` participate in automatic PDF sync.

Required feed flags:

```json
{
  "pdf_enabled": true,
  "pdf_auto_sync_enabled": true
}
```

Optional incremental guard:

```json
{
  "pdf_auto_sync_initial_lookback_days": 30
}
```

On the first auto-sync run, only recent articles inside that lookback window are picked up automatically based on article publish time. Older historical gaps stay deferred until you sync a specific month manually.

Commands:

```bash
corepack pnpm@8.15.8 run wiki:pdf:sync -- --all --dry-run
corepack pnpm@8.15.8 run wiki:pdf:sync -- --all --new-only
corepack pnpm@8.15.8 run wiki:pdf:sync -- --all
corepack pnpm@8.15.8 run wiki:pdf:sync:install
corepack pnpm@8.15.8 run wiki:pdf:sync:status
```

The installed scheduled task now runs at fixed daily times instead of every 2 hours. Default times are `09:15` and `21:15`, and the scheduled runner uses `--new-only` so failed PDF retries are not part of the routine schedule.

## GLM Manual Mode

Normal `wiki:run` remains on `local-rules`. GLM Coding Plan is only used through manual commands.

Environment:

```bash
GLM_API_KEY=your-rotated-glm-key
GLM_MANUAL_BASE_URL=https://open.bigmodel.cn/api/coding/paas/v4
```

Use `.env.local` at the repo root. A tracked template is available at `.env.local.example`.

Manual commands:

```bash
corepack pnpm@8.15.8 run wiki:glm:probe -- --feed 榴莲忘返-aidd-de39c3
corepack pnpm@8.15.8 run wiki:glm:estimate -- --feed 榴莲忘返-aidd-de39c3 --month 2025-03
corepack pnpm@8.15.8 run wiki:glm:run -- --feed 榴莲忘返-aidd-de39c3 --month 2025-03
```

Rules:
- `wiki:glm:run` requires an interactive terminal.
- Model order is `glm-5 -> glm-4.7 -> glm-4.6 -> local-rules`.
- More than `50` selected articles triggers a strong warning.
- More than `100` selected articles requires `--allow-large-batch`.
- `wiki:glm:estimate -- --assume-peak` reports the more conservative peak-time quota estimate.
- Because the previously shared key is already exposed, rotate it before saving it to `.env.local`.

## License

[MIT](./LICENSE)

## GUI Launcher

There is now a root-level Windows launcher for common LLM-Wiki operations:

- `D:\opt\app\wechat-obsidian-knowledge-base\open-llm-wiki-tools.cmd`
- `D:\opt\app\wechat-obsidian-knowledge-base\scripts\gui\llm-wiki-tools.ps1`
- `D:\opt\app\wechat-obsidian-knowledge-base\scripts\tools\build-llm-wiki-tools.cmd`

Double-click the `.cmd` file, select the command and parameters, and the launcher opens a dedicated PowerShell window to run the selected task.
Use the build script if you want a single `.exe` launcher.

Current verified station status and launcher notes:

- [docs/obsidian-ai-archive/ops/LLM-WIKI-STATUS-2026-04-09.md](./docs/obsidian-ai-archive/ops/LLM-WIKI-STATUS-2026-04-09.md)
