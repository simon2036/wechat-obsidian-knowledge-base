import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessContentQuality,
  buildArchiveState,
  buildArticleFileName,
  buildMarkdownDocument,
  buildRawPayload,
  extractRichMediaContentHtml,
  htmlToMarkdown,
  resolveArticleContent,
  slugifySegment,
  stripWeChatChrome,
} from './obsidian-archive-lib.mjs';

test('slugifySegment sanitizes invalid path characters', () => {
  assert.equal(slugifySegment(' A/B:C*D?E "F" '), 'a-b-c-d-e-f');
});

test('htmlToMarkdown preserves anchors and lists', () => {
  const markdown = htmlToMarkdown(`
    <div>
      <p>Hello <a href="https://example.com">world</a></p>
      <ul><li>One</li><li>Two</li></ul>
    </div>
  `);

  assert.match(markdown, /Hello \[world\]\(https:\/\/example\.com\)/);
  assert.match(markdown, /- One/);
  assert.match(markdown, /- Two/);
});

test('htmlToMarkdown flattens nested WeChat list blocks into single bullet lines', () => {
  const markdown = htmlToMarkdown(`
    <ul>
      <li><section><p>54 nM \u7684\u9776\u70b9\u4eb2\u548c\u529b</p></section></li>
      <li><section><p>ANCA \u786e\u5b9e\u6fc0\u6d3b SYK</p></section></li>
    </ul>
  `);

  assert.match(markdown, /- 54 nM \u7684\u9776\u70b9\u4eb2\u548c\u529b/u);
  assert.match(markdown, /- ANCA \u786e\u5b9e\u6fc0\u6d3b SYK/u);
  assert.doesNotMatch(markdown, /-\s*\n\s*54 nM/u);
});

test('htmlToMarkdown handles WeChat data-src galleries without swallowing following text', () => {
  const markdown = htmlToMarkdown(`
    <div class="rich_media_content" id="js_content">
      <section style="display:flex;">
        <section><img alt="slide-1" data-src="https://example.com/1.png" data-w="1080" style="width:80%;"></section>
        <section><img data-src="https://example.com/2.png" alt="slide-2" style="width:80%;" /></section>
      </section>
      <p>&lt;&lt;&lt; Swipe for more &gt;&gt;&gt;</p>
      <p>First real paragraph after the gallery.</p>
      <p>Second paragraph with enough signal to count as usable content.</p>
    </div>
  `);

  assert.match(markdown, /!\[slide-1\]\(https:\/\/example\.com\/1\.png\)/);
  assert.match(markdown, /!\[slide-2\]\(https:\/\/example\.com\/2\.png\)/);
  assert.match(markdown, /First real paragraph after the gallery\./);
  assert.match(markdown, /Second paragraph with enough signal/);
  assert.doesNotMatch(markdown, /data-w=/);
  assert.doesNotMatch(markdown, /style=/);
});

test('buildArticleFileName is stable and readable', () => {
  const fileName = buildArticleFileName(
    'A new article',
    'article-123',
    new Date('2026-04-07T00:00:00Z'),
  );
  assert.match(fileName, /^2026-04-07-a-new-article-[a-f0-9]{8}\.md$/);
});

test('assessContentQuality rejects shell content', () => {
  const quality = assessContentQuality({
    title: '蛋白质模型蒸馏',
    content: '蛋白质模型蒸馏\nRead original',
  });

  assert.equal(quality.usable, false);
  assert.equal(quality.reason, 'failure-marker');
});

test('assessContentQuality rejects wechat chrome wrappers', () => {
  const quality = assessContentQuality({
    title: '蛋白质模型蒸馏',
    content: `
      # 蛋白质模型蒸馏
      Original
      [榴莲忘返 AIDD](javascript:void(0);)
      向上滑动看下一个
      微信扫一扫可打开此内容
    `,
  });

  assert.equal(quality.usable, false);
  assert.equal(quality.reason, 'wechat-chrome');
});

test('assessContentQuality rejects image-only shells', () => {
  const quality = assessContentQuality({
    title: 'Image only shell',
    content: `
      ![cover](https://example.com/cover.png)

      ![](https://example.com/slide-1.png)

      — 完 —
    `,
  });

  assert.equal(quality.usable, false);
  assert.equal(quality.reason, 'image-shell');
});

test('extractRichMediaContentHtml returns inner html only', () => {
  const html = `
    <div class="wrapper">
      <div class="rich_media_content " id="js_content">
        <p>First paragraph</p>
        <div><p>Nested paragraph</p></div>
      </div>
    </div>
  `;

  const contentHtml = extractRichMediaContentHtml(html);
  assert.match(contentHtml, /First paragraph/);
  assert.match(contentHtml, /Nested paragraph/);
  assert.doesNotMatch(contentHtml, /class="rich_media_content"/);
});

test.skip('stripWeChatChrome removes trailing app shell', () => {
  const cleaned = stripWeChatChrome(`
    正文第一段
    正文第二段
    预览时标签不可点
    Scan to Follow
    微信扫一扫可打开此内容
  `);

  assert.match(cleaned, /正文第一段/);
  assert.match(cleaned, /正文第二段/);
  assert.doesNotMatch(cleaned, /预览时标签不可点/);
  assert.doesNotMatch(cleaned, /微信扫一扫可打开此内容/);
});

test('stripWeChatChrome merges isolated list markers without losing text', () => {
  const cleaned = stripWeChatChrome(`
    下面是关键证据：

    •

    54 nM 的靶点亲和力（ChEMBL）

    •

    人类中性粒细胞中 ANCA 确实激活 SYK（2004）
  `);

  assert.match(cleaned, /下面是关键证据/);
  assert.match(cleaned, /- 54 nM 的靶点亲和力（ChEMBL）/);
  assert.match(cleaned, /- 人类中性粒细胞中 ANCA 确实激活 SYK（2004）/);
  assert.doesNotMatch(cleaned, /\n•\n/);
});

test('stripWeChatChrome drops promotional tail after end marker but keeps the end marker', () => {
  const cleaned = stripWeChatChrome(`
    正文第一段

    — 完 —

    对相关内容感兴趣的读者，可以添加小编微信加入读者实名交流互助群。
    点击这里 👉 关注我，记得标星哦～
  `);

  assert.match(cleaned, /正文第一段/);
  assert.match(cleaned, /— 完 —/);
  assert.doesNotMatch(cleaned, /读者实名交流互助群/);
  assert.doesNotMatch(cleaned, /点击这里/);
});

test('stripWeChatChrome repairs dangling bullets across blank lines', () => {
  const cleaned = stripWeChatChrome(`
    \u4e0b\u9762\u662f\u5173\u952e\u8bc1\u636e\uff1a

    -

    54 nM \u7684\u9776\u70b9\u4eb2\u548c\u529b

    -
    ANCA \u786e\u5b9e\u6fc0\u6d3b SYK
  `);

  assert.match(cleaned, /- 54 nM \u7684\u9776\u70b9\u4eb2\u548c\u529b/u);
  assert.match(cleaned, /- ANCA \u786e\u5b9e\u6fc0\u6d3b SYK/u);
  assert.doesNotMatch(cleaned, /\n-\s*\n\s*54 nM/u);
});

test('stripWeChatChrome removes trailing CTA block after end marker without dropping body text', () => {
  const cleaned = stripWeChatChrome(`
    \u6700\u540e\u4e00\u6bb5\u6b63\u6587
    \u2014 \u5b8c \u2014
    \u5bf9\u76f8\u5173\u5185\u5bb9\u611f\u5174\u8da3\u7684\u8bfb\u8005\uff0c\u53ef\u4ee5\u6dfb\u52a0\u5c0f\u7f16\u5fae\u4fe1
    \u70b9\u51fb\u8fd9\u91cc \u{1F449} \u5173\u6ce8\u6211
  `);

  assert.match(cleaned, /\u6700\u540e\u4e00\u6bb5\u6b63\u6587/u);
  assert.match(cleaned, /\u2014 \u5b8c \u2014/u);
  assert.doesNotMatch(cleaned, /\u5c0f\u7f16\u5fae\u4fe1/u);
  assert.doesNotMatch(cleaned, /\u5173\u6ce8\u6211/u);
});

test('stripWeChatChrome trims trailing CTA block without explicit end marker', () => {
  const cleaned = stripWeChatChrome(`
    \u6700\u540e\u4e00\u6bb5\u6b63\u6587
    \u5bf9\u76f8\u5173\u5185\u5bb9\u611f\u5174\u8da3\u7684\u8bfb\u8005\uff0c\u53ef\u4ee5\u6dfb\u52a0\u5c0f\u7f16\u5fae\u4fe1
    \u52a0\u5165\u8bfb\u8005\u7fa4
  `);

  assert.equal(cleaned, '\u6700\u540e\u4e00\u6bb5\u6b63\u6587');
});

test('stripWeChatChrome keeps similar wording when it is body text', () => {
  const cleaned = stripWeChatChrome(`
    \u5bf9\u76f8\u5173\u5185\u5bb9\u611f\u5174\u8da3\u7684\u8bfb\u8005\u5e76\u4e0d\u7f55\u89c1\uff0c\u8fd9\u53ea\u662f\u6b63\u6587\u89e3\u91ca\u7684\u4e00\u90e8\u5206\u3002
    \u540e\u7eed\u6b63\u6587\u7ee7\u7eed\u5ef6\u5c55\u8fd9\u4e2a\u89c2\u70b9\u3002
  `);

  assert.match(cleaned, /\u5bf9\u76f8\u5173\u5185\u5bb9\u611f\u5174\u8da3\u7684\u8bfb\u8005/u);
  assert.match(cleaned, /\u540e\u7eed\u6b63\u6587/u);
});

test('stripWeChatChrome removes trailing app shell with utf8 markers', () => {
  const cleaned = stripWeChatChrome(`
    \u6b63\u6587\u7b2c\u4e00\u6bb5
    \u6b63\u6587\u7b2c\u4e8c\u6bb5
    \u9884\u89c8\u65f6\u6807\u7b7e\u4e0d\u53ef\u70b9
    Scan to Follow
    \u5fae\u4fe1\u626b\u4e00\u626b\u53ef\u6253\u5f00\u8be5\u5185\u5bb9
  `);

  assert.match(cleaned, /\u6b63\u6587\u7b2c\u4e00\u6bb5/u);
  assert.match(cleaned, /\u6b63\u6587\u7b2c\u4e8c\u6bb5/u);
  assert.doesNotMatch(cleaned, /\u9884\u89c8\u65f6\u6807\u7b7e\u4e0d\u53ef\u70b9/u);
  assert.doesNotMatch(cleaned, /\u5fae\u4fe1\u626b\u4e00\u626b\u53ef\u6253\u5f00\u8be5\u5185\u5bb9/u);
});

test('stripWeChatChrome removes qr and follow prompts without dropping body text', () => {
  const cleaned = stripWeChatChrome(`
    \u6b63\u6587\u7b2c\u4e00\u6bb5\uff0c\u8fd9\u91cc\u662f\u9700\u8981\u4fdd\u7559\u7684\u5185\u5bb9\u3002
    \u6b63\u6587\u7b2c\u4e8c\u6bb5\uff0c\u4ecd\u7136\u8981\u4fdd\u7559\u3002
    \u5de6\u53f3\u6ed1\u52a8\u89c1\u66f4\u591a
    \u626b\u7801\u5173\u6ce8
    \u957f\u6309\u4e8c\u7ef4\u7801
    \u52a0\u5165\u8bfb\u8005\u7fa4
    \u6dfb\u52a0\u65f6\u8bf7\u4e3b\u52a8\u6ce8\u660e
  `);

  assert.match(cleaned, /\u6b63\u6587\u7b2c\u4e00\u6bb5/u);
  assert.match(cleaned, /\u6b63\u6587\u7b2c\u4e8c\u6bb5/u);
  assert.doesNotMatch(cleaned, /\u5de6\u53f3\u6ed1\u52a8\u89c1\u66f4\u591a/u);
  assert.doesNotMatch(cleaned, /\u626b\u7801\u5173\u6ce8/u);
  assert.doesNotMatch(cleaned, /\u957f\u6309\u4e8c\u7ef4\u7801/u);
  assert.doesNotMatch(cleaned, /\u52a0\u5165\u8bfb\u8005\u7fa4/u);
  assert.doesNotMatch(cleaned, /\u6dfb\u52a0\u65f6\u8bf7\u4e3b\u52a8\u6ce8\u660e/u);
});

test('stripWeChatChrome removes qr image lines once tail noise is detected', () => {
  const cleaned = stripWeChatChrome(`
    \u6700\u540e\u4e00\u6bb5\u6b63\u6587

    ![qr](https://example.com/qr.png)
    \u626b\u7801\u5173\u6ce8
    \u957f\u6309\u4e8c\u7ef4\u7801
  `);

  assert.equal(cleaned, '\u6700\u540e\u4e00\u6bb5\u6b63\u6587');
});

test('buildMarkdownDocument creates frontmatter and body', () => {
  const feed = {
    id: 'MP_WXS_1',
    title: 'Feed Title',
    home_page_url: 'https://example.com',
  };
  const article = {
    id: 'a-1',
    title: 'Hello',
    url: 'https://example.com/post',
    date_published: '2026-04-07T01:00:00.000Z',
  };
  const markdown = buildMarkdownDocument({
    feed,
    article,
    articlePath: 'feed/2026-04/hello.md',
    rawPath: 'feed/2026-04/_raw/hello.json',
    content: 'Body text',
    contentSource: 'original_page',
    contentFetchStatus: 'original_page_rich_media',
    contentQualityReason: 'ok',
    contentStatus: 'available',
    syncedAt: new Date('2026-04-07T03:00:00.000Z'),
  });

  assert.match(markdown, /title: "Hello"/);
  assert.match(markdown, /feed_id: "MP_WXS_1"/);
  assert.match(markdown, /content_source: "original_page"/);
  assert.match(markdown, /canonical:wewe-rss-ai/);
  assert.match(markdown, /## Content/);
  assert.match(markdown, /Body text/);
});

test('buildRawPayload mirrors article metadata', () => {
  const payload = buildRawPayload({
    feed: {
      id: 'f',
      title: 'Feed',
      home_page_url: 'https://example.com',
      feed_url: 'https://example.com/feed',
    },
    article: {
      id: 'a',
      title: 'Hello',
      url: 'https://example.com/a',
      date_published: '2026-04-07T00:00:00.000Z',
    },
    content: 'Body',
    contentSource: 'feed',
    contentFetchStatus: 'feed_ok',
    contentQualityReason: 'ok',
    contentStatus: 'available',
    syncedAt: new Date('2026-04-07T03:00:00.000Z'),
  });

  assert.equal(payload.canonical_store, 'WeWe-RSS-AI');
  assert.equal(payload.feed.id, 'f');
  assert.equal(payload.article.content, 'Body');
  assert.equal(payload.article.content_source, 'feed');
});

test('buildArchiveState returns empty version 2 state', () => {
  const state = buildArchiveState();
  assert.deepEqual(state, { version: 2, feeds: {}, articles: {} });
});

test('resolveArticleContent falls back to original page when feed content is shell-like', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      `
        <html>
          <body>
            <div class="rich_media_content " id="js_content">
              <p>这是完整正文第一段，长度足够让质量判定通过，而且不是摘要。</p>
              <p>这是完整正文第二段，用来验证 rich_media_content 回抓真的生效。</p>
            </div>
          </body>
        </html>
      `,
      {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      },
    );

  try {
    const resolved = await resolveArticleContent(
      {
        id: 'a-1',
        title: '蛋白质模型蒸馏',
        url: 'https://mp.weixin.qq.com/s/example',
        content_html: '<p>蛋白质模型蒸馏</p><p>Read original</p>',
      },
      5000,
    );

    assert.equal(resolved.contentSource, 'original_page');
    assert.equal(resolved.contentFetchStatus, 'original_page_rich_media');
    assert.equal(resolved.contentStatus, 'available');
    assert.match(resolved.content, /完整正文第一段/);
    assert.match(resolved.content, /完整正文第二段/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('resolveArticleContent prefers original page for WeChat article URLs', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      `
        <html>
          <body>
            <div class="rich_media_content " id="js_content">
              <p>这是原文页正文第一段，应该覆盖 feed 里的较短版本。</p>
              <p>这是原文页正文第二段，说明 wechat 链接优先走 original page。</p>
            </div>
          </body>
        </html>
      `,
      {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      },
    );

  try {
    const resolved = await resolveArticleContent(
      {
        id: 'a-2',
        title: '微信文章',
        url: 'https://mp.weixin.qq.com/s/example-2',
        content_html: '<p>这是 feed 正文，但不应该优先采用。</p><p>长度也够。</p>',
      },
      5000,
    );

    assert.equal(resolved.contentSource, 'original_page');
    assert.equal(resolved.contentFetchStatus, 'original_page_rich_media');
    assert.match(resolved.content, /原文页正文第一段/);
    assert.doesNotMatch(resolved.content, /feed 正文/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
