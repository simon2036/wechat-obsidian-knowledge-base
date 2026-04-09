# 归档桥设计

## 目标

归档桥不是 `wewe-rss` 的替代品，它负责把 `wewe-rss` 产出的 feed 结果稳定地落到 Obsidian AI 主库。

它的职责是：

- 拉取 JSON feed，优先 `mode=fulltext`
- 判断 feed 正文是否可用
- 必要时回抓 `mp.weixin.qq.com` 原文页
- 输出 Markdown 主文档
- 输出 `_raw/*.json` sidecar
- 维护稳定路径和状态文件
- 在部署启用时执行 Git 提交和推送

## 边界

### 归档桥负责

- 文章级归档
- 正文来源选择
- 正文质量判定
- 保守清洗
- 文件落盘与状态更新

### 归档桥不负责

- WeRead 登录
- 公众号列表抓取协议本身
- embeddings / 向量索引
- RAG 服务
- 高级标签生成

## 主库约定

- AI 主库：`<vault>/WeWe-RSS-AI`
- 旧兼容目录：`<vault>/Feeds`

AI 工具后续一律指向 `WeWe-RSS-AI`。

## 输出结构

```text
<vault>/
  WeWe-RSS-AI/
    <feed-title>-<id>/
      2026-04/
        2026-04-07-title-<hash>.md
        _raw/
          2026-04-07-title-<hash>.json
    .wewe-rss-archive/
      state.json
```

## 当前实现入口

核心文件：

- [obsidian-archive-lib.mjs](../../../scripts/obsidian-archive-lib.mjs)
- [obsidian-archive-worker.mjs](../../../scripts/obsidian-archive-worker.mjs)
- [obsidian-archive.test.mjs](../../../scripts/obsidian-archive.test.mjs)

核心函数：

- `htmlToMarkdown()`
- `sanitizeContent()`
- `stripWeChatChrome()`
- `assessContentQuality()`
- `resolveArticleContent()`
- `syncArchive()`
- `repairArchive()`

## 数据流

```text
wewe-rss feed json
  -> feed candidate extraction
  -> html/text normalization
  -> quality assessment
  -> original page fallback when needed
  -> conservative cleanup
  -> markdown/raw write
  -> archive state update
  -> optional git sync
```

## 关键不变量

### 1. 不丢稳定身份

- 路径稳定性依赖 `article_id`
- 标题变化不能导致历史路径失控漂移

### 2. 不丢主体文字

- 正文完整性优先于排版美观
- 所有清洗都必须以“保守删除”为原则

### 3. 不丢调试上下文

- 每篇文章必须保留 raw sidecar
- frontmatter 必须保留来源、抓取状态、质量原因

## 输出契约

Markdown frontmatter 目前至少包含：

- `title`
- `feed_id`
- `feed_title`
- `article_id`
- `source_url`
- `publish_time`
- `synced_at`
- `content_source`
- `content_fetch_status`
- `content_quality_reason`
- `content_status`
- `article_path`
- `raw_path`
- `tags`

raw JSON 作为调试和未来加工的保真层，不应该被省略。

## 后续扩展点

- 在不破坏保真层的前提下新增 `AI-clean` 派生层
- 增加 `content_cleaning_version` 和规则追踪
- 增加更细的质量指标与回归样例
