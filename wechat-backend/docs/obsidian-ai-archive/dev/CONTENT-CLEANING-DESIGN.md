# 正文清洗规则设计

Last updated: 2026-04-08

## 目标

为 `WeWe-RSS-AI/` 主库定义一套可解释、可回归、可继续扩展的正文清洗规则体系。

最大的原则不变：

- 不丢失主体文字
- 先保证内容完整，再做高级清洗
- 所有“删除”都必须高置信度、可解释、可回归验证

## 非目标

- 不追求人类阅读排版最漂亮
- 不在这一层做摘要、翻译、标签化
- 不在这一层直接引入 embeddings / RAG 逻辑

## 当前实现基线

当前代码主要在 [obsidian-archive-lib.mjs](../../../scripts/obsidian-archive-lib.mjs)。

已经存在的关键能力：

- `extractRichMediaContentHtml()`
  - 优先提取微信文章正文容器 `.rich_media_content`
- `htmlToMarkdown()`
  - 把 HTML 转成 Markdown / 纯文本友好形式
- `replaceImages()`
  - 已支持 `data-src` 等微信图片属性
- `replaceListItems()` + `mergeDanglingListMarkersSafe()`
  - 已修正微信嵌套列表导致的悬空 `-`
- `stripWeChatChrome()`
  - 已做保守的微信 UI / 尾部噪音清理
- `assessContentQuality()`
  - 已按长度、失败标记、壳内容、微信 chrome 命中等做可用性判断
- `resolveArticleContent()`
  - 已支持 feed 不可信时优先回抓原文页

## 当前规则资产

当前代码已经有一批高价值规则资产，后续不应散改，而应纳入系统化设计：

- `SAFE_DROP_EXACT_LINES`
- `SAFE_GLOBAL_DROP_LINE_PATTERNS`
- `SAFE_TAIL_DROP_LINE_PATTERNS`
- `SAFE_END_OF_ARTICLE_PATTERNS`
- `SAFE_CONTENT_CHROME_MARKERS`
- `mergeDanglingListMarkersSafe()`
- `trimTrailingUiBlock()`

这些规则已经证明有效，但目前仍偏“代码内嵌规则集”，缺少版本化和样例化约束。

## 设计原则

### 1. 保守删除

只有满足以下至少一项时，才允许删除文本：

- 命中高置信度固定 UI 文案
- 明确位于尾部噪音区
- 多个独立信号形成簇状命中

### 2. 分层清洗

不要把所有逻辑混成一次 `replace()`。规则应按层次执行，便于调试：

1. 抽取层
2. 结构归一化层
3. 安全删除层
4. 质量评估层
5. 可选修复层

### 3. 清洗必须可解释

后续建议把每篇文章应用过的规则记录下来，而不是只看最终结果。

### 4. 删除前后都要重评估

如果删除会让内容显著变短，或让段落数明显下降，就不应该直接采用删除结果。

## 建议的规则分层

### L0: 输入抽取层

目标：先拿到尽量接近正文的 HTML / 文本，不做删除。

规则：

- 若是微信原文页，优先抽取 `.rich_media_content`
- 若 feed 给的是整页 HTML，也优先从中抽取 `.rich_media_content`
- 若抽取后内容过短，则回退到更大的 HTML 范围

保留原则：

- 此层不删除正文
- 只做“取哪个容器”的选择

### L1: 结构归一化层

目标：把 HTML 转成稳定的 Markdown / 纯文本形式，保留主体信息。

规则：

- 解码 HTML entity
- 统一空白与空行
- 保留 URL
- 保留图片占位
- 保留列表项文字
- 把微信嵌套列表结构转成稳定的 `- item`

重点：

- 这层是“转写”，不是“清洗”
- 不能在这层顺手删掉信息量未知的内容

### L2: 安全删除层

目标：删除高置信度微信 UI 噪音，但只做保守删除。

规则分三类：

#### A. 精确删除

适合固定 UI token：

- `Original`
- `Scan to Follow`
- `Got It`
- `Mini Program`
- `Like`
- `Wow`
- `Share`
- `Comment`
- `Favorite`

要求：

- 必须是独立行
- 不允许删除普通句子内部的一部分

#### B. 全局安全删除

适合在任意位置出现都高度像 UI 的独立行：

- `左右滑动见更多`
- `继续滑动看下一个`
- `向上滑动看下一个`
- `swipe for more`

要求：

- 必须是整行命中
- 删除后不影响相邻正常句子

#### C. 尾部噪音块删除

适合出现在文章尾部的 CTA / 二维码 / 关注提示：

- `扫码关注`
- `关注公众号`
- `长按二维码`
- `长按识别`
- `识别二维码`
- `扫码添加`
- `加小编微信`
- `加入读者群`
- `点击这里 👉 关注我`
- `点击下方名片`

要求：

- 只能从末尾向前扫描
- 只删除尾部连续噪音区
- 命中尾部噪音后，可连带删除紧邻的二维码图片行
- 一旦遇到明显正文段落，立即停止删除

### L3: 质量评估层

目标：判定当前文本是否已足够作为主库正文。

建议统一以下指标：

- `len_total`
  - 清洗后总字符数
- `len_plain`
  - 去掉 markdown 语法后的有效字符数
- `paragraph_like_lines`
  - 长度达到阈值的段落数
- `wechat_chrome_marker_hits`
  - 微信 UI 命中数
- `title_overlap`
  - 与标题重合的比例
- `list_item_count`
  - 列表项数量

建议判定状态：

- `available`
  - 可直接入主库
- `available_needs_review`
  - 内容勉强可用，但仍有较高 UI 噪音风险
- `unavailable`
  - 内容不可用，需要 fallback 或保留失败状态

### L4: 修复层

目标：在明确的 repair 流程中，允许使用比日常同步更激进一点的修复规则。

只在以下场景启用：

- `repair-feed-sourced`
- `repair-all`
- 明确的人工修复任务

这层可以做：

- 更强的尾部块识别
- 更严格的壳内容判定
- 修复旧版本遗留的列表 / 图片占位问题

但仍然不能做：

- 大范围正文裁剪
- 无回归样例支撑的“猜测性删除”

## 删除判定矩阵

| 内容类型 | 是否允许删除 | 约束 |
| --- | --- | --- |
| 独立 UI token | 允许 | 必须整行命中 |
| 尾部二维码提示 | 允许 | 仅限尾部噪音区 |
| 正文段落 | 不允许 | 即便含有 CTA 类词语也不删 |
| 列表项正文 | 不允许 | 列表格式可修，但文字不能丢 |
| 图注文字 | 默认不删 | 除非确认是纯二维码提示 |
| 正常参考链接 | 不删 | 即使在文末也保留 |
| `— 完 —` | 保留 | 视作正文结束标记 |

## 回归样例设计

ROADMAP 第一项不应该只停留在“再加点测试”，而是要把样例类型固定下来。

建议至少维护以下样例：

### 样例 A: 微信正文 + 尾部二维码噪音

输入：

- 多段正文
- 文末含 `扫码关注`
- 含二维码图片
- 含 `继续滑动看下一个`

断言：

- 正文关键句保留
- 尾部噪音删除
- 删除后正文长度仍大于阈值

### 样例 B: 列表型文章

输入：

- `<li><section><p>...</p></section></li>`

断言：

- 列表项变成稳定 `- item`
- 不出现单独一行 `-`

### 样例 C: 图片较多但文字较少的文章

输入：

- 多张图
- 有图注
- 正文文字偏少

断言：

- 图注不被误删
- 不因为“短”就直接判死

### 样例 D: feed 壳内容

输入：

- `Read original`
- `获取全文失败`
- 只有标题和原链

断言：

- feed 内容判为不可用
- 会触发原文页 fallback

### 样例 E: 非微信来源

输入：

- 普通 feed 正文

断言：

- 不强行套用微信尾部规则
- 不误删正常文末链接

## 建议的后续代码演进

### 1. 引入规则版本

建议新增：

- `content_cleaning_version`
- `content_cleaning_rules_applied`
- `content_quality_metrics`

写回 frontmatter 和 raw JSON。

### 2. 把尾部删除做成独立策略函数

建议从当前 `trimTrailingUiBlock()` 继续演进成具备参数化能力的函数，例如：

```js
stripTailNoise(lines, {
  tailMarkers,
  exactDrops,
  maxTailLines,
  preservePatterns,
  minRemainingMetrics,
})
```

### 3. 把评估结果结构化

当前 `assessContentQuality()` 返回的信息还不够细，后续建议统一成：

```js
{
  usable: true,
  state: 'available',
  reason: 'ok',
  metrics: {
    len_total: 0,
    len_plain: 0,
    paragraph_like_lines: 0,
    wechat_chrome_marker_hits: 0,
  },
}
```

### 4. 把样例驱动测试做成固定资产

建议未来新增目录：

```text
scripts/fixtures/content-cleaning/
  wechat-tail-noise/
  list-heavy-article/
  image-heavy-article/
  feed-shell/
  non-wechat-source/
```

测试必须离线可跑，不依赖网络。

## 建议开发顺序

1. 先把现有真实问题沉淀成固定样例
2. 再给规则加版本号和规则追踪字段
3. 再重构尾部清洗与质量评估函数
4. 最后才考虑更激进的修复层

## 结论

正文清洗的核心不是“删得更干净”，而是：

- 在不丢主体文字的前提下
- 只删高置信度噪音
- 让每次规则改动都能被样例验证

后续任何清洗规则开发，都应该以这份文档为设计基线。
