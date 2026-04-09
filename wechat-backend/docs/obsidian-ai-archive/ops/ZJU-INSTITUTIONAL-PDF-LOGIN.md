# 浙大机构登录 PDF 下载流程

Last updated: 2026-04-09

## 目标

为 `榴莲忘返-aidd-de39c3` 保存一份可复用的机构登录浏览器会话，让 LLM-Wiki 后续可以自动下载需要机构权限的论文 PDF。

当前默认示例目标已经写入配置：

- 公众号文章：
  - `AI 驱动设计新型 GLP-1RA 显著提升药效和半衰期`
- 目标论文：
  - `https://pubs.acs.org/doi/10.1021/acs.jmedchem.4c03159`

选择这篇的原因：

- 它出现在当前 `榴莲忘返` 的实际文章输出里
- 它来自 ACS，属于典型的机构访问场景
- 截至 2026-04-09，OpenAlex 将它标记为 `is_oa = false`、`oa_status = closed`

## 前提

- 已执行 `pnpm wiki:setup:local`
- 已安装 Edge 浏览器
- 你的浙大机构账号本来就对目标期刊有合法访问权限

## 第一步：打开登录会话

在 `wechat-backend` 目录执行：

```powershell
pnpm wiki:pdf:login -- --feed 榴莲忘返-aidd-de39c3
```

说明：

- 该命令会使用 `msedge` 打开一个持久化 Playwright 会话
- 默认访问 `https://pubs.acs.org/doi/10.1021/acs.jmedchem.4c03159`
- 浏览器数据会保存在：
  - `D:\opt\app\wechat-obsidian-knowledge-base\obsidian-knowledge-base\.llm-wiki\cache\pdf-profiles\zju-aidd`

## 第二步：在浏览器里完成人工认证

打开页面后，按下面顺序处理：

1. 等待 ACS / Cloudflare 安全验证完成
2. 进入 ACS 文章页
3. 找到机构登录入口
4. 搜索 `Zhejiang University` 或 `浙江大学`
5. 跳转到浙大机构认证页
6. 输入你的工号并完成登录
7. 回到文章页，确认已经具备访问权限

建议确认以下任意一种状态后，再回到终端按 Enter：

- 页面已经出现 `Download PDF`
- 文章页不再提示购买访问
- 你能直接打开 PDF 页面

## 如果卡在 Cloudflare

ACS 可能会把 `Playwright` 打开的 Edge 识别成“受自动化控制的浏览器”，导致一直卡在 Cloudflare 验证页。

这时不要继续在自动化窗口里耗时间，改用下面的方式：

1. 用你平时正常使用的 Edge 手工打开目标论文页面
2. 在普通 Edge 里先过 Cloudflare
3. 完成 `institution login`
4. 搜索 `Zhejiang University` / `浙江大学`
5. 输入工号并确认你已经能打开 PDF
6. 关闭该 Edge profile 的所有窗口
7. 再让脚本复用这个真实 profile

Windows 上 Edge 用户数据目录通常在：

```text
C:\Users\<你的用户名>\AppData\Local\Microsoft\Edge\User Data
```

常见 profile 目录名：

- `Default`
- `Profile 1`
- `Profile 2`

示例命令：

```powershell
corepack pnpm@8.15.8 run wiki:pdf:login -- --feed 榴莲忘返-aidd-de39c3 --user-data-dir "C:\Users\<你的用户名>\AppData\Local\Microsoft\Edge\User Data" --profile-directory "Default"
```

如果你已经在普通 Edge 里登录成功，后续真正下载 PDF 更关键的是让 `wiki:run` 也复用同一个 profile。做法是把该 feed 配置中的：

- `pdf_user_data_dir`
- `pdf_profile_directory`

写成你实际使用的 Edge profile。这样后续 `--force-pdf` 会直接复用你手工登录过的浏览器会话。

## 第三步：保存登录态

终端会提示：

```text
Press Enter when the authenticated session is ready...
```

这时回到终端按 Enter，工具会保存浏览器会话。

## 第四步：重新刷目标月份 PDF

```powershell
pnpm wiki:run -- --feed 榴莲忘返-aidd-de39c3 --month 2025-03 --force-pdf
```

这一步会复用刚才保存的登录态，优先尝试直接下载 PDF，失败时再回退到网页打印。

## 第五步：验证结果

重点检查这篇文章对应的输出：

- 文章页：
  - `D:\opt\app\wechat-obsidian-knowledge-base\obsidian-knowledge-base\WeWe-RSS-AI\Wikis\榴莲忘返-aidd-de39c3\articles\2025-03\2025-03-30-ai-驱动设计新型-glp-1ra-显著提升药效和半衰期-5aa30e49.md`
- 文章 JSON：
  - `D:\opt\app\wechat-obsidian-knowledge-base\obsidian-knowledge-base\WeWe-RSS-AI\Wikis\榴莲忘返-aidd-de39c3\output\json\articles\2025-03\2025-03-30-ai-驱动设计新型-glp-1ra-显著提升药效和半衰期-5aa30e49.json`

重点字段：

- `pdf_status`
- `pdf_method`
- `pdf_source_url`
- `pdf_path`

理想结果：

- `pdf_status = generated`
- `pdf_method = download`

## 如果自动化还是拿不到 ACS PDF

这说明站点仍然把自动化访问识别成 bot。这时直接切到手工导入，不要再反复撞 Cloudflare。

步骤：

1. 在普通 Edge 里手工下载目标 PDF
2. 回到 `wechat-backend` 目录执行：

```powershell
corepack pnpm@8.15.8 run wiki:pdf:attach -- --feed 榴莲忘返-aidd-de39c3 --month 2025-03 --article 5aa30e49 --file "D:\Downloads\acs-paper.pdf" --url https://pubs.acs.org/doi/pdf/10.1021/acs.jmedchem.4c03159
```

说明：

- `5aa30e49` 是当前示例文章文件名尾部的唯一 hash
- `--file` 传你手工下载好的本地 PDF
- `--url` 建议传原始出版社 PDF 链接，便于后续溯源

导入完成后，对应 article JSON / Markdown 会被直接回填到标准 wiki 路径。

## 常见问题

### 1. 一直停在 Cloudflare 验证页

先不要频繁刷新。等待一段时间仍然不通过时，再刷新一次。必要时改为本机正常使用的 Edge 浏览器通道重新执行登录命令。

### 2. 机构登录成功，但 PDF 还是没下到

先确认：

- 文章页是否真的已经拿到访问权限
- PDF 下载是否需要在新标签页触发
- 期刊站点是否改了按钮结构

如果站点结构有变化，再补该站点的专用 selector 规则。

### 3. 之后还需要重新登录吗

通常不需要，直到：

- 机构会话过期
- 浏览器 profile 被清空
- 出版社要求重新认证

## 相关命令

```powershell
pnpm wiki:setup:local
pnpm wiki:pdf:login -- --feed 榴莲忘返-aidd-de39c3
pnpm wiki:run -- --feed 榴莲忘返-aidd-de39c3 --month 2025-03 --force-pdf
pnpm wiki:lint -- --feed 榴莲忘返-aidd-de39c3
```
