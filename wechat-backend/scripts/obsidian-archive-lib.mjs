import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_STATE_DIR = '.wewe-rss-archive';
const DEFAULT_LIMIT = 10;
const DEFAULT_TIMEOUT_MS = 120_000;
const FALLBACK_MIN_LENGTH = 160;
const FALLBACK_SHELL_LENGTH = 480;
const PARAGRAPH_MIN_LENGTH = 30;
const WECHAT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

const CONTENT_FAILURE_MARKERS = [
  'please try again',
  'read original',
  'no content available',
  'content unavailable',
  'full text unavailable',
];

const CONTENT_CHROME_MARKERS = [
  'javascript:void(0)',
  '微信扫一扫可打开此内容',
  'scan with weixin',
  'mini program',
  '轻触阅读原文',
  '向上滑动看下一个',
  '继续滑动看下一个',
  '预览时标签不可点',
  'scan to follow',
];

const TAIL_TRUNCATE_MARKERS = [
  '预览时标签不可点',
  '轻触阅读原文',
  '向上滑动看下一个',
  '继续滑动看下一个',
  '微信扫一扫可打开此内容',
  'scan with weixin',
  'scan to follow',
];

const DROP_EXACT_LINES = new Set([
  'Original',
  'Scan to Follow',
  'Got It',
  'Video',
  'Mini Program',
  'Like',
  'Wow',
  'Share',
  'Comment',
  'Favorite',
  '听过',
  '分析',
  '×',
  '在小说阅读器中沉浸阅读',
]);

const END_OF_ARTICLE_PATTERNS = [/^—\s*完\s*—$/i, /^-\s*完\s*-$/i];
const DROP_LINE_PATTERNS = [
  /^<{2,}\s*左右滑动见更多\s*>{2,}$/i,
  /^左右滑动见更多$/i,
  /^swipe for more$/i,
  /^继续滑动看下一个$/i,
  /^向上滑动看下一个$/i,
  /^对相关内容感兴趣的读者/i,
  /^添加时请主动注明/i,
  /^点击这里\s*[👉>].*关注我/i,
];
const LIST_MARKER_LINE_PATTERN = /^[•·●\-]$/;

const SAFE_CONTENT_CHROME_MARKERS = [
  'javascript:void(0)',
  '\u5fae\u4fe1\u626b\u4e00\u626b\u53ef\u6253\u5f00\u8be5\u5185\u5bb9',
  'scan with weixin',
  'mini program',
  '\u8f7b\u89e6\u9605\u8bfb\u539f\u6587',
  '\u5411\u4e0a\u6ed1\u52a8\u770b\u4e0b\u4e00\u4e2a',
  '\u7ee7\u7eed\u6ed1\u52a8\u770b\u4e0b\u4e00\u4e2a',
  '\u9884\u89c8\u65f6\u6807\u7b7e\u4e0d\u53ef\u70b9',
  'scan to follow',
  '\u539f\u6587',
];

const SAFE_DROP_EXACT_LINES = new Set([
  'Original',
  '\u539f\u6587',
  'Scan to Follow',
  'Got It',
  'Video',
  'Mini Program',
  'Like',
  'Wow',
  'Share',
  'Comment',
  'Favorite',
  '\u542c\u8fc7',
  '\u5206\u6790',
  '脳',
  '\u5728\u5c0f\u7a0b\u5e8f\u9605\u8bfb\u5668\u4e2d\u6c89\u6d78\u9605\u8bfb',
]);

const SAFE_END_OF_ARTICLE_PATTERNS = [/^(?:[-\u2013\u2014]\s*)?\u5b8c(?:\s*[-\u2013\u2014])?$/u];
const SAFE_GLOBAL_DROP_LINE_PATTERNS = [
  /^<{2,}\s*\u5de6\u53f3\u6ed1\u52a8\u89c1\u66f4\u591a\s*>{2,}$/u,
  /^\u5de6\u53f3\u6ed1\u52a8\u89c1\u66f4\u591a$/u,
  /^swipe for more$/i,
  /^\u7ee7\u7eed\u6ed1\u52a8\u770b\u4e0b\u4e00\u4e2a/u,
  /^\u5411\u4e0a\u6ed1\u52a8\u770b\u4e0b\u4e00\u4e2a/u,
];
const SAFE_TAIL_DROP_LINE_PATTERNS = [
  /^\u5bf9\u76f8\u5173\u5185\u5bb9\u611f\u5174\u8da3\u7684\u8bfb\u8005/u,
  /^\u6dfb\u52a0\u65f6\u8bf7\u4e3b\u52a8\u6ce8\u660e/u,
  /^\u70b9\u51fb\u8fd9\u91cc\s*[\u{1F449}>].*\u5173\u6ce8\u6211/iu,
  /^\u9884\u89c8\u65f6\u6807\u7b7e\u4e0d\u53ef\u70b9/u,
  /^\u8f7b\u89e6\u9605\u8bfb\u539f\u6587/u,
  /^\u5fae\u4fe1\u626b\u4e00\u626b\u53ef\u6253\u5f00\u8be5\u5185\u5bb9/u,
  /^\u626b\u7801\u5173\u6ce8/u,
  /^\u5173\u6ce8\u516c\u4f17\u53f7/u,
  /^\u5173\u6ce8\u6211\u4eec/u,
  /^\u957f\u6309\u4e8c\u7ef4\u7801/u,
  /^\u957f\u6309\u8bc6\u522b/u,
  /^\u8bc6\u522b\u4e8c\u7ef4\u7801/u,
  /^\u626b\u7801\u6dfb\u52a0/u,
  /^\u52a0\u5c0f\u7f16\u5fae\u4fe1/u,
  /^\u52a0.*\u5fae\u4fe1/u,
  /^\u52a0\u5165\u8bfb\u8005\u7fa4/u,
  /^\u52a0\u5165.*\u4ea4\u6d41\u7fa4/u,
  /^\u70b9\u51fb\u4e0b\u65b9\u540d\u7247/u,
  /^\u70b9\u51fb.*\u539f\u6587/u,
];
const SAFE_LIST_MARKER_LINE_PATTERN = /^[\u2022\u00b7*\-]$/u;
const SAFE_INLINE_LIST_MARKER_PATTERN = /^[\u2022\u00b7\u25cf\u25e6*\-]\s+(.*)$/u;

export const defaultArchiveOptions = {
  baseUrl: 'http://127.0.0.1:4000',
  feedUrls: [],
  discoverFeeds: true,
  includeAllFeed: false,
  limit: DEFAULT_LIMIT,
  mode: 'fulltext',
  stateDir: DEFAULT_STATE_DIR,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  dryRun: false,
};

function normalizeWhitespace(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripTags(value) {
  return String(value ?? '').replace(/<[^>]+>/g, '');
}

function parseHtmlTagAttributes(tag) {
  const attributes = {};
  const attributePattern =
    /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match = attributePattern.exec(String(tag ?? ''));

  while (match) {
    const name = String(match[1] ?? '').toLowerCase();
    if (name && name !== 'img' && name !== 'a') {
      attributes[name] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? '');
    }
    match = attributePattern.exec(String(tag ?? ''));
  }

  return attributes;
}

function escapeRegExp(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function shortHash(value, length = 8) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, length);
}

export function slugifySegment(value, fallback = 'untitled') {
  const normalized = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+|\.+$/g, '')
    .replace(/^-+|-+$/g, '');

  return normalized.slice(0, 96) || fallback;
}

export function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&#(\d+);/g, (match, code) => {
      const parsed = Number.parseInt(code, 10);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : match;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (match, code) => {
      const parsed = Number.parseInt(code, 16);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : match;
    })
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function replaceAnchors(html) {
  return html.replace(
    /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (_, __, href, text) => {
      const label = normalizeWhitespace(stripTags(text));
      return label ? `[${label}](${href})` : href;
    },
  );
}

function replaceImages(html) {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const attributes = parseHtmlTagAttributes(tag);
    const src =
      attributes['data-src'] ||
      attributes['data-actualsrc'] ||
      attributes['data-origin-src'] ||
      attributes['data-original'] ||
      attributes.src;

    if (!src) {
      return '';
    }

    const alt = attributes.alt || '';
    return `![${decodeHtmlEntities(alt)}](${src})`;
  });
}

function normalizeListItemContent(innerHtml) {
  const withBreaks = String(innerHtml ?? '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(
      /<\/?(p|div|section|article|header|footer|blockquote|figure|table|tr|tbody|thead|tfoot|main)\b[^>]*>/gi,
      '\n',
    )
    .replace(/<\/?(strong|b|em|i|u|span|small|sup|sub|code|pre)\b[^>]*>/gi, '');

  return normalizeWhitespace(decodeHtmlEntities(stripTags(withBreaks))).replace(/\n+/g, ' ');
}

function replaceListItems(html) {
  return html.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, innerHtml) => {
    const content = normalizeListItemContent(innerHtml);
    return content ? `\n- ${content}\n` : '\n';
  });
}

function replaceBlockTags(html) {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, inner) => {
      const content = normalizeWhitespace(stripTags(inner));
      return `\n${'#'.repeat(Number(level))} ${content}\n`;
    })
    .replace(
      /<\/?(p|div|section|article|header|footer|blockquote|figure|table|tr|tbody|thead|tfoot|ul|ol|hr|main)\b[^>]*>/gi,
      '\n',
    )
    .replace(/<\/?(strong|b|em|i|u|span|small|sup|sub|code|pre)\b[^>]*>/gi, '');
}

export function htmlToMarkdown(input) {
  if (!input) {
    return '';
  }

  let html = String(input);
  html = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '');
  html = replaceAnchors(html);
  html = replaceImages(html);
  html = replaceListItems(html);
  html = replaceBlockTags(html);
  html = stripTags(html);
  html = decodeHtmlEntities(html);
  html = html.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');

  return sanitizeContent(html);
}

export function sanitizeContent(value) {
  return stripWeChatChrome(normalizeWhitespace(decodeHtmlEntities(String(value ?? ''))));
}

function stripMarkdownSyntax(value) {
  return normalizeWhitespace(String(value ?? ''))
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]*]\((?:https?:\/\/|mailto:)[^)]+\)/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[`*_>#-]+/g, ' ');
}

function countChromeMarkerHits(content) {
  const lower = normalizeWhitespace(content).toLowerCase();
  return SAFE_CONTENT_CHROME_MARKERS.filter((marker) => lower.includes(marker)).length;
}

function mergeDanglingListMarkers(lines) {
  const merged = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const inlineBulletMatch = trimmed.match(/^[•·●]\s+(.*)$/);

    if (inlineBulletMatch) {
      merged.push(`- ${inlineBulletMatch[1]}`);
      continue;
    }

    if (!LIST_MARKER_LINE_PATTERN.test(trimmed)) {
      merged.push(line);
      continue;
    }

    let nextIndex = index + 1;
    while (nextIndex < lines.length && !lines[nextIndex].trim()) {
      nextIndex += 1;
    }

    const nextLine = lines[nextIndex] ?? '';
    const nextTrimmed = nextLine.trim();

    if (
      nextTrimmed &&
      !LIST_MARKER_LINE_PATTERN.test(nextTrimmed) &&
      !END_OF_ARTICLE_PATTERNS.some((pattern) => pattern.test(nextTrimmed))
    ) {
      merged.push(`- ${nextTrimmed}`);
      index = nextIndex;
      continue;
    }

    merged.push(line);
  }

  return merged;
}

function mergeDanglingListMarkersSafe(lines) {
  const merged = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const inlineBulletMatch = trimmed.match(SAFE_INLINE_LIST_MARKER_PATTERN);

    if (inlineBulletMatch) {
      merged.push(`- ${inlineBulletMatch[1]}`);
      continue;
    }

    if (!SAFE_LIST_MARKER_LINE_PATTERN.test(trimmed)) {
      merged.push(line);
      continue;
    }

    let nextIndex = index + 1;
    while (nextIndex < lines.length && !lines[nextIndex].trim()) {
      nextIndex += 1;
    }

    const nextTrimmed = (lines[nextIndex] ?? '').trim();
    if (
      nextTrimmed &&
      !SAFE_LIST_MARKER_LINE_PATTERN.test(nextTrimmed) &&
      !SAFE_END_OF_ARTICLE_PATTERNS.some((pattern) => pattern.test(nextTrimmed))
    ) {
      merged.push(`- ${nextTrimmed}`);
      index = nextIndex;
      continue;
    }

    merged.push(line);
  }

  return merged;
}

function trimTrailingUiBlock(lines) {
  let trimFrom = lines.length;
  let sawTailNoise = false;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const trimmed = lines[index].trim();

    if (!trimmed) {
      if (sawTailNoise) {
        trimFrom = index;
      }
      continue;
    }

    if (
      SAFE_DROP_EXACT_LINES.has(trimmed) ||
      SAFE_GLOBAL_DROP_LINE_PATTERNS.some((pattern) => pattern.test(trimmed)) ||
      SAFE_TAIL_DROP_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))
    ) {
      sawTailNoise = true;
      trimFrom = index;
      continue;
    }

    if (sawTailNoise && /^!\[[^\]]*]\([^)]+\)$/.test(trimmed)) {
      trimFrom = index;
      continue;
    }

    break;
  }

  return sawTailNoise ? lines.slice(0, trimFrom) : lines;
}

export function stripWeChatChrome(value) {
  const filteredLines = normalizeWhitespace(String(value ?? ''))
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return true;
      }

      if (SAFE_DROP_EXACT_LINES.has(trimmed)) {
        return false;
      }

      if (/^\[(cancel|allow|got it)\]\(javascript/i.test(trimmed)) {
        return false;
      }

      if (/^\[[^\]]*\]\(javascript:void\(0\);?\)$/i.test(trimmed)) {
        return false;
      }

      if (/^[,:，。.]+$/.test(trimmed)) {
        return false;
      }

      return true;
    });

  const mergedLines = mergeDanglingListMarkersSafe(filteredLines);
  const articleEndIndex = mergedLines.findIndex((line) =>
    SAFE_END_OF_ARTICLE_PATTERNS.some((pattern) => pattern.test(line.trim())),
  );
  const effectiveLines =
    articleEndIndex >= 0
      ? mergedLines.slice(0, articleEndIndex + 1)
      : trimTrailingUiBlock(mergedLines);
  const cleanedLines = [];

  for (const line of effectiveLines) {
    const trimmed = line.trim();

    if (!trimmed) {
      cleanedLines.push(line);
      continue;
    }

    if (SAFE_GLOBAL_DROP_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      continue;
    }

    cleanedLines.push(line);
  }

  return normalizeWhitespace(cleanedLines.join('\n'));
}

export function isContentUnavailable(value) {
  const normalized = normalizeWhitespace(String(value ?? '')).toLowerCase();
  return CONTENT_FAILURE_MARKERS.some((marker) => normalized.includes(marker));
}

function countParagraphLikeLines(content) {
  return normalizeWhitespace(content)
    .split('\n')
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length >= PARAGRAPH_MIN_LENGTH).length;
}

export function assessContentQuality({ title, content }) {
  const normalized = normalizeWhitespace(content);
  const normalizedTitle = normalizeWhitespace(title);
  const withoutTitle = normalizedTitle
    ? normalizeWhitespace(normalized.replace(new RegExp(escapeRegExp(normalizedTitle), 'g'), ''))
    : normalized;
  const lower = normalized.toLowerCase();
  const paragraphCount = countParagraphLikeLines(normalized);
  const plainTextSignal = stripMarkdownSyntax(withoutTitle);

  if (!normalized) {
    return { usable: false, reason: 'empty' };
  }

  if (isContentUnavailable(normalized)) {
    return { usable: false, reason: 'failure-marker' };
  }

  if (countChromeMarkerHits(normalized) >= 2) {
    return { usable: false, reason: 'wechat-chrome' };
  }

  if (withoutTitle.length < 40) {
    return { usable: false, reason: 'title-only' };
  }

  if (plainTextSignal.length < 80) {
    return { usable: false, reason: 'image-shell' };
  }

  if (normalized.length < FALLBACK_MIN_LENGTH) {
    return { usable: false, reason: 'too-short' };
  }

  if (/read original/i.test(lower) && normalized.length < FALLBACK_SHELL_LENGTH) {
    return { usable: false, reason: 'read-original-shell' };
  }

  if (normalized.length < FALLBACK_SHELL_LENGTH && paragraphCount < 2) {
    return { usable: false, reason: 'too-thin' };
  }

  return { usable: true, reason: 'ok' };
}

function quoteYamlString(value) {
  return JSON.stringify(String(value ?? ''));
}

function renderYamlValue(value) {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }

    return value.map((item) => `  - ${quoteYamlString(item)}`).join('\n');
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return quoteYamlString(value);
}

export function buildArchiveState() {
  return {
    version: 2,
    feeds: {},
    articles: {},
  };
}

export function buildFeedFolderName(feedTitle, feedId) {
  return `${slugifySegment(feedTitle || feedId)}-${shortHash(feedId, 6)}`;
}

export function getMonthBucket(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function getDateBucket(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatIsoTimestamp(date) {
  return date.toISOString();
}

export function parseTimestamp(value, fallback = new Date()) {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export function buildArticleFileName(title, articleId, publishedAt) {
  return `${getDateBucket(publishedAt)}-${slugifySegment(title, 'article')}-${shortHash(articleId, 8)}.md`;
}

export function buildArticlePaths(state, feed, article) {
  const feedState = state.feeds[feed.id] || {};
  const feedFolderName =
    feedState.folderName || buildFeedFolderName(feed.title || feed.id, feed.id);
  const publishedAt = parseTimestamp(article.date_published || article.date_modified);
  const monthBucket = getMonthBucket(publishedAt);
  const articleState = state.articles[article.id] || {};
  const fileName =
    articleState.fileName ||
    buildArticleFileName(article.title || article.id, article.id, publishedAt);
  const rawFileName = fileName.replace(/\.md$/i, '.json');

  return {
    feedFolderName,
    monthBucket,
    fileName,
    articlePath:
      articleState.articlePath || path.posix.join(feedFolderName, monthBucket, fileName),
    rawPath:
      articleState.rawPath ||
      path.posix.join(feedFolderName, monthBucket, '_raw', rawFileName),
  };
}

function findBalancedDivEnd(html, startIndex) {
  const tokenPattern = /<\/?div\b[^>]*>/gi;
  tokenPattern.lastIndex = startIndex;
  let depth = 1;
  let match = tokenPattern.exec(html);

  while (match) {
    const token = match[0];
    if (/^<div\b/i.test(token) && !/\/>$/.test(token)) {
      depth += 1;
    } else if (/^<\/div/i.test(token)) {
      depth -= 1;
      if (depth === 0) {
        return match.index;
      }
    }

    match = tokenPattern.exec(html);
  }

  return -1;
}

export function extractRichMediaContentHtml(html) {
  const openTagPattern = /<div\b[^>]*class=(["'])[^"'<>]*rich_media_content[^"'<>]*\1[^>]*>/gi;
  const match = openTagPattern.exec(String(html ?? ''));
  if (!match) {
    return '';
  }

  const start = match.index + match[0].length;
  const end = findBalancedDivEnd(html, start);
  if (end < 0) {
    return html.slice(start);
  }

  return html.slice(start, end);
}

export async function fetchText(url, timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)),
    timeoutMs,
  );

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'user-agent': WECHAT_USER_AGENT,
        ...headers,
      },
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status} for ${url}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)),
    timeoutMs,
  );

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json, text/plain, */*',
      },
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status} for ${url}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchOriginalPageContent(articleUrl, timeoutMs) {
  const html = await fetchText(articleUrl, timeoutMs, { referer: articleUrl });
  const richMediaHtml = extractRichMediaContentHtml(html);
  const sourceHtml = richMediaHtml || html;
  const content = htmlToMarkdown(sourceHtml) || sanitizeContent(sourceHtml);

  return {
    content,
    extractedHtml: sourceHtml,
    usedRichMediaContainer: Boolean(richMediaHtml),
  };
}

function isWeChatArticleUrl(value) {
  try {
    const url = new URL(String(value ?? ''));
    return /(^|\.)mp\.weixin\.qq\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

export async function resolveArticleContent(article, timeoutMs) {
  const feedCandidateRaw =
    article.content_html || article.content_text || article.content || article.summary || '';
  const feedCandidate =
    typeof feedCandidateRaw === 'string' && /<[^>]+>/.test(feedCandidateRaw)
      ? extractRichMediaContentHtml(feedCandidateRaw) || feedCandidateRaw
      : feedCandidateRaw;
  const feedContent = htmlToMarkdown(feedCandidate) || sanitizeContent(feedCandidate);
  const feedQuality = assessContentQuality({
    title: article.title || article.id,
    content: feedContent,
  });
  const preferOriginalPage = isWeChatArticleUrl(article.url);

  if (preferOriginalPage) {
    try {
      const fallback = await fetchOriginalPageContent(article.url, timeoutMs);
      const fallbackQuality = assessContentQuality({
        title: article.title || article.id,
        content: fallback.content,
      });

      if (fallbackQuality.usable && fallback.content && !isContentUnavailable(fallback.content)) {
        return {
          content: fallback.content,
          contentSource: 'original_page',
          contentFetchStatus: fallback.usedRichMediaContainer
            ? 'original_page_rich_media'
            : 'original_page_full_html',
          contentQualityReason: fallbackQuality.reason,
          contentStatus: 'available',
        };
      }
    } catch {
      // Fall through to feed-first fallback logic below.
    }
  }

  if (feedQuality.usable) {
    return {
      content: feedContent,
      contentSource: 'feed',
      contentFetchStatus: 'feed_ok',
      contentQualityReason: feedQuality.reason,
      contentStatus: 'available',
    };
  }

  if (!article.url) {
    return {
      content: '',
      contentSource: 'none',
      contentFetchStatus: 'no_article_url',
      contentQualityReason: feedQuality.reason,
      contentStatus: 'unavailable',
    };
  }

  try {
    const fallback = await fetchOriginalPageContent(article.url, timeoutMs);
    const fallbackQuality = assessContentQuality({
      title: article.title || article.id,
      content: fallback.content,
    });

    if (fallback.content && !isContentUnavailable(fallback.content)) {
      return {
        content: fallback.content,
        contentSource: 'original_page',
        contentFetchStatus: fallback.usedRichMediaContainer
          ? 'original_page_rich_media'
          : 'original_page_full_html',
        contentQualityReason: fallbackQuality.reason,
        contentStatus: 'available',
      };
    }

    return {
      content: '',
      contentSource: 'none',
      contentFetchStatus: 'original_page_empty',
      contentQualityReason: fallbackQuality.reason,
      contentStatus: 'unavailable',
    };
  } catch (error) {
    return {
      content: '',
      contentSource: 'none',
      contentFetchStatus: `original_page_failed:${error instanceof Error ? error.message : String(error)}`,
      contentQualityReason: feedQuality.reason,
      contentStatus: 'unavailable',
    };
  }
}

export function buildMarkdownDocument({
  feed,
  article,
  articlePath,
  rawPath,
  content,
  contentSource,
  contentFetchStatus,
  contentQualityReason,
  contentStatus,
  syncedAt,
}) {
  const publishedAt = parseTimestamp(article.date_published || article.date_modified);
  const contentText = normalizeWhitespace(content || '');
  const tags = [
    'wewe-rss',
    'canonical:wewe-rss-ai',
    `feed:${feed.id}`,
    feed.title ? `source:${slugifySegment(feed.title)}` : null,
    ...(Array.isArray(article.tags) ? article.tags : []),
  ].filter(Boolean);

  const frontmatter = [
    '---',
    `title: ${quoteYamlString(article.title || article.id)}`,
    `feed_id: ${quoteYamlString(feed.id)}`,
    `feed_title: ${quoteYamlString(feed.title || feed.id)}`,
    `article_id: ${quoteYamlString(article.id)}`,
    `source_url: ${quoteYamlString(article.url || '')}`,
    `link: ${quoteYamlString(article.url || '')}`,
    `publish_time: ${quoteYamlString(formatIsoTimestamp(publishedAt))}`,
    `synced_at: ${quoteYamlString(formatIsoTimestamp(syncedAt))}`,
    `content_source: ${quoteYamlString(contentSource)}`,
    `content_fetch_status: ${quoteYamlString(contentFetchStatus)}`,
    `content_quality_reason: ${quoteYamlString(contentQualityReason)}`,
    `content_status: ${quoteYamlString(contentStatus)}`,
    `article_path: ${quoteYamlString(articlePath)}`,
    `raw_path: ${quoteYamlString(rawPath)}`,
    `tags:\n${renderYamlValue(tags)}`,
    '---',
  ].join('\n');

  const body = [
    `# ${article.title || article.id}`,
    '',
    `- Source: ${feed.title || feed.id}`,
    `- Article ID: ${article.id}`,
    `- Published: ${formatIsoTimestamp(publishedAt)}`,
    `- Synced: ${formatIsoTimestamp(syncedAt)}`,
    `- Link: ${article.url || ''}`,
    `- Content source: ${contentSource}`,
    `- Content fetch status: ${contentFetchStatus}`,
    `- Content status: ${contentStatus}`,
    `- Raw: ${rawPath}`,
    '',
    '## Content',
    '',
    contentText || '_No content available yet._',
  ].join('\n');

  return `${frontmatter}\n\n${body}\n`;
}

export function buildRawPayload({
  feed,
  article,
  content,
  contentSource,
  contentFetchStatus,
  contentQualityReason,
  contentStatus,
  syncedAt,
}) {
  return {
    archived_at: formatIsoTimestamp(syncedAt),
    canonical_store: 'WeWe-RSS-AI',
    feed: {
      id: feed.id,
      title: feed.title || feed.id,
      home_page_url: feed.home_page_url || '',
      feed_url: feed.feed_url || '',
    },
    article: {
      id: article.id,
      title: article.title || '',
      url: article.url || '',
      date_published: article.date_published || '',
      date_modified: article.date_modified || '',
      image: article.image || '',
      content_status: contentStatus,
      content_source: contentSource,
      content_fetch_status: contentFetchStatus,
      content_quality_reason: contentQualityReason,
      content: content || '',
      tags: Array.isArray(article.tags) ? article.tags : [],
    },
    source_item: article,
  };
}

function toPortableRelativePath(rootDir, targetPath) {
  return path.relative(rootDir, targetPath).split(path.sep).join('/');
}

function deriveMarkdownPathFromRawPath(rootDir, rawPath) {
  const monthDir = path.dirname(path.dirname(rawPath));
  const markdownPath = path.join(monthDir, `${path.basename(rawPath, '.json')}.md`);
  return {
    markdownPath,
    articlePath: toPortableRelativePath(rootDir, markdownPath),
    rawPath: toPortableRelativePath(rootDir, rawPath),
  };
}

export async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return fallback;
    }

    throw error;
  }
}

export async function writeJsonFileAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fs.rename(tempPath, filePath);
}

export async function writeTextFileIfChanged(filePath, content, dryRun = false) {
  let current = null;
  try {
    current = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error;
    }
  }

  if (current === content) {
    return { written: false };
  }

  if (!dryRun) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
  }

  return { written: true };
}

export async function loadArchiveState(vaultPath, stateDir = DEFAULT_STATE_DIR) {
  const statePath = path.join(vaultPath, stateDir, 'state.json');
  const state = await readJsonFile(statePath, buildArchiveState());
  return { statePath, state };
}

export async function discoverFeedList(baseUrl, timeoutMs) {
  const url = new URL('/feeds/', baseUrl).toString();
  const result = await fetchJson(url, timeoutMs);
  if (!Array.isArray(result)) {
    throw new Error(`Unexpected feeds list response from ${url}`);
  }

  return result
    .filter((item) => item && typeof item.id === 'string')
    .map((item) => ({
      id: item.id,
      title: item.name || item.id,
      home_page_url: '',
      feed_url: new URL(`/feeds/${item.id}.json`, baseUrl).toString(),
    }));
}

export async function loadFeedDocument(feedUrl, timeoutMs) {
  const document = await fetchJson(feedUrl, timeoutMs);
  if (!document || !Array.isArray(document.items)) {
    throw new Error(`Unexpected feed response from ${feedUrl}`);
  }

  return document;
}

export function normalizeFeedDocument(document, fallbackFeedUrl) {
  return {
    title: document.title || fallbackFeedUrl,
    home_page_url: document.home_page_url || '',
    feed_url: document.feed_url || fallbackFeedUrl,
    description: document.description || '',
    icon: document.icon || '',
    items: Array.isArray(document.items) ? document.items : [],
  };
}

export async function syncArchive({
  baseUrl = defaultArchiveOptions.baseUrl,
  feedUrls = defaultArchiveOptions.feedUrls,
  discoverFeeds = defaultArchiveOptions.discoverFeeds,
  includeAllFeed = defaultArchiveOptions.includeAllFeed,
  limit = defaultArchiveOptions.limit,
  mode = defaultArchiveOptions.mode,
  stateDir = defaultArchiveOptions.stateDir,
  timeoutMs = defaultArchiveOptions.timeoutMs,
  vaultPath,
  dryRun = defaultArchiveOptions.dryRun,
}) {
  if (!vaultPath) {
    throw new Error('vaultPath is required');
  }

  const rootDir = path.resolve(vaultPath);
  const { statePath, state } = await loadArchiveState(rootDir, stateDir);
  const now = new Date();

  let feeds = [];
  if (feedUrls.length > 0) {
    feeds = feedUrls.map((url) => ({
      id: url,
      title: url,
      home_page_url: '',
      feed_url: url,
    }));
  } else if (discoverFeeds) {
    feeds = await discoverFeedList(baseUrl, timeoutMs);
  }

  if (includeAllFeed) {
    feeds = [
      ...feeds,
      {
        id: 'all',
        title: 'WeWe-RSS All',
        home_page_url: baseUrl,
        feed_url: new URL('/feeds/all.json', baseUrl).toString(),
      },
    ];
  }

  const seenArticles = new Set();
  const feedSummaries = [];
  let totalWritten = 0;
  let totalSkipped = 0;
  let totalFeeds = 0;

  for (const feedRef of feeds) {
    totalFeeds += 1;
    const pageItems = [];
    let page = 1;
    let feedDocument = null;

    while (true) {
      const url = new URL(feedRef.feed_url);
      if (!url.searchParams.has('mode') && mode) {
        url.searchParams.set('mode', mode);
      }
      if (!url.searchParams.has('limit')) {
        url.searchParams.set('limit', String(limit));
      }
      url.searchParams.set('page', String(page));

      const document = normalizeFeedDocument(
        await loadFeedDocument(url.toString(), timeoutMs),
        url.toString(),
      );

      feedDocument = feedDocument || document;
      const items = document.items || [];
      if (items.length === 0) {
        break;
      }

      pageItems.push(...items);
      if (items.length < limit) {
        break;
      }

      page += 1;
    }

    const feed = {
      id: feedRef.id,
      title: feedDocument?.title || feedRef.title || feedRef.id,
      home_page_url: feedDocument?.home_page_url || feedRef.home_page_url || '',
      feed_url: feedDocument?.feed_url || feedRef.feed_url,
    };

    const uniqueItems = pageItems.filter((item) => item && item.id && !seenArticles.has(item.id));
    const feedState = state.feeds[feed.id] || {};
    const feedFolderName =
      feedState.folderName || buildFeedFolderName(feed.title || feed.id, feed.id);
    state.feeds[feed.id] = {
      ...feedState,
      folderName: feedFolderName,
      title: feed.title,
      updatedAt: formatIsoTimestamp(now),
    };

    let feedWritten = 0;
    let feedSkipped = 0;

    for (const item of uniqueItems) {
      seenArticles.add(item.id);
      const articleState = state.articles[item.id] || {};
      const publishedAt = parseTimestamp(item.date_published || item.date_modified, now);
      const articlePaths = buildArticlePaths(state, feed, item);
      const resolvedContent = await resolveArticleContent(item, timeoutMs);
      const markdown = buildMarkdownDocument({
        feed,
        article: item,
        articlePath: articlePaths.articlePath,
        rawPath: articlePaths.rawPath,
        content: resolvedContent.content,
        contentSource: resolvedContent.contentSource,
        contentFetchStatus: resolvedContent.contentFetchStatus,
        contentQualityReason: resolvedContent.contentQualityReason,
        contentStatus: resolvedContent.contentStatus,
        syncedAt: now,
      });
      const rawPayload = buildRawPayload({
        feed,
        article: item,
        content: resolvedContent.content,
        contentSource: resolvedContent.contentSource,
        contentFetchStatus: resolvedContent.contentFetchStatus,
        contentQualityReason: resolvedContent.contentQualityReason,
        contentStatus: resolvedContent.contentStatus,
        syncedAt: now,
      });
      const rawJson = JSON.stringify(rawPayload, null, 2) + '\n';

      const markdownPath = path.join(rootDir, articlePaths.articlePath);
      const rawPath = path.join(rootDir, articlePaths.rawPath);
      const markdownResult = await writeTextFileIfChanged(markdownPath, markdown, dryRun);
      const rawResult = await writeTextFileIfChanged(rawPath, rawJson, dryRun);
      const wroteAny = markdownResult.written || rawResult.written;

      if (wroteAny) {
        feedWritten += 1;
        totalWritten += 1;
      } else {
        feedSkipped += 1;
        totalSkipped += 1;
      }

      state.articles[item.id] = {
        ...articleState,
        feedId: feed.id,
        title: item.title || item.id,
        fileName: articlePaths.fileName,
        articlePath: articlePaths.articlePath,
        rawPath: articlePaths.rawPath,
        publishedAt: formatIsoTimestamp(publishedAt),
        syncedAt: formatIsoTimestamp(now),
        contentSource: resolvedContent.contentSource,
        contentFetchStatus: resolvedContent.contentFetchStatus,
        contentQualityReason: resolvedContent.contentQualityReason,
        contentStatus: resolvedContent.contentStatus,
        contentHash: shortHash(resolvedContent.content || ''),
        updatedAt: formatIsoTimestamp(now),
      };
    }

    feedSummaries.push({
      id: feed.id,
      title: feed.title,
      items: uniqueItems.length,
      written: feedWritten,
      skipped: feedSkipped,
      folderName: feedFolderName,
    });
  }

  state.version = 2;
  state.updatedAt = formatIsoTimestamp(now);

  if (!dryRun) {
    await writeJsonFileAtomic(statePath, state);
  }

  return {
    statePath,
    feeds: feedSummaries,
    totalFeeds,
    totalWritten,
    totalSkipped,
    archivedAt: formatIsoTimestamp(now),
  };
}

export async function repairArchive({
  vaultPath,
  stateDir = defaultArchiveOptions.stateDir,
  timeoutMs = defaultArchiveOptions.timeoutMs,
  dryRun = defaultArchiveOptions.dryRun,
  onlyFeedSourced = true,
}) {
  if (!vaultPath) {
    throw new Error('vaultPath is required');
  }

  const rootDir = path.resolve(vaultPath);
  const { statePath, state } = await loadArchiveState(rootDir, stateDir);
  const now = new Date();
  const candidates = Object.entries(state.articles || {})
    .filter(([, articleState]) => articleState && articleState.rawPath)
    .filter(([, articleState]) => !onlyFeedSourced || articleState.contentSource === 'feed')
    .map(([articleId, articleState]) => ({ articleId, articleState }));

  let totalCandidates = 0;
  let totalWritten = 0;
  let totalSkipped = 0;
  let totalRepaired = 0;

  for (const { articleId, articleState } of candidates) {
    totalCandidates += 1;
    const rawPath = path.join(rootDir, articleState.rawPath);
    const rawPayload = await readJsonFile(rawPath, null);

    if (!rawPayload || typeof rawPayload !== 'object') {
      totalSkipped += 1;
      continue;
    }

    if (onlyFeedSourced && rawPayload.article?.content_source !== 'feed') {
      totalSkipped += 1;
      continue;
    }

    const sourceItem = rawPayload.source_item || rawPayload.article;
    const feed = rawPayload.feed || {
      id: articleState.feedId || 'unknown',
      title: articleState.feedId || 'unknown',
      home_page_url: '',
      feed_url: '',
    };

    if (!sourceItem || typeof sourceItem !== 'object') {
      totalSkipped += 1;
      continue;
    }

    const resolvedContent = await resolveArticleContent(sourceItem, timeoutMs);
    const existingSource = rawPayload.article?.content_source || articleState.contentSource || 'none';
    const existingStatus =
      rawPayload.article?.content_fetch_status || articleState.contentFetchStatus || 'unknown';
    const existingQuality =
      rawPayload.article?.content_quality_reason || articleState.contentQualityReason || 'unknown';
    const existingContent = rawPayload.article?.content || '';

    const metadataPaths =
      articleState.articlePath && articleState.rawPath
        ? {
            articlePath: articleState.articlePath,
            rawPath: articleState.rawPath,
            markdownPath: path.join(rootDir, articleState.articlePath),
          }
        : deriveMarkdownPathFromRawPath(rootDir, rawPath);

    const markdown = buildMarkdownDocument({
      feed,
      article: sourceItem,
      articlePath: metadataPaths.articlePath,
      rawPath: metadataPaths.rawPath,
      content: resolvedContent.content,
      contentSource: resolvedContent.contentSource,
      contentFetchStatus: resolvedContent.contentFetchStatus,
      contentQualityReason: resolvedContent.contentQualityReason,
      contentStatus: resolvedContent.contentStatus,
      syncedAt: now,
    });
    const nextRawPayload = buildRawPayload({
      feed,
      article: sourceItem,
      content: resolvedContent.content,
      contentSource: resolvedContent.contentSource,
      contentFetchStatus: resolvedContent.contentFetchStatus,
      contentQualityReason: resolvedContent.contentQualityReason,
      contentStatus: resolvedContent.contentStatus,
      syncedAt: now,
    });
    const rawJson = JSON.stringify(nextRawPayload, null, 2) + '\n';

    const markdownResult = await writeTextFileIfChanged(
      metadataPaths.markdownPath,
      markdown,
      dryRun,
    );
    const rawResult = await writeTextFileIfChanged(rawPath, rawJson, dryRun);
    const wroteAny = markdownResult.written || rawResult.written;

    if (wroteAny) {
      totalWritten += 1;
    } else {
      totalSkipped += 1;
    }

    if (
      existingSource !== resolvedContent.contentSource ||
      existingStatus !== resolvedContent.contentFetchStatus ||
      existingQuality !== resolvedContent.contentQualityReason ||
      existingContent !== resolvedContent.content
    ) {
      totalRepaired += 1;
    }

    state.articles[articleId] = {
      ...articleState,
      feedId: feed.id,
      title: sourceItem.title || articleId,
      fileName: path.basename(metadataPaths.articlePath),
      articlePath: metadataPaths.articlePath,
      rawPath: metadataPaths.rawPath,
      publishedAt: formatIsoTimestamp(
        parseTimestamp(sourceItem.date_published || sourceItem.date_modified, now),
      ),
      syncedAt: formatIsoTimestamp(now),
      contentSource: resolvedContent.contentSource,
      contentFetchStatus: resolvedContent.contentFetchStatus,
      contentQualityReason: resolvedContent.contentQualityReason,
      contentStatus: resolvedContent.contentStatus,
      contentHash: shortHash(resolvedContent.content || ''),
      updatedAt: formatIsoTimestamp(now),
    };
  }

  state.version = 2;
  state.updatedAt = formatIsoTimestamp(now);

  if (!dryRun) {
    await writeJsonFileAtomic(statePath, state);
  }

  return {
    statePath,
    totalCandidates,
    totalWritten,
    totalSkipped,
    totalRepaired,
    repairedAt: formatIsoTimestamp(now),
  };
}
