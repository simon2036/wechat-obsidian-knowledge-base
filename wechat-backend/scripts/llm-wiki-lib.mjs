import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import {
  extractRichMediaContentHtml,
  formatIsoTimestamp,
  getMonthBucket,
  parseTimestamp,
  readJsonFile,
  shortHash,
  slugifySegment,
} from './obsidian-archive-lib.mjs';

const RESERVED_SOURCE_DIRS = new Set(['Hub', 'Wikis', 'Notes']);
const DEFAULT_CONTENT_ROOT = 'WeWe-RSS-AI';
const DEFAULT_HUB_DIR = 'Hub';
const DEFAULT_WIKIS_DIR = 'Wikis';
const DEFAULT_STATE_DIR = '.llm-wiki';
const STATE_VERSION = 1;
const REGISTRY_VERSION = 1;
const DEFAULT_PROVIDER_TIMEOUT_MS = 120_000;
const DEFAULT_MODEL_MAX_CHARS = 18_000;
const DEFAULT_SIGNAL_LINE_MIN_LENGTH = 12;
const DEFAULT_PDF_SYNC_INITIAL_LOOKBACK_DAYS = 30;
const DEFAULT_GLM_MANUAL_BASE_URL = 'https://open.bigmodel.cn/api/coding/paas/v4';
const DEFAULT_GLM_MANUAL_PRIMARY_MODEL = 'glm-5';
const DEFAULT_GLM_MANUAL_FALLBACK_MODELS = ['glm-4.7', 'glm-4.6'];
const DEFAULT_GLM_MANUAL_FALLBACK_RATE = 0.1;
const DEFAULT_GLM5_OFF_PEAK_MULTIPLIER = 2;
const DEFAULT_GLM5_PEAK_MULTIPLIER = 3;
const DEFAULT_GLM_FALLBACK_MULTIPLIER = 1;
const GLM_CAPABILITIES_CACHE_NAME = 'glm-capabilities.json';
const GLM_MANUAL_MODEL_ALIAS_MAP = {
  'glm-5': ['glm-5.1'],
};
const MODEL_FALLBACK_ERROR_CODES = new Set([
  'provider_timeout',
  'provider_network_error',
  'provider_model_unavailable',
  'provider_empty_content',
  'provider_invalid_json',
]);
const TERMINAL_PROVIDER_ERROR_CODES = new Set([
  'provider_missing_credentials',
  'provider_auth_invalid',
  'provider_quota_exhausted',
  'provider_permission_denied',
  'provider_account_rejected',
]);
const GLM_PROBE_MODEL_CANDIDATES = ['glm-5', 'glm-5.1', 'glm-4.7', 'glm-4.6'];
const REPO_HOST_PATTERNS = [
  /(^|\.)github\.com$/i,
  /(^|\.)huggingface\.co$/i,
  /(^|\.)gitlab\.com$/i,
  /(^|\.)bitbucket\.org$/i,
];
const PAPER_HOST_PATTERNS = [
  /(^|\.)arxiv\.org$/i,
  /(^|\.)biorxiv\.org$/i,
  /(^|\.)medrxiv\.org$/i,
  /(^|\.)nature\.com$/i,
  /(^|\.)science\.org$/i,
  /(^|\.)cell\.com$/i,
  /(^|\.)doi\.org$/i,
  /(^|\.)biomedcentral\.com$/i,
  /(^|\.)acs\.org$/i,
  /(^|\.)springer\.com$/i,
  /(^|\.)sciencedirect\.com$/i,
  /(^|\.)wiley\.com$/i,
  /(^|\.)jamanetwork\.com$/i,
  /(^|\.)thelancet\.com$/i,
  /(^|\.)nejm\.org$/i,
];
const ARTICLE_TYPE_VALUES = new Set([
  'five_work_digest',
  'single_project_article',
  'interview_or_opinion',
]);

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function dedupe(values) {
  const seen = new Set();
  const result = [];

  for (const value of values || []) {
    const normalized = String(value ?? '').trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function clipText(value, maxLength = 240) {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function toPositiveInteger(value, fallbackValue) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallbackValue;
  }

  return Math.floor(numeric);
}

function portablePath(value) {
  return String(value ?? '').split(path.sep).join('/');
}

function getErrorMessage(error) {
  return normalizeWhitespace(error instanceof Error ? error.message : String(error));
}

function createProviderError(code, message, extra = {}) {
  const error = new Error(message);
  error.wikiProviderCode = code;
  Object.assign(error, extra);
  return error;
}

function getProviderErrorCode(error) {
  return String(error?.wikiProviderCode || '').trim();
}

function isModelFallbackError(error) {
  return MODEL_FALLBACK_ERROR_CODES.has(getProviderErrorCode(error));
}

function isTerminalProviderError(error) {
  return TERMINAL_PROVIDER_ERROR_CODES.has(getProviderErrorCode(error));
}

function resolveProviderField(providerConfig, fieldName) {
  const envFieldName = `${fieldName}_env`;
  const envKey = String(providerConfig?.[envFieldName] || '').trim();
  if (envKey && process.env[envKey]) {
    return String(process.env[envKey]).trim();
  }

  const directValue = providerConfig?.[fieldName];
  return directValue === undefined || directValue === null ? '' : String(directValue).trim();
}

function buildOpenAiCompatibleEndpoint(baseUrl) {
  const normalizedBaseUrl = String(baseUrl || '').trim();
  if (!normalizedBaseUrl) {
    return '';
  }

  return /\/chat\/completions$/i.test(normalizedBaseUrl)
    ? normalizedBaseUrl
    : `${normalizedBaseUrl.replace(/\/$/, '')}/chat/completions`;
}

function parseDotEnvLine(rawLine) {
  const line = String(rawLine ?? '').trim();
  if (!line || line.startsWith('#')) {
    return null;
  }

  const separatorIndex = line.indexOf('=');
  if (separatorIndex <= 0) {
    return null;
  }

  const key = line.slice(0, separatorIndex).trim();
  if (!key) {
    return null;
  }

  let value = line.slice(separatorIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

async function loadDotEnvLocal(repoRoot) {
  const envPath = path.join(repoRoot, '.env.local');
  if (!(await pathExists(envPath))) {
    return { envPath, loaded: false, loadedKeys: [] };
  }

  const content = await fs.readFile(envPath, 'utf8');
  const loadedKeys = [];
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseDotEnvLine(line);
    if (!parsed) {
      continue;
    }

    if (process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
      loadedKeys.push(parsed.key);
    }
  }

  return { envPath, loaded: true, loadedKeys };
}

function isInteractiveTerminal(cliArgs = {}) {
  if (cliArgs.allowNonInteractive || process.env.LLM_WIKI_ALLOW_NON_INTERACTIVE === '1') {
    return true;
  }

  return Boolean(process.stdin?.isTTY && process.stdout?.isTTY);
}

function isPdfMimeType(contentType) {
  return String(contentType || '')
    .toLowerCase()
    .includes('application/pdf');
}

function isProbablyPdfUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    const pathname = parsed.pathname.toLowerCase();
    return (
      pathname.endsWith('.pdf') ||
      parsed.searchParams.get('pdf') === 'true' ||
      parsed.searchParams.get('format') === 'pdf' ||
      parsed.searchParams.get('download') === 'pdf'
    );
  } catch {
    return false;
  }
}

function deriveKnownPdfUrls(url) {
  const result = [];

  try {
    const parsed = new URL(String(url || ''));
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.replace(/\/+$/g, '');
    const doiMatch = pathname.match(/^\/doi\/(?:(?:abs|full|epdf|pdf)\/)?(.+)$/i);

    if (isProbablyPdfUrl(parsed.href)) {
      result.push(parsed.href);
    }

    if (hostname === 'arxiv.org' && pathname.startsWith('/abs/')) {
      result.push(`https://arxiv.org/pdf/${pathname.slice('/abs/'.length)}.pdf`);
    }

    if ((hostname === 'biorxiv.org' || hostname === 'www.biorxiv.org') && pathname.startsWith('/content/')) {
      result.push(`${parsed.origin}${pathname}.full.pdf`);
    }

    if ((hostname === 'medrxiv.org' || hostname === 'www.medrxiv.org') && pathname.startsWith('/content/')) {
      result.push(`${parsed.origin}${pathname}.full.pdf`);
    }

    if (/^(.+\.)?pubs\.acs\.org$/i.test(hostname) && doiMatch?.[1]) {
      result.push(`${parsed.origin}/doi/pdf/${doiMatch[1]}`);
      result.push(`${parsed.origin}/doi/epdf/${doiMatch[1]}`);
    }

    if (/^(.+\.)?science\.org$/i.test(hostname) && doiMatch?.[1]) {
      result.push(`${parsed.origin}/doi/pdf/${doiMatch[1]}`);
      result.push(`${parsed.origin}/doi/epdf/${doiMatch[1]}`);
    }

    if (/^(.+\.)?nature\.com$/i.test(hostname) && pathname.startsWith('/articles/')) {
      result.push(`${parsed.origin}${pathname}.pdf`);
    }

    if (/^(.+\.)?link\.springer\.com$/i.test(hostname) && pathname.startsWith('/article/')) {
      const doiPath = pathname.slice('/article/'.length);
      result.push(`${parsed.origin}/content/pdf/${encodeURIComponent(doiPath)}.pdf`);
    }

    if (/^(.+\.)?sciencedirect\.com$/i.test(hostname) && pathname.startsWith('/science/article/pii/')) {
      result.push(`${parsed.origin}${pathname}/pdf`);
    }

    if (/^(.+\.)?onlinelibrary\.wiley\.com$/i.test(hostname) && doiMatch?.[1]) {
      result.push(`${parsed.origin}/doi/pdf/${doiMatch[1]}`);
      result.push(`${parsed.origin}/doi/epdf/${doiMatch[1]}`);
    }

    if (/^(.+\.)?cell\.com$/i.test(hostname)) {
      if (/\/fulltext$/i.test(pathname)) {
        result.push(`${parsed.origin}${pathname.replace(/\/fulltext$/i, '/pdf')}`);
      }
      const piiMatch = pathname.match(/\/article\/([^/]+)\/?/i);
      if (piiMatch?.[1]) {
        result.push(`${parsed.origin}/action/showPdf?pii=${encodeURIComponent(piiMatch[1])}`);
      }
    }
  } catch {
    return result;
  }

  return dedupe(result);
}

function normalizeComparableUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/g, '');
    return parsed.toString();
  } catch {
    return String(url || '').trim();
  }
}

function buildPreferredPdfHosts(feedSettings = {}) {
  const preferredHosts = new Set();

  for (const host of Array.isArray(feedSettings?.pdf_preferred_hosts) ? feedSettings.pdf_preferred_hosts : []) {
    const normalized = String(host || '').trim().toLowerCase();
    if (normalized) {
      preferredHosts.add(normalized);
    }
  }

  try {
    const loginUrl = String(feedSettings?.pdf_login_url || '').trim();
    if (loginUrl) {
      preferredHosts.add(new URL(loginUrl).hostname.toLowerCase());
    }
  } catch {
    // ignore invalid login urls
  }

  return preferredHosts;
}

function scorePdfSourcePriority(url, feedSettings = {}) {
  const normalizedUrl = normalizeComparableUrl(url);
  const loginUrl = normalizeComparableUrl(feedSettings?.pdf_login_url || '');
  const preferredHosts = buildPreferredPdfHosts(feedSettings);
  let score = 0;

  try {
    const parsed = new URL(normalizedUrl);
    const hostname = parsed.hostname.toLowerCase();

    if (loginUrl && normalizedUrl === loginUrl) {
      score += 1_000;
    }

    if (preferredHosts.has(hostname)) {
      score += 300;
    }

    if (/\/doi\/(?:pdf|epdf)\//i.test(parsed.pathname)) {
      score += 80;
    }

    if (isProbablyPdfUrl(normalizedUrl)) {
      score += 20;
    }

    if (/^(.+\.)?(arxiv|biorxiv|medrxiv)\.org$/i.test(hostname) || /^(.+\.)?chemrxiv\.org$/i.test(hostname)) {
      score -= 40;
    }
  } catch {
    return score;
  }

  return score;
}

function sortPdfCandidates(urls, feedSettings = {}) {
  return dedupe(urls)
    .map((url, index) => ({
      url,
      index,
      score: scorePdfSourcePriority(url, feedSettings),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.url);
}

function stripPdfWarnings(warnings) {
  return dedupe((warnings || []).filter((item) => {
    const text = String(item || '').toLowerCase();
    if (!text) {
      return false;
    }

    return !(
      text.includes('pdf') ||
      text.includes('playwright') ||
      text.includes('browser launch failed') ||
      text.includes('downloadable pdf') ||
      text.includes('source url')
    );
  }));
}

function isPdfToolEnabled(feedSettings = {}) {
  return Boolean(feedSettings.pdf_enabled);
}

function isPdfAutoSyncEnabled(feedSettings = {}) {
  return Boolean(feedSettings.pdf_enabled && feedSettings.pdf_auto_sync_enabled);
}

function getPdfAutoSyncInitialLookbackDays(feedSettings = {}) {
  return toPositiveInteger(
    feedSettings.pdf_auto_sync_initial_lookback_days,
    DEFAULT_PDF_SYNC_INITIAL_LOOKBACK_DAYS,
  );
}

function scorePdfLinkCandidate(href, text) {
  const haystack = `${href || ''} ${text || ''}`.toLowerCase();
  let score = 0;

  if (isProbablyPdfUrl(href)) {
    score += 8;
  }

  if (/\bpdf\b/.test(haystack)) {
    score += 4;
  }

  if (/download|full[\s-]*text|全文|下载/.test(haystack)) {
    score += 3;
  }

  if (/supplement|appendix|poster|slides|ppt/.test(haystack)) {
    score -= 4;
  }

  return score;
}

function buildPdfProfilePaths(env, feedSlug, feedSettings, overrides = {}) {
  const configuredUserDataDir = String(
    overrides.userDataDir || feedSettings.pdf_user_data_dir || ''
  ).trim();
  const profileDirectory = String(
    overrides.profileDirectory || feedSettings.pdf_profile_directory || ''
  ).trim();
  const profileName =
    slugifySegment(String(overrides.profileName || feedSettings.pdf_profile_name || feedSlug || 'default')) ||
    'default';
  const cacheRoot = path.join(env.stateRoot, 'cache', 'pdf-profiles');
  const userDataDir = configuredUserDataDir
    ? path.resolve(configuredUserDataDir)
    : path.join(cacheRoot, profileName);

  return {
    profileName,
    profileDirectory,
    userDataDir,
    storageStatePath: path.join(userDataDir, 'storage-state.json'),
  };
}

async function openPdfBrowserSession(env, feedSlug, feedSettings, options = {}) {
  let playwrightModule;
  try {
    playwrightModule = await import('playwright');
  } catch {
    return {
      ok: false,
      status: 'dependency_missing',
      warning: 'playwright package is not installed',
    };
  }

  const { chromium } = playwrightModule;
  const channel = String(options.channel || feedSettings.pdf_browser_channel || '').trim();
  const profilePaths = buildPdfProfilePaths(env, feedSlug, feedSettings, options);
  const shouldUsePersistent =
    Boolean(options.forcePersistent) ||
    String(feedSettings.pdf_auth_strategy || '').trim() === 'persistent_profile' ||
    (await pathExists(profilePaths.userDataDir));

  try {
    if (shouldUsePersistent) {
      await ensureDirectory(profilePaths.userDataDir, env.dryRun);
      const launchArgs = [];
      if (profilePaths.profileDirectory) {
        launchArgs.push(`--profile-directory=${profilePaths.profileDirectory}`);
      }
      const context = await chromium.launchPersistentContext(profilePaths.userDataDir, {
        headless: options.headless !== false,
        acceptDownloads: true,
        channel: channel && channel !== 'chromium' ? channel : undefined,
        args: launchArgs,
      });

      return {
        ok: true,
        context,
        profilePaths,
        persistent: true,
        async close() {
          await context.close().catch(() => {});
        },
      };
    }

    const browser = await chromium.launch({
      headless: options.headless !== false,
      channel: channel && channel !== 'chromium' ? channel : undefined,
    });
    const context = await browser.newContext({ acceptDownloads: true });

    return {
      ok: true,
      context,
      profilePaths,
      persistent: false,
      async close() {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: 'dependency_missing',
      warning: `playwright browser launch failed: ${clipText(getErrorMessage(error), 240)}`,
    };
  }
}

function collectPdfCandidates(article, rawPayload, analysis, feedSettings = {}) {
  const directUrls = [];
  const pageUrls = [];
  const rawSources = [
    article.sourceUrl,
    article.fallbackContent,
    rawPayload?.article?.content,
    rawPayload?.source_item?.content_html,
    ...(Array.isArray(analysis?.paper_urls) ? analysis.paper_urls : []),
  ];

  for (const source of rawSources) {
    for (const url of extractUrls(source)) {
      directUrls.push(...deriveKnownPdfUrls(url));
      pageUrls.push(url);
      if (isProbablyPdfUrl(url)) {
        directUrls.push(url);
      }
    }
  }

  if (article.sourceUrl) {
    pageUrls.unshift(article.sourceUrl);
  }

  return {
    directUrls: sortPdfCandidates(directUrls, feedSettings),
    pageUrls: sortPdfCandidates(
      pageUrls.filter((url) => {
        try {
          const hostname = new URL(url).hostname.toLowerCase();
          return !REPO_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
        } catch {
          return false;
        }
      }),
      feedSettings
    ),
  };
}

async function writePdfBuffer(pdfPath, buffer) {
  await ensureDirectory(path.dirname(pdfPath));
  await fs.writeFile(pdfPath, buffer);
}

async function tryDownloadPdfBuffer(page, url, pdfPath, referer = '') {
  try {
    const cookies = await page.context().cookies(url);
    const headers = {
      Accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8',
    };
    if (cookies.length > 0) {
      headers.Cookie = cookies.map((item) => `${item.name}=${item.value}`).join('; ');
    }
    if (referer) {
      headers.Referer = referer;
    }

    let userAgent = '';
    try {
      userAgent = await page.evaluate(() => navigator.userAgent);
    } catch {
      userAgent = '';
    }
    if (userAgent) {
      headers['User-Agent'] = userAgent;
    }

    const response = await fetch(url, {
      headers,
      redirect: 'follow',
    });

    if (!response.ok) {
      return { success: false, reason: `http ${response.status}` };
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!isPdfMimeType(contentType) && !isProbablyPdfUrl(response.url || url)) {
      return { success: false, reason: `unexpected content type: ${contentType || 'unknown'}` };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      return { success: false, reason: 'empty pdf response' };
    }

    await writePdfBuffer(pdfPath, buffer);
    return {
      success: true,
      sourceUrl: response.url || url,
      method: 'download',
    };
  } catch (error) {
    return {
      success: false,
      reason: clipText(getErrorMessage(error), 240),
    };
  }
}

async function extractPdfLinksFromPage(page) {
  try {
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href], area[href]')).map((node) => ({
        href: String(node.href || ''),
        text: String(node.textContent || '').trim(),
      }))
    );

    return links
      .map((item) => ({
        href: item.href,
        score: scorePdfLinkCandidate(item.href, item.text),
      }))
      .filter((item) => item.href && item.score > 0)
      .sort((left, right) => right.score - left.score)
      .map((item) => item.href);
  } catch {
    return [];
  }
}

async function tryClickPdfDownload(page, pdfPath) {
  const currentUrl = page.url();
  let hostname = '';
  try {
    hostname = new URL(currentUrl).hostname.toLowerCase();
  } catch {
    hostname = '';
  }

  const selectorCandidates = [
    'a[href$=".pdf"]',
    'a[download]',
    'button[download]',
  ];

  if (/^(.+\.)?pubs\.acs\.org$/i.test(hostname)) {
    selectorCandidates.push('a.article_header__pdf');
    selectorCandidates.push('a[href*="/doi/pdf/"]');
  }
  if (/^(.+\.)?nature\.com$/i.test(hostname)) {
    selectorCandidates.push('a.c-pdf-download__link');
    selectorCandidates.push('a[data-track-action*="pdf"]');
  }
  if (/^(.+\.)?science\.org$/i.test(hostname)) {
    selectorCandidates.push('a.article__pdfLink');
    selectorCandidates.push('a[href*="/doi/pdf/"]');
  }
  if (/^(.+\.)?link\.springer\.com$/i.test(hostname)) {
    selectorCandidates.push('a.c-pdf-download__link');
    selectorCandidates.push('a[data-test="pdf-link"]');
  }
  if (/^(.+\.)?sciencedirect\.com$/i.test(hostname)) {
    selectorCandidates.push('a.pdf-download-btn-link');
    selectorCandidates.push('a[data-aa-name="download-pdf"]');
  }
  if (/^(.+\.)?onlinelibrary\.wiley\.com$/i.test(hostname)) {
    selectorCandidates.push('a.pdf-download');
    selectorCandidates.push('a[href*="/doi/pdf/"]');
  }
  if (/^(.+\.)?cell\.com$/i.test(hostname)) {
    selectorCandidates.push('a.article-tools__item__pdf');
    selectorCandidates.push('a[href*="/pdf"]');
  }

  const locators = [
    ...selectorCandidates.map((selector) => page.locator(selector)),
    page.getByRole('link', { name: /pdf|download|full text|全文|下载/i }),
    page.getByRole('button', { name: /pdf|download|full text|全文|下载/i }),
  ];

  for (const locator of locators) {
    try {
      if ((await locator.count()) === 0) {
        continue;
      }

      const downloadPromise = page.waitForEvent('download', { timeout: 5_000 });
      await locator.first().click({ timeout: 5_000 });
      const download = await downloadPromise;
      await ensureDirectory(path.dirname(pdfPath));
      await download.saveAs(pdfPath);
      return {
        success: true,
        sourceUrl: download.url(),
        method: 'download',
      };
    } catch {
      continue;
    }
  }

  return { success: false, reason: 'no clickable download target' };
}

async function tryDownloadPdfBeforePrint(page, article, analysis, rawPayload, pdfPath, feedSettings = {}) {
  const candidates = collectPdfCandidates(article, rawPayload, analysis, feedSettings);

  for (const url of candidates.directUrls) {
    const result = await tryDownloadPdfBuffer(page, url, pdfPath);
    if (result.success) {
      return result;
    }
  }

  for (const pageUrl of candidates.pageUrls) {
    try {
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    } catch {
      continue;
    }

    const pageLinks = sortPdfCandidates([
      ...deriveKnownPdfUrls(pageUrl),
      ...deriveKnownPdfUrls(page.url()),
      ...(await extractPdfLinksFromPage(page)),
    ], feedSettings);

    for (const linkUrl of pageLinks) {
      const result = await tryDownloadPdfBuffer(page, linkUrl, pdfPath, page.url());
      if (result.success) {
        return result;
      }
    }

    const clicked = await tryClickPdfDownload(page, pdfPath);
    if (clicked.success) {
      return clicked;
    }
  }

  return {
    success: false,
    reason: 'no downloadable pdf candidate succeeded',
  };
}

async function getPdfRuntimeStatus(env) {
  if (!env.pdfRuntimeStatusPromise) {
    env.pdfRuntimeStatusPromise = (async () => {
      try {
        const { chromium } = await import('playwright');
        const executablePath = chromium.executablePath();
        if (!executablePath) {
          return { available: false, reason: 'playwright chromium executable path is unavailable' };
        }

        await fs.access(executablePath);
        return { available: true, reason: '' };
      } catch (error) {
        return {
          available: false,
          reason: clipText(getErrorMessage(error), 240),
        };
      }
    })();
  }

  return env.pdfRuntimeStatusPromise;
}

function toAbsoluteFromPortable(rootDir, value) {
  const segments = String(value ?? '')
    .split('/')
    .filter(Boolean);
  return path.join(rootDir, ...segments);
}

async function ensureDirectory(dirPath, dryRun = false) {
  if (dryRun) {
    return;
  }

  await fs.mkdir(dirPath, { recursive: true });
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function writeTextFileIfChanged(filePath, content, dryRun = false) {
  const normalized = String(content ?? '');

  try {
    const current = await fs.readFile(filePath, 'utf8');
    if (current === normalized) {
      return { path: filePath, written: false };
    }
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error;
    }
  }

  if (!dryRun) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, normalized, 'utf8');
  }

  return { path: filePath, written: true };
}

async function writeJsonFileAtomic(filePath, value, dryRun = false) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  return writeTextFileIfChanged(filePath, serialized, dryRun);
}

function parseFrontmatterScalar(rawValue) {
  const value = String(rawValue ?? '').trim();
  if (!value) {
    return '';
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  if (value === 'null') {
    return null;
  }

  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    try {
      if (value.startsWith('"')) {
        return JSON.parse(value);
      }

      return value.slice(1, -1);
    } catch {
      return value.slice(1, -1);
    }
  }

  return value;
}

export function parseFrontmatterDocument(content) {
  const normalized = String(content ?? '').replace(/\r\n?/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { data: {}, body: normalized };
  }

  const endIndex = normalized.indexOf('\n---\n', 4);
  if (endIndex < 0) {
    return { data: {}, body: normalized };
  }

  const rawFrontmatter = normalized.slice(4, endIndex);
  const body = normalized.slice(endIndex + 5);
  const lines = rawFrontmatter.split('\n');
  const data = {};

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }

    const match = /^([A-Za-z0-9_]+):(?:\s*(.*))?$/.exec(line);
    if (!match) {
      continue;
    }

    const key = match[1];
    const rawValue = match[2] ?? '';

    if (rawValue === '') {
      const items = [];
      while (index + 1 < lines.length) {
        const nextLine = lines[index + 1];
        const itemMatch = /^  - (.*)$/.exec(nextLine);
        if (!itemMatch) {
          break;
        }

        items.push(parseFrontmatterScalar(itemMatch[1]));
        index += 1;
      }

      data[key] = items.length > 0 ? items : '';
      continue;
    }

    data[key] = parseFrontmatterScalar(rawValue);
  }

  return { data, body };
}

function extractArchivedArticleContentFromMarkdown(body) {
  const normalized = String(body ?? '').replace(/\r\n?/g, '\n');
  const marker = '\n## Content\n';
  const index = normalized.indexOf(marker);
  if (index >= 0) {
    return normalizeWhitespace(normalized.slice(index + marker.length));
  }

  return normalizeWhitespace(normalized);
}

function trimTrailingUrlNoise(value) {
  return String(value ?? '')
    .trim()
    .replace(
      /[\u3000\u3001\u3002\uff0c\uff1b\uff1a\uff01\uff1f\uff09\uff3d\uff5d\u300b\u300d\u300f"'`]+$/gu,
      '',
    )
    .replace(/[),.;!?]+$/g, '');
}

function sanitizeRepoPathSegment(value) {
  const match = String(value ?? '')
    .trim()
    .match(/^[A-Za-z0-9._-]+/);
  return match ? match[0] : '';
}

function normalizeRepoUrl(url) {
  try {
    const parsed = new URL(trimTrailingUrlNoise(url));
    const hostname = parsed.hostname.toLowerCase();
    const origin = parsed.origin;
    const parts = parsed.pathname.split('/').filter(Boolean);

    if (/^(.+\.)?github\.com$/i.test(hostname) || /^(.+\.)?gitlab\.com$/i.test(hostname) || /^(.+\.)?bitbucket\.org$/i.test(hostname)) {
      const owner = sanitizeRepoPathSegment(parts[0]);
      const repo = sanitizeRepoPathSegment(parts[1]);
      if (owner && repo) {
        return `${origin}/${owner}/${repo}`;
      }
    }

    if (/^(.+\.)?huggingface\.co$/i.test(hostname)) {
      if (parts[0] === 'datasets' || parts[0] === 'spaces') {
        const scope = sanitizeRepoPathSegment(parts[1]);
        const name = sanitizeRepoPathSegment(parts[2]);
        if (scope && name) {
          return `${origin}/${parts[0]}/${scope}/${name}`;
        }
      } else {
        const scope = sanitizeRepoPathSegment(parts[0]);
        const name = sanitizeRepoPathSegment(parts[1]);
        if (scope && name) {
          return `${origin}/${scope}/${name}`;
        }
      }
    }

    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = trimTrailingUrlNoise(parsed.pathname).replace(/\/+$/g, '');
    return parsed.toString();
  } catch {
    return trimTrailingUrlNoise(url);
  }
}

function normalizeDoiToken(value) {
  return trimTrailingUrlNoise(value)
    .replace(/^doi\s*[:：]\s*/i, '')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .trim();
}

function extractDois(text) {
  const matches =
    String(text ?? '').match(
      /\b(?:https?:\/\/(?:dx\.)?doi\.org\/)?10\.\d{4,9}\/[-._;()/:A-Z0-9]+/gi,
    ) || [];
  return dedupe(matches.map(normalizeDoiToken).filter(Boolean));
}

function normalizePaperUrl(urlOrDoi) {
  const normalized = trimTrailingUrlNoise(urlOrDoi);
  if (!normalized) {
    return '';
  }

  if (/^10\.\d{4,9}\//i.test(normalized)) {
    return `https://doi.org/${normalized}`;
  }

  try {
    const parsed = new URL(normalized);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return normalized;
  }
}

function extractUrls(text) {
  const matches = String(text ?? '').match(/https?:\/\/[^\s<>"']+/g) || [];
  return dedupe(matches.map((item) => trimTrailingUrlNoise(item)).filter(Boolean));
}

function classifyLink(url, line = '') {
  const normalizedLine = String(line ?? '').toLowerCase();
  try {
    const parsed = new URL(url);
    if (
      /(^|[\s:：])(code|repo|github|开源地址|源码)/i.test(line) ||
      REPO_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname))
    ) {
      return 'repo';
    }

    if (
      /(^|[\s:：])(paper|论文|doi)/i.test(line) ||
      PAPER_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname)) ||
      normalizedLine.includes('biorxiv') ||
      normalizedLine.includes('arxiv')
    ) {
      return 'paper';
    }
  } catch {
    return 'other';
  }

  return 'other';
}

function extractLinkCatalog(text) {
  const repoUrls = [];
  const paperUrls = [];
  const allUrls = [];

  for (const line of String(text ?? '').split(/\r?\n/)) {
    for (const url of extractUrls(line)) {
      allUrls.push(url);
      const kind = classifyLink(url, line);
      if (kind === 'repo') {
        repoUrls.push(normalizeRepoUrl(url));
      } else if (kind === 'paper') {
        paperUrls.push(normalizePaperUrl(url));
      }
    }

    for (const doi of extractDois(line)) {
      const paperUrl = normalizePaperUrl(doi);
      allUrls.push(paperUrl);
      paperUrls.push(paperUrl);
    }
  }

  return {
    allUrls: dedupe(allUrls),
    repoUrls: dedupe(repoUrls),
    paperUrls: dedupe(paperUrls),
  };
}

function isNoiseLine(line) {
  const trimmed = String(line ?? '').trim();
  if (!trimmed) {
    return false;
  }

  if (/^!\[.*\]\(.+\)$/.test(trimmed)) {
    return true;
  }

  if (/^(供稿|审稿)\s*[|｜:：]/u.test(trimmed)) {
    return true;
  }

  if (/^榴莲忘返\s+\d{4}$/u.test(trimmed)) {
    return true;
  }

  if (/^(📜|💻)\s*(paper|code|repo)?\s*[:：]/iu.test(trimmed)) {
    return true;
  }

  if (/^—\s*完\s*—$/u.test(trimmed)) {
    return true;
  }

  if (/^#{1,3}\s*(TL;DR|目录)\s*$/iu.test(trimmed)) {
    return true;
  }

  return false;
}

function extractTldrBullets(content) {
  const lines = String(content ?? '').replace(/\r\n?/g, '\n').split('\n');
  const bullets = [];
  let collecting = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^#{1,3}\s*(TL;DR|目录)\s*$/iu.test(line)) {
      collecting = true;
      continue;
    }

    if (!collecting) {
      continue;
    }

    if (/^#{2,3}\s+\d+[.、]/u.test(line) || /^#{2,3}\s+[^#]/u.test(line)) {
      break;
    }

    const match = /^-\s+(.*)$/.exec(line);
    if (match) {
      bullets.push(clipText(match[1], 220));
    }
  }

  return dedupe(bullets);
}

function extractSignalParagraphs(content) {
  const lines = String(content ?? '').replace(/\r\n?/g, '\n').split('\n');
  const paragraphs = [];
  let buffer = [];

  function flushBuffer() {
    if (buffer.length === 0) {
      return;
    }

    const paragraph = clipText(buffer.join(' ').trim(), 420);
    if (paragraph.length >= DEFAULT_SIGNAL_LINE_MIN_LENGTH) {
      paragraphs.push(paragraph);
    }
    buffer = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushBuffer();
      continue;
    }

    if (isNoiseLine(line)) {
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      flushBuffer();
      continue;
    }

    if (line.length < DEFAULT_SIGNAL_LINE_MIN_LENGTH) {
      continue;
    }

    buffer.push(line);
  }

  flushBuffer();
  return dedupe(paragraphs);
}

function parseNumberedSections(content) {
  const lines = String(content ?? '').replace(/\r\n?/g, '\n').split('\n');
  const sections = [];
  let current = null;

  function flushSection() {
    if (!current) {
      return;
    }

    current.text = normalizeWhitespace(current.lines.join('\n'));
    sections.push(current);
    current = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = /^(?:###|##)\s+\d+[.、：:]?\s*(.+)$/.exec(line);
    if (match) {
      flushSection();
      current = {
        title: normalizeWhitespace(match[1]),
        lines: [],
      };
      continue;
    }

    if (current) {
      current.lines.push(rawLine);
    }
  }

  flushSection();
  return sections.filter((item) => item.text);
}

function buildProjectKey({ name, repoUrl, paperUrl }) {
  const seed = repoUrl || paperUrl || name || 'project';

  try {
    const parsed = new URL(seed);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const tail = parts.slice(-2).join('-') || parsed.hostname;
    return `${slugifySegment(`${parsed.hostname}-${tail}`, 'project')}-${shortHash(seed, 6)}`;
  } catch {
    return `${slugifySegment(seed, 'project')}-${shortHash(seed, 6)}`;
  }
}

function buildSummaryFromParagraphs(paragraphs) {
  return clipText(paragraphs.slice(0, 2).join(' '), 340);
}

function buildKeyPointsFromParagraphs(paragraphs) {
  return dedupe(paragraphs.slice(0, 5).map((item) => clipText(item, 180)));
}

function normalizeProject(project, fallbackName = '') {
  const repoUrl = String(project?.repo_url || '').trim();
  const paperUrl = String(project?.paper_url || '').trim();
  const name = normalizeWhitespace(project?.name || fallbackName || repoUrl || paperUrl || 'Untitled');
  const coreSummary = clipText(project?.core_summary || '', 320);
  const sourceQuoteHint = clipText(project?.source_quote_hint || coreSummary, 180);

  return {
    name,
    core_summary: coreSummary,
    repo_url: repoUrl,
    paper_url: paperUrl,
    source_quote_hint: sourceQuoteHint,
    canonical_key:
      normalizeWhitespace(project?.canonical_key || '') || buildProjectKey({ name, repoUrl, paperUrl }),
  };
}

function buildSingleProjectFromArticle(article, linkCatalog, paragraphs) {
  return normalizeProject({
    name: article.title,
    core_summary: buildSummaryFromParagraphs(paragraphs),
    repo_url: linkCatalog.repoUrls[0] || '',
    paper_url: linkCatalog.paperUrls[0] || '',
    source_quote_hint: paragraphs[0] || article.title,
  });
}

function sectionToProject(section, article) {
  const linkCatalog = extractLinkCatalog(section.text);
  const paragraphs = extractSignalParagraphs(section.text);

  return normalizeProject({
    name: section.title || article.title,
    core_summary: buildSummaryFromParagraphs(paragraphs),
    repo_url: linkCatalog.repoUrls[0] || '',
    paper_url: linkCatalog.paperUrls[0] || '',
    source_quote_hint: paragraphs[0] || section.title || article.title,
  });
}

function classifyArticleType(article, feedSettings, linkCatalog, sections) {
  const title = String(article.title ?? '');
  const isAidd = feedSettings.classifier === 'aidd-digest';
  const hasDigestSignals =
    sections.length >= 3 &&
    (extractTldrBullets(article.content).length >= 3 ||
      linkCatalog.paperUrls.length + linkCatalog.repoUrls.length >= 3);

  if (isAidd && hasDigestSignals) {
    return 'five_work_digest';
  }

  if (
    /(访谈|哲学|路线图|本质|直觉|赌局|产品|为什么|反共识|思路|时代)/u.test(title) &&
    sections.length <= 1 &&
    linkCatalog.repoUrls.length <= 1
  ) {
    return 'interview_or_opinion';
  }

  if (linkCatalog.repoUrls.length > 0 || linkCatalog.paperUrls.length > 0 || sections.length === 1) {
    return 'single_project_article';
  }

  return 'interview_or_opinion';
}

function buildLocalAnalysis(article, feedSettings, providerModel) {
  const content = article.content || '';
  const linkCatalog = extractLinkCatalog(content);
  const sections = parseNumberedSections(content);
  const paragraphs = extractSignalParagraphs(content);
  const tldr = extractTldrBullets(content);
  const articleType = classifyArticleType(article, feedSettings, linkCatalog, sections);
  const warnings = [];

  let projects = [];
  if (feedSettings.project_extraction) {
    if (articleType === 'five_work_digest') {
      projects = sections.map((section) => sectionToProject(section, article));
      if (projects.length !== 5) {
        warnings.push(`expected 5 work items but extracted ${projects.length}`);
      }
    } else if (articleType === 'single_project_article') {
      projects = [buildSingleProjectFromArticle(article, linkCatalog, paragraphs)];
    }
  }

  const repoUrls = dedupe([...projects.map((item) => item.repo_url), ...linkCatalog.repoUrls]);
  const paperUrls = dedupe([...projects.map((item) => item.paper_url), ...linkCatalog.paperUrls]);

  return {
    article_type: articleType,
    summary:
      clipText(tldr.slice(0, 2).join(' '), 340) ||
      buildSummaryFromParagraphs(paragraphs) ||
      clipText(article.title, 220),
    key_points:
      tldr.length > 0 ? tldr.slice(0, 6) : buildKeyPointsFromParagraphs(paragraphs).slice(0, 6),
    projects,
    repo_urls: repoUrls,
    paper_urls: paperUrls,
    warnings,
    confidence: articleType === 'five_work_digest' ? 0.62 : 0.55,
    review_status: warnings.length > 0 ? 'needs_review' : 'auto_generated',
    provider: 'local-rules',
    model: providerModel || 'local-rules-v1',
  };
}

function stripJsonCodeFence(value) {
  const normalized = String(value ?? '').trim();
  if (normalized.startsWith('```')) {
    return normalized
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
  }

  return normalized;
}

function normalizeAnalysisOutput(rawAnalysis, article, feedSettings, baseline) {
  const projectSource = Array.isArray(rawAnalysis?.projects) ? rawAnalysis.projects : baseline.projects;
  const projects = feedSettings.project_extraction
    ? projectSource.map((item, index) => normalizeProject(item, `Project ${index + 1}`))
    : [];
  const articleType = ARTICLE_TYPE_VALUES.has(String(rawAnalysis?.article_type || ''))
    ? String(rawAnalysis.article_type)
    : baseline.article_type;
  const warnings = dedupe([
    ...baseline.warnings,
    ...(Array.isArray(rawAnalysis?.warnings) ? rawAnalysis.warnings : []),
  ]);
  const repoUrls = dedupe([
    ...projects.map((item) => item.repo_url),
    ...(Array.isArray(rawAnalysis?.repo_urls) ? rawAnalysis.repo_urls : []),
    ...baseline.repo_urls,
  ]);
  const paperUrls = dedupe([
    ...projects.map((item) => item.paper_url),
    ...(Array.isArray(rawAnalysis?.paper_urls) ? rawAnalysis.paper_urls : []),
    ...baseline.paper_urls,
  ]);

  let reviewStatus = String(rawAnalysis?.review_status || '').trim() || baseline.review_status;
  if (warnings.length > 0) {
    reviewStatus = 'needs_review';
  }

  return {
    article_type: articleType,
    summary: clipText(rawAnalysis?.summary || baseline.summary, 340),
    key_points: dedupe(
      (Array.isArray(rawAnalysis?.key_points) ? rawAnalysis.key_points : baseline.key_points)
        .map((item) => clipText(item, 180))
        .filter(Boolean),
    ).slice(0, 8),
    projects,
    repo_urls: repoUrls,
    paper_urls: paperUrls,
    warnings,
    confidence: Number.isFinite(Number(rawAnalysis?.confidence))
      ? Number(rawAnalysis.confidence)
      : baseline.confidence,
    review_status: reviewStatus,
    provider: rawAnalysis?.provider || baseline.provider,
    model: rawAnalysis?.model || baseline.model,
    source_article_path: article.sourceArticlePath,
    source_raw_path: article.sourceRawPath,
    source_url: article.sourceUrl,
  };
}

async function requestOpenAiCompatibleJson({
  providerConfig,
  providerName,
  providerModel,
  timeoutMs,
  messages,
  responseFormat = { type: 'json_object' },
  requestOptions = {},
}) {
  const apiKey = resolveProviderField(providerConfig, 'api_key');
  const baseUrl = resolveProviderField(providerConfig, 'base_url');
  const defaultModel = resolveProviderField(providerConfig, 'model');
  const model = String(providerModel || defaultModel || '').trim();

  if (!apiKey || !baseUrl || !model) {
    throw createProviderError(
      'provider_missing_credentials',
      `provider ${providerName} is missing credentials, base url, or model`,
      { providerName, model },
    );
  }

  const endpoint = buildOpenAiCompatibleEndpoint(baseUrl);
  if (!endpoint) {
    throw createProviderError(
      'provider_missing_credentials',
      `provider ${providerName} is missing credentials, base url, or model`,
      { providerName, model },
    );
  }

  const article = {
    content: '',
    title: '',
    feedSlug: '',
    sourceUrl: '',
    publishedAtIso: '',
  };
  const feedSettings = {
    classifier: '',
    project_extraction: false,
  };

  const contentExcerpt = clipText(article.content, DEFAULT_MODEL_MAX_CHARS);
  const linkCatalog = extractLinkCatalog(article.content);
  const systemPrompt = [
    'You are maintaining an LLM wiki for WeChat article knowledge bases.',
    'Return JSON only.',
    'Allowed article_type values: five_work_digest, single_project_article, interview_or_opinion.',
    'projects must contain objects with name, core_summary, repo_url, paper_url, source_quote_hint, canonical_key.',
    'If the article is a 榴莲忘返 digest, detect numbered work sections and extract each work item.',
    'Do not invent repo_url or paper_url.',
  ].join(' ');

  const userPayload = {
    title: article.title,
    feed_slug: article.feedSlug,
    source_url: article.sourceUrl,
    published_at: article.publishedAtIso,
    classifier: feedSettings.classifier || '',
    project_extraction: Boolean(feedSettings.project_extraction),
    repo_urls: linkCatalog.repoUrls,
    paper_urls: linkCatalog.paperUrls,
    content: contentExcerpt,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: responseFormat,
          ...requestOptions,
          messages,
        }),
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw createProviderError(
          'provider_timeout',
          `provider ${providerName} timed out after ${timeoutMs}ms`,
          { providerName, model },
        );
      }

      throw createProviderError(
        'provider_network_error',
        `provider ${providerName} network error: ${getErrorMessage(error)}`,
        { providerName, model, cause: error },
      );
    }

    if (!response.ok) {
      const responseText = normalizeWhitespace(await response.text());
      const responseTextLower = responseText.toLowerCase();
      let errorCode = 'provider_request_failed';
      if (
        response.status === 400 &&
        responseTextLower.includes('model') &&
        (responseTextLower.includes('not exist') ||
          responseTextLower.includes('not found') ||
          responseTextLower.includes('unsupported') ||
          responseTextLower.includes('invalid'))
      ) {
        errorCode = 'provider_model_unavailable';
      } else if (response.status === 401) {
        errorCode = 'provider_auth_invalid';
      } else if (response.status === 403) {
        errorCode = 'provider_permission_denied';
      } else if (response.status === 429) {
        errorCode = 'provider_quota_exhausted';
      } else if (response.status >= 500) {
        errorCode = 'provider_network_error';
      }

      throw createProviderError(
        errorCode,
        `provider ${providerName} request failed with status ${response.status}${
          responseText ? `: ${clipText(responseText, 240)}` : ''
        }`,
        {
          providerName,
          model,
          httpStatus: response.status,
          responseText,
        },
      );
    }

    const payload = await response.json();
    const messageContent = stripJsonCodeFence(
      payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.text || '',
    );
    if (!messageContent) {
      throw createProviderError(
        'provider_empty_content',
        `provider ${providerName} returned empty content`,
        { providerName, model },
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(messageContent);
    } catch (error) {
      throw createProviderError(
        'provider_invalid_json',
        `provider ${providerName} returned invalid JSON: ${getErrorMessage(error)}`,
        { providerName, model, rawContent: messageContent },
      );
    }

    return {
      ...parsed,
      provider: providerName,
      model,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function requestOpenAiCompatibleSummary({
  article,
  providerConfig,
  providerName,
  providerModel,
  timeoutMs,
  feedSettings,
}) {
  const contentExcerpt = clipText(article.content, DEFAULT_MODEL_MAX_CHARS);
  const linkCatalog = extractLinkCatalog(article.content);
  const systemPrompt = [
    'You are maintaining an LLM wiki for WeChat article knowledge bases.',
    'Return JSON only.',
    'Allowed article_type values: five_work_digest, single_project_article, interview_or_opinion.',
    'projects must contain objects with name, core_summary, repo_url, paper_url, source_quote_hint, canonical_key.',
    'If the article is a 姒磋幉蹇樿繑 digest, detect numbered work sections and extract each work item.',
    'Do not invent repo_url or paper_url.',
  ].join(' ');

  const userPayload = {
    title: article.title,
    feed_slug: article.feedSlug,
    source_url: article.sourceUrl,
    published_at: article.publishedAtIso,
    classifier: feedSettings.classifier || '',
    project_extraction: Boolean(feedSettings.project_extraction),
    repo_urls: linkCatalog.repoUrls,
    paper_urls: linkCatalog.paperUrls,
    content: contentExcerpt,
  };

  return requestOpenAiCompatibleJson({
    providerConfig,
    providerName,
    providerModel,
    timeoutMs,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(userPayload) },
    ],
  });
}

async function probeOpenAiCompatibleModel({ providerConfig, providerName, providerModel, timeoutMs }) {
  return requestOpenAiCompatibleJson({
    providerConfig,
    providerName,
    providerModel,
    timeoutMs,
    messages: [
      { role: 'system', content: 'Return JSON only.' },
      {
        role: 'user',
        content: JSON.stringify({
          action: 'probe',
          expected: { ok: true, model: providerModel },
        }),
      },
    ],
  });
}

function buildFallbackAnalysis(baseline, warnings, fallbackProviderName, providers) {
  const fallbackModel = providers[fallbackProviderName]?.model || baseline.model;
  return {
    ...baseline,
    warnings: dedupe([...baseline.warnings, ...warnings]),
    provider: fallbackProviderName,
    model: fallbackModel,
    review_status: 'needs_review',
  };
}

function expandManualModelCandidates(modelName) {
  const normalizedModel = String(modelName || '').trim();
  if (!normalizedModel) {
    return [];
  }

  return dedupe([normalizedModel, ...(GLM_MANUAL_MODEL_ALIAS_MAP[normalizedModel] || [])]);
}

function resolveGlmManualRoute(env, feedSettings) {
  const providers = env.config.providers || {};
  const providerName = String(feedSettings.glm_manual_provider || 'glm_coding_manual').trim();
  const providerConfig = providers[providerName] || {};
  const models = dedupe([
    String(feedSettings.glm_primary_model || DEFAULT_GLM_MANUAL_PRIMARY_MODEL).trim(),
    ...((Array.isArray(feedSettings.glm_fallback_models)
      ? feedSettings.glm_fallback_models
      : DEFAULT_GLM_MANUAL_FALLBACK_MODELS
    ).map((item) => String(item || '').trim()).filter(Boolean)),
  ]);

  return {
    providerName,
    providerConfig,
    models,
    timeoutMs: Number(providerConfig.timeout_ms || DEFAULT_PROVIDER_TIMEOUT_MS),
    fallbackProviderName: feedSettings.fallback_provider || providers.fallback || 'local-rules',
  };
}

async function analyzeArticleWithManualGlm(article, env, feedSettings, baseline) {
  const providers = env.config.providers || {};
  const warnings = [];
  const route = resolveGlmManualRoute(env, feedSettings);
  if (route.providerConfig.type !== 'openai-compatible') {
    return buildFallbackAnalysis(
      baseline,
      [`provider ${route.providerName} is not configured as openai-compatible`],
      route.fallbackProviderName,
      providers,
    );
  }

  for (const logicalModel of route.models) {
    const candidateModels = expandManualModelCandidates(logicalModel);
    for (let index = 0; index < candidateModels.length; index += 1) {
      const providerModel = candidateModels[index];
      try {
        const modelAnalysis = await requestOpenAiCompatibleSummary({
          article,
          providerConfig: route.providerConfig,
          providerName: route.providerName,
          providerModel,
          timeoutMs: route.timeoutMs,
          feedSettings,
        });
        return normalizeAnalysisOutput(
          {
            ...modelAnalysis,
            warnings: dedupe([
              ...(Array.isArray(modelAnalysis?.warnings) ? modelAnalysis.warnings : []),
              ...warnings,
            ]),
          },
          article,
          feedSettings,
          {
            ...baseline,
            provider: route.providerName,
          },
        );
      } catch (error) {
        const message = getErrorMessage(error);
        warnings.push(`provider ${route.providerName}/${providerModel} failed: ${message}`);

        if (isTerminalProviderError(error)) {
          return buildFallbackAnalysis(
            baseline,
            warnings,
            route.fallbackProviderName,
            providers,
          );
        }

        const canTryAlias =
          getProviderErrorCode(error) === 'provider_model_unavailable' &&
          index < candidateModels.length - 1;
        if (canTryAlias) {
          continue;
        }

        if (!isModelFallbackError(error)) {
          warnings.push(
            `provider ${route.providerName}/${providerModel} ended without a retryable fallback classification`,
          );
        }
        break;
      }
    }
  }

  return buildFallbackAnalysis(baseline, warnings, route.fallbackProviderName, providers);
}

async function analyzeArticle(article, env, feedSettings, analysisOptions = {}) {
  const providers = env.config.providers || {};
  const baseline = buildLocalAnalysis(
    article,
    feedSettings,
    providers['local-rules']?.model || 'local-rules-v1',
  );
  if (analysisOptions.mode === 'glm-manual') {
    return analyzeArticleWithManualGlm(article, env, feedSettings, baseline);
  }

  const requestedProviderName = feedSettings.provider || providers.default || 'local-rules';
  const fallbackProviderName =
    feedSettings.fallback_provider || providers.fallback || 'local-rules';
  const providerConfig = providers[requestedProviderName] || {};
  const timeoutMs = Number(providerConfig.timeout_ms || DEFAULT_PROVIDER_TIMEOUT_MS);

  if (providerConfig.type === 'openai-compatible') {
    try {
      const modelAnalysis = await requestOpenAiCompatibleSummary({
        article,
        providerConfig,
        providerName: requestedProviderName,
        providerModel: process.env[String(providerConfig.model_env || '').trim()] || '',
        timeoutMs,
        feedSettings,
      });

      return normalizeAnalysisOutput(modelAnalysis, article, feedSettings, {
        ...baseline,
        provider: requestedProviderName,
      });
    } catch (error) {
      const fallback = {
        ...baseline,
        warnings: dedupe([
          ...baseline.warnings,
          `provider ${requestedProviderName} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ]),
        provider: fallbackProviderName,
        model: providers[fallbackProviderName]?.model || baseline.model,
        review_status: 'needs_review',
      };
      return fallback;
    }
  }

  return {
    ...baseline,
    provider: requestedProviderName,
    model: providerConfig.model || baseline.model,
  };
}

function buildPrintableHtml(article, rawPayload) {
  const sourceHtml = String(rawPayload?.source_item?.content_html || '').trim();
  if (!sourceHtml || !/<[a-z][\s\S]*>/i.test(sourceHtml)) {
    return '';
  }

  const contentHtml = extractRichMediaContentHtml(sourceHtml) || sourceHtml;
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '  <meta charset="utf-8">',
    `  <title>${escapeHtml(article.title)}</title>`,
    article.sourceUrl ? `  <base href="${escapeHtml(article.sourceUrl)}">` : '',
    '  <style>',
    '    body { font-family: "Segoe UI", "PingFang SC", sans-serif; color: #111; margin: 0; }',
    '    article { max-width: 820px; margin: 0 auto; padding: 32px 24px 64px; line-height: 1.7; }',
    '    img { max-width: 100%; height: auto; display: block; margin: 16px auto; }',
    '    h1 { font-size: 30px; line-height: 1.25; margin: 0 0 16px; }',
    '    h2, h3, h4 { margin-top: 28px; }',
    '    p, li { font-size: 15px; }',
    '    a { color: #0a58ca; word-break: break-all; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <article>',
    `    <h1>${escapeHtml(article.title)}</h1>`,
    contentHtml,
    '  </article>',
    '</body>',
    '</html>',
  ]
    .filter(Boolean)
    .join('\n');
}

async function renderPdfIfNeeded({ env, article, analysis, rawPayload, pdfPath, feedSettings, dryRun }) {
  const policy = String(feedSettings.pdf_policy || 'disabled');
  const shouldRender =
    policy === 'all' ||
    (policy === 'key_articles_only' &&
      (analysis.article_type === 'five_work_digest' || analysis.projects.length >= 3));

  if (!shouldRender) {
    return { pdf_status: 'skipped', pdf_path: '', pdf_method: '', pdf_source_url: '' };
  }

  if (dryRun) {
    return {
      pdf_status: 'dry_run',
      pdf_path: portablePath(pdfPath),
      pdf_method: '',
      pdf_source_url: '',
    };
  }

  const session = await openPdfBrowserSession(env, article.feedSlug, feedSettings, {
    headless: true,
  });
  if (!session.ok) {
    return {
      pdf_status: session.status,
      pdf_path: '',
      pdf_method: '',
      pdf_source_url: '',
      pdf_warning: session.warning,
    };
  }

  try {
    const page = session.context.pages()[0] || (await session.context.newPage());
    const printableHtml = buildPrintableHtml(article, rawPayload);
    const sourceStrategy = String(feedSettings.pdf_source_strategy || 'download_then_print');

    if (sourceStrategy !== 'print_only') {
      const downloadResult = await tryDownloadPdfBeforePrint(
        page,
        article,
        analysis,
        rawPayload,
        pdfPath,
        feedSettings
      );
      if (downloadResult.success) {
        return {
          pdf_status: 'generated',
          pdf_path: portablePath(pdfPath),
          pdf_method: downloadResult.method || 'download',
          pdf_source_url: downloadResult.sourceUrl || '',
        };
      }
    }

    if (printableHtml) {
      try {
        await page.setContent(printableHtml, { waitUntil: 'domcontentloaded' });
        await ensureDirectory(path.dirname(pdfPath));
        await page.pdf({
          path: pdfPath,
          format: 'A4',
          printBackground: true,
          margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
        });
        return {
          pdf_status: 'generated',
          pdf_path: portablePath(pdfPath),
          pdf_method: 'print_local_html',
          pdf_source_url: article.sourceUrl || '',
        };
      } catch {
        // Fall through to source-url printing below.
      }
    }

    if (article.sourceUrl) {
      try {
        await page.goto(article.sourceUrl, { waitUntil: 'networkidle', timeout: 60_000 });
        await ensureDirectory(path.dirname(pdfPath));
        await page.pdf({
          path: pdfPath,
          format: 'A4',
          printBackground: true,
          margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
        });
        return {
          pdf_status: 'generated',
          pdf_path: portablePath(pdfPath),
          pdf_method: 'print_source_url',
          pdf_source_url: article.sourceUrl,
        };
      } catch {
        // handled by final failure below
      }
    }

    return {
      pdf_status: 'failed',
      pdf_path: '',
      pdf_method: '',
      pdf_source_url: '',
      pdf_warning: 'unable to download pdf or render pdf from local html or source url',
    };
  } finally {
    await session.close();
  }
}

function buildQuarterKey(monthBucket) {
  const [yearText, monthText] = String(monthBucket || '').split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return 'unknown-quarter';
  }

  const quarter = Math.floor((month - 1) / 3) + 1;
  return `${year}-Q${quarter}`;
}

function buildMonthRange(fromMonth, toMonth) {
  const [fromYear, fromMonthValue] = String(fromMonth).split('-').map(Number);
  const [toYear, toMonthValue] = String(toMonth).split('-').map(Number);
  const result = [];

  if (
    !Number.isFinite(fromYear) ||
    !Number.isFinite(fromMonthValue) ||
    !Number.isFinite(toYear) ||
    !Number.isFinite(toMonthValue)
  ) {
    return result;
  }

  let year = fromYear;
  let month = fromMonthValue;
  while (year < toYear || (year === toYear && month <= toMonthValue)) {
    result.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      year += 1;
      month = 1;
    }
  }

  return result;
}

function relativeMarkdownLink(fromPath, toPath) {
  return portablePath(path.relative(path.dirname(fromPath), toPath) || path.basename(toPath));
}

function buildSourceArticleOutputJson(article, analysis, pdfResult, paths) {
  return {
    version: 1,
    generated_at: formatIsoTimestamp(new Date()),
    feed_slug: article.feedSlug,
    feed_title: article.feedTitle,
    article_id: article.articleId,
    title: article.title,
    published_at: article.publishedAtIso,
    article_type: analysis.article_type,
    summary: analysis.summary,
    key_points: analysis.key_points,
    projects: analysis.projects,
    repo_urls: analysis.repo_urls,
    paper_urls: analysis.paper_urls,
    source_article_path: article.sourceArticlePath,
    source_raw_path: article.sourceRawPath,
    source_url: article.sourceUrl,
    article_markdown_path: portablePath(paths.articleMarkdownPath),
    json_path: portablePath(paths.articleJsonPath),
    pdf_path: pdfResult.pdf_path || '',
    pdf_status: pdfResult.pdf_status,
    pdf_method: pdfResult.pdf_method || '',
    pdf_source_url: pdfResult.pdf_source_url || '',
    provider: analysis.provider,
    model: analysis.model,
    review_status: analysis.review_status,
    warnings: dedupe([
      ...analysis.warnings,
      ...(pdfResult.pdf_warning ? [pdfResult.pdf_warning] : []),
    ]),
    confidence: analysis.confidence,
  };
}

function buildArticleMarkdownDocument(articleOutput, paths) {
  const tags = [
    'llm-wiki',
    `feed:${articleOutput.feed_slug}`,
    `type:${articleOutput.article_type}`,
    ...articleOutput.projects.map((item) => `project:${item.canonical_key}`),
  ];

  const frontmatter = [
    '---',
    `title: ${quoteYamlString(articleOutput.title)}`,
    `feed_slug: ${quoteYamlString(articleOutput.feed_slug)}`,
    `feed_title: ${quoteYamlString(articleOutput.feed_title)}`,
    `article_id: ${quoteYamlString(articleOutput.article_id)}`,
    `published_at: ${quoteYamlString(articleOutput.published_at)}`,
    `article_type: ${quoteYamlString(articleOutput.article_type)}`,
    `source_url: ${quoteYamlString(articleOutput.source_url)}`,
    `source_article_path: ${quoteYamlString(articleOutput.source_article_path)}`,
    `source_raw_path: ${quoteYamlString(articleOutput.source_raw_path)}`,
    `provider: ${quoteYamlString(articleOutput.provider)}`,
    `model: ${quoteYamlString(articleOutput.model)}`,
    `pdf_path: ${quoteYamlString(articleOutput.pdf_path || '')}`,
    `pdf_status: ${quoteYamlString(articleOutput.pdf_status)}`,
    `pdf_method: ${quoteYamlString(articleOutput.pdf_method || '')}`,
    `pdf_source_url: ${quoteYamlString(articleOutput.pdf_source_url || '')}`,
    `review_status: ${quoteYamlString(articleOutput.review_status)}`,
    `warnings:\n${renderYamlValue(articleOutput.warnings)}`,
    `tags:\n${renderYamlValue(tags)}`,
    '---',
  ].join('\n');

  const sourceLink = relativeMarkdownLink(
    paths.articleMarkdownPath,
    paths.sourceArticleAbsolutePath,
  );
  const pdfLink =
    articleOutput.pdf_path && paths.pdfAbsolutePath
      ? `[Open PDF](${relativeMarkdownLink(paths.articleMarkdownPath, paths.pdfAbsolutePath)})${
          articleOutput.pdf_method ? ` (${articleOutput.pdf_method})` : ''
        }`
      : articleOutput.pdf_status;
  const projectLines = articleOutput.projects.length
    ? articleOutput.projects
        .map((item) => {
          const projectAbsolutePath = path.join(
            path.dirname(path.dirname(path.dirname(paths.articleMarkdownPath))),
            'projects',
            `${item.canonical_key}.md`,
          );
          return [
            `### ${item.name}`,
            '',
            item.core_summary || '_No summary available._',
            '',
            `- Project page: [${item.canonical_key}](${relativeMarkdownLink(paths.articleMarkdownPath, projectAbsolutePath)})`,
            item.repo_url ? `- Repo: ${item.repo_url}` : null,
            item.paper_url ? `- Paper: ${item.paper_url}` : null,
          ]
            .filter(Boolean)
            .join('\n');
        })
        .join('\n\n')
    : '_No project entities were extracted._';

  const warningsBlock =
    articleOutput.warnings.length > 0
      ? ['## Warnings', '', ...articleOutput.warnings.map((item) => `- ${item}`), ''].join('\n')
      : '';

  return [
    frontmatter,
    '',
    `# ${articleOutput.title}`,
    '',
    `- Source article: [${articleOutput.source_article_path}](${sourceLink})`,
    `- Original URL: ${articleOutput.source_url || '_N/A_'}`,
    `- Published: ${articleOutput.published_at}`,
    `- Type: ${articleOutput.article_type}`,
    `- Provider: ${articleOutput.provider} / ${articleOutput.model}`,
    `- PDF: ${pdfLink}`,
    articleOutput.pdf_source_url ? `- PDF source: ${articleOutput.pdf_source_url}` : null,
    `- Review: ${articleOutput.review_status}`,
    '',
    '## Summary',
    '',
    articleOutput.summary || '_No summary generated._',
    '',
    '## Key Points',
    '',
    ...(articleOutput.key_points.length > 0
      ? articleOutput.key_points.map((item) => `- ${item}`)
      : ['- _No key points generated._']),
    '',
    '## Projects',
    '',
    projectLines,
    '',
    warningsBlock,
  ]
    .filter(Boolean)
    .join('\n');
}

function mergeProjectMentions(articleOutputs) {
  const projectMap = new Map();

  for (const articleOutput of articleOutputs) {
    for (const project of articleOutput.projects || []) {
      const key = project.canonical_key;
      const entry =
        projectMap.get(key) ||
        {
          canonical_key: key,
          name: project.name,
          repo_urls: [],
          paper_urls: [],
          core_summaries: [],
          source_articles: [],
          first_seen: articleOutput.published_at,
          last_seen: articleOutput.published_at,
        };

      entry.name = entry.name || project.name;
      entry.repo_urls.push(project.repo_url);
      entry.paper_urls.push(project.paper_url);
      entry.core_summaries.push(project.core_summary);
      entry.source_articles.push({
        article_id: articleOutput.article_id,
        title: articleOutput.title,
        published_at: articleOutput.published_at,
        article_markdown_path: articleOutput.article_markdown_path,
        source_article_path: articleOutput.source_article_path,
        source_url: articleOutput.source_url,
      });
      if (articleOutput.published_at < entry.first_seen) {
        entry.first_seen = articleOutput.published_at;
      }
      if (articleOutput.published_at > entry.last_seen) {
        entry.last_seen = articleOutput.published_at;
      }

      projectMap.set(key, entry);
    }
  }

  return Array.from(projectMap.values())
    .map((entry) => ({
      ...entry,
      repo_urls: dedupe(entry.repo_urls),
      paper_urls: dedupe(entry.paper_urls),
      core_summaries: dedupe(entry.core_summaries).filter(Boolean),
      source_articles: entry.source_articles.sort((left, right) =>
        left.published_at.localeCompare(right.published_at),
      ),
      mention_count: entry.source_articles.length,
    }))
    .sort((left, right) => right.mention_count - left.mention_count || left.name.localeCompare(right.name));
}

function buildProjectMarkdown(project) {
  const frontmatter = [
    '---',
    `title: ${quoteYamlString(project.name)}`,
    `project_key: ${quoteYamlString(project.canonical_key)}`,
    `mention_count: ${project.mention_count}`,
    `first_seen: ${quoteYamlString(project.first_seen)}`,
    `last_seen: ${quoteYamlString(project.last_seen)}`,
    `repo_urls:\n${renderYamlValue(project.repo_urls)}`,
    `paper_urls:\n${renderYamlValue(project.paper_urls)}`,
    '---',
  ].join('\n');

  return [
    frontmatter,
    '',
    `# ${project.name}`,
    '',
    `- Canonical key: ${project.canonical_key}`,
    `- Mention count: ${project.mention_count}`,
    `- First seen: ${project.first_seen}`,
    `- Last seen: ${project.last_seen}`,
    ...(project.repo_urls.map((item) => `- Repo: ${item}`)),
    ...(project.paper_urls.map((item) => `- Paper: ${item}`)),
    '',
    '## Core Summaries',
    '',
    ...(project.core_summaries.length > 0
      ? project.core_summaries.map((item) => `- ${item}`)
      : ['- _No core summary available._']),
    '',
    '## Source Articles',
    '',
    ...(project.source_articles.length > 0
      ? project.source_articles.map(
          (item) => `- ${item.title} (${item.published_at.slice(0, 10)}) | ${item.source_url}`,
        )
      : ['- _No source articles recorded._']),
    '',
  ].join('\n');
}

function buildMonthAggregate(feedSlug, feedTitle, monthBucket, articleOutputs, projectEntries) {
  const byType = {};
  for (const item of articleOutputs) {
    byType[item.article_type] = (byType[item.article_type] || 0) + 1;
  }

  const topProjects = projectEntries
    .filter((item) =>
      item.source_articles.some((source) => getMonthBucket(new Date(source.published_at)) === monthBucket),
    )
    .slice(0, 12)
    .map((item) => ({
      canonical_key: item.canonical_key,
      name: item.name,
      mention_count: item.source_articles.filter(
        (source) => getMonthBucket(new Date(source.published_at)) === monthBucket,
      ).length,
    }));

  return {
    version: 1,
    feed_slug: feedSlug,
    feed_title: feedTitle,
    month_bucket: monthBucket,
    generated_at: formatIsoTimestamp(new Date()),
    article_count: articleOutputs.length,
    article_type_counts: byType,
    project_count: dedupe(articleOutputs.flatMap((item) => item.projects.map((project) => project.canonical_key)))
      .length,
    top_projects: topProjects,
    articles: articleOutputs
      .slice()
      .sort((left, right) => left.published_at.localeCompare(right.published_at))
      .map((item) => ({
        article_id: item.article_id,
        title: item.title,
        published_at: item.published_at,
        article_type: item.article_type,
        project_count: item.projects.length,
        article_markdown_path: item.article_markdown_path,
      })),
  };
}

function buildMonthMarkdown(monthAggregate) {
  const frontmatter = [
    '---',
    `title: ${quoteYamlString(`${monthAggregate.feed_title} ${monthAggregate.month_bucket}`)}`,
    `feed_slug: ${quoteYamlString(monthAggregate.feed_slug)}`,
    `month_bucket: ${quoteYamlString(monthAggregate.month_bucket)}`,
    `article_count: ${monthAggregate.article_count}`,
    `project_count: ${monthAggregate.project_count}`,
    '---',
  ].join('\n');

  return [
    frontmatter,
    '',
    `# ${monthAggregate.feed_title} ${monthAggregate.month_bucket}`,
    '',
    `- Articles: ${monthAggregate.article_count}`,
    `- Projects: ${monthAggregate.project_count}`,
    '',
    '## Article Types',
    '',
    ...Object.entries(monthAggregate.article_type_counts)
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Top Projects',
    '',
    ...(monthAggregate.top_projects.length > 0
      ? monthAggregate.top_projects.map((item) => `- ${item.name} (${item.mention_count})`)
      : ['- _No projects extracted this month._']),
    '',
    '## Articles',
    '',
    ...(monthAggregate.articles.length > 0
      ? monthAggregate.articles.map(
          (item) => `- ${item.title} | ${item.article_type} | ${item.project_count} projects`,
        )
      : ['- _No articles rendered._']),
    '',
  ].join('\n');
}

function buildQuarterAggregate(feedSlug, feedTitle, quarterKey, monthAggregates) {
  const articleCount = monthAggregates.reduce((sum, item) => sum + item.article_count, 0);
  const projectCount = dedupe(
    monthAggregates.flatMap((item) => item.top_projects.map((project) => project.canonical_key)),
  ).length;

  return {
    version: 1,
    feed_slug: feedSlug,
    feed_title: feedTitle,
    quarter_key: quarterKey,
    generated_at: formatIsoTimestamp(new Date()),
    article_count: articleCount,
    project_count: projectCount,
    months: monthAggregates
      .slice()
      .sort((left, right) => left.month_bucket.localeCompare(right.month_bucket))
      .map((item) => ({
        month_bucket: item.month_bucket,
        article_count: item.article_count,
        project_count: item.project_count,
      })),
  };
}

function buildQuarterMarkdown(quarterAggregate) {
  const frontmatter = [
    '---',
    `title: ${quoteYamlString(`${quarterAggregate.feed_title} ${quarterAggregate.quarter_key}`)}`,
    `feed_slug: ${quoteYamlString(quarterAggregate.feed_slug)}`,
    `quarter_key: ${quoteYamlString(quarterAggregate.quarter_key)}`,
    `article_count: ${quarterAggregate.article_count}`,
    `project_count: ${quarterAggregate.project_count}`,
    '---',
  ].join('\n');

  return [
    frontmatter,
    '',
    `# ${quarterAggregate.feed_title} ${quarterAggregate.quarter_key}`,
    '',
    `- Articles: ${quarterAggregate.article_count}`,
    `- Projects: ${quarterAggregate.project_count}`,
    '',
    '## Months',
    '',
    ...(quarterAggregate.months.length > 0
      ? quarterAggregate.months.map(
          (item) => `- ${item.month_bucket} | ${item.article_count} articles | ${item.project_count} projects`,
        )
      : ['- _No months rendered._']),
    '',
  ].join('\n');
}

function buildFeedIndexMarkdown(feedSummary, feedIndexPath) {
  const monthLines = feedSummary.months.map((item) => {
    const monthAbsolutePath = path.join(path.dirname(feedIndexPath), 'months', `${item}.md`);
    return `- [${item}](${relativeMarkdownLink(feedIndexPath, monthAbsolutePath)})`;
  });
  const quarterLines = feedSummary.quarters.map((item) => {
    const quarterAbsolutePath = path.join(path.dirname(feedIndexPath), 'quarters', `${item}.md`);
    return `- [${item}](${relativeMarkdownLink(feedIndexPath, quarterAbsolutePath)})`;
  });

  return [
    '# Feed Wiki',
    '',
    `- Feed: ${feedSummary.feed_title}`,
    `- Slug: ${feedSummary.feed_slug}`,
    `- Articles rendered: ${feedSummary.article_count}`,
    `- Project pages: ${feedSummary.project_count}`,
    '',
    '## Months',
    '',
    ...(monthLines.length > 0
      ? monthLines
      : ['- _No month pages rendered._']),
    '',
    '## Quarters',
    '',
    ...(quarterLines.length > 0
      ? quarterLines
      : ['- _No quarter pages rendered._']),
    '',
  ].join('\n');
}

function buildHubIndexMarkdown(registry, hubIndexPath) {
  const lines = registry.feeds.map((item) => {
    const feedIndexPath = path.join(path.dirname(hubIndexPath), '..', 'Wikis', item.slug, 'index.md');
    return `- [${item.title}](${relativeMarkdownLink(hubIndexPath, feedIndexPath)}) | enabled=${item.enabled} | source_articles=${item.source_article_count} | wiki_articles=${item.generated_article_count}`;
  });

  return [
    '# Hub',
    '',
    `- Generated: ${registry.generated_at}`,
    '',
    '## Feeds',
    '',
    ...(lines.length > 0 ? lines : ['- _No feeds discovered._']),
    '',
  ].join('\n');
}

function buildHubFeedsMarkdown(registry, hubFeedsPath) {
  const lines = registry.feeds.map((item) => {
    const feedIndexPath = path.join(path.dirname(hubFeedsPath), '..', 'Wikis', item.slug, 'index.md');
    const statusPath = path.join(path.dirname(hubFeedsPath), 'status', `${item.slug}.md`);
    return `- [${item.title}](${relativeMarkdownLink(hubFeedsPath, feedIndexPath)}) | [status](${relativeMarkdownLink(hubFeedsPath, statusPath)}) | months=${item.month_count} | projects=${item.generated_project_count} | last_run=${item.last_run_at || 'never'}`;
  });

  return ['# Feeds', '', ...(lines.length > 0 ? lines : ['- _No feed status available._']), ''].join(
    '\n',
  );
}

function buildFeedStatusMarkdown(feedRegistryEntry, lintSummary = null) {
  const lintLines = lintSummary
    ? [
        `- Lint status: ${lintSummary.status}`,
        `- Issues: ${lintSummary.issue_count}`,
        ...(lintSummary.issues.slice(0, 20).map((item) => `- ${item}`)),
      ]
    : ['- Lint status: not-run'];

  return [
    `# ${feedRegistryEntry.title}`,
    '',
    `- Enabled: ${feedRegistryEntry.enabled}`,
    `- Source feed slug: ${feedRegistryEntry.slug}`,
    `- Source articles: ${feedRegistryEntry.source_article_count}`,
    `- Source months: ${feedRegistryEntry.month_count}`,
    `- Wiki articles: ${feedRegistryEntry.generated_article_count}`,
    `- Project pages: ${feedRegistryEntry.generated_project_count}`,
    `- Last run: ${feedRegistryEntry.last_run_at || 'never'}`,
    '',
    '## Lint',
    '',
    ...lintLines,
    '',
  ].join('\n');
}

function buildFeedAgentInstructions(feedSlug, feedSettings) {
  return [
    `# ${feedSlug} Wiki Rules`,
    '',
    'This feed wiki is a persistent Markdown knowledge base derived from raw WeWe-RSS article sources.',
    '',
    '## Constraints',
    '',
    '- Raw sources under `WeWe-RSS-AI/<feed>/<YYYY-MM>/` are read-only.',
    '- Derived wiki content lives only under `WeWe-RSS-AI/Wikis/<feed>/`.',
    '- Keep article pages, project pages, month pages, and quarter pages consistent.',
    '- Prefer updating existing project pages instead of creating duplicates.',
    '',
    '## Feed Settings',
    '',
    `- classifier: ${feedSettings.classifier || 'generic'}`,
    `- project_extraction: ${Boolean(feedSettings.project_extraction)}`,
    `- pdf_policy: ${feedSettings.pdf_policy || 'disabled'}`,
    `- provider: ${feedSettings.provider || 'local-rules'}`,
    '',
    '## Article Types',
    '',
    '- `five_work_digest`: numbered digest that extracts multiple project/work items.',
    '- `single_project_article`: one main project or paper.',
    '- `interview_or_opinion`: commentary, interview, or trend synthesis.',
    '',
  ].join('\n');
}

function buildInitialFeedLog(feedTitle) {
  return [`# ${feedTitle} Log`, '', ''].join('\n');
}

function buildInitialHubLog() {
  return ['# Hub Log', '', ''].join('\n');
}

async function appendLogEntry(logPath, title, lines, dryRun = false) {
  let current = '';
  try {
    current = await fs.readFile(logPath, 'utf8');
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error;
    }
  }

  const entry = [`## [${formatIsoTimestamp(new Date())}] ${title}`, '', ...lines, ''].join('\n');
  const next = current ? `${current.trimEnd()}\n\n${entry}` : `${entry}\n`;
  return writeTextFileIfChanged(logPath, next, dryRun);
}

function buildEmptyState() {
  return {
    version: STATE_VERSION,
    feeds: {},
  };
}

async function readWikiState(env) {
  return readJsonFile(path.join(env.stateRoot, 'wiki-state.json'), buildEmptyState());
}

async function writeWikiState(env, state, dryRun = false) {
  return writeJsonFileAtomic(path.join(env.stateRoot, 'wiki-state.json'), state, dryRun);
}

async function writeFeedStateSnapshot(env, feedSlug) {
  const filePath = path.join(env.stateRoot, 'feeds', feedSlug, 'state.json');
  const payload = {
    version: STATE_VERSION,
    feed: feedSlug,
    ...(env.state.feeds[feedSlug] || { articles: {} }),
  };
  return writeJsonFileAtomic(filePath, payload, env.dryRun);
}

async function discoverSourceFeeds(env) {
  const entries = await fs.readdir(env.weweRoot, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        !RESERVED_SOURCE_DIRS.has(entry.name),
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function scanFeedArticles(env, feedSlug, options = {}) {
  const feedRoot = path.join(env.weweRoot, feedSlug);
  const monthFilter = options.month ? new Set([options.month]) : null;
  const entries = await fs.readdir(feedRoot, { withFileTypes: true });
  const monthDirectories = entries
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .filter((month) => !monthFilter || monthFilter.has(month))
    .sort((left, right) => left.localeCompare(right));
  const articles = [];
  let feedTitle = feedSlug;

  for (const monthBucket of monthDirectories) {
    const monthRoot = path.join(feedRoot, monthBucket);
    const monthEntries = await fs.readdir(monthRoot, { withFileTypes: true });
    const markdownFiles = monthEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    for (const fileName of markdownFiles) {
      const sourcePath = path.join(monthRoot, fileName);
      const markdown = await fs.readFile(sourcePath, 'utf8');
      const parsed = parseFrontmatterDocument(markdown);
      const rawPortablePath = String(parsed.data.raw_path || '').trim();
      const rawAbsolutePath = rawPortablePath
        ? toAbsoluteFromPortable(env.weweRoot, rawPortablePath)
        : '';
      const sourceStat = await fs.stat(sourcePath);
      let rawStat = null;
      if (rawAbsolutePath) {
        try {
          rawStat = await fs.stat(rawAbsolutePath);
        } catch {
          rawStat = null;
        }
      }

      if (parsed.data.feed_title) {
        feedTitle = String(parsed.data.feed_title);
      }

      articles.push({
        feedSlug,
        feedTitle: String(parsed.data.feed_title || feedTitle || feedSlug),
        articleId: String(parsed.data.article_id || path.basename(fileName, '.md')),
        title: String(parsed.data.title || path.basename(fileName, '.md')),
        sourceUrl: String(parsed.data.source_url || parsed.data.link || ''),
        sourceArticlePath: portablePath(path.relative(env.weweRoot, sourcePath)),
        sourceRawPath: rawPortablePath,
        sourceAbsolutePath: sourcePath,
        rawAbsolutePath,
        monthBucket,
        publishedAtIso: String(
          parsed.data.publish_time ||
            parsed.data.published_at ||
            parsed.data.publish_at ||
            formatIsoTimestamp(parseTimestamp(null, sourceStat.mtime)),
        ),
        sourceMtimeMs: Math.max(sourceStat.mtimeMs, rawStat?.mtimeMs || 0),
        fallbackContent: extractArchivedArticleContentFromMarkdown(parsed.body),
      });
    }
  }

  return {
    feedSlug,
    feedTitle,
    articles: articles.sort((left, right) => left.publishedAtIso.localeCompare(right.publishedAtIso)),
    months: monthDirectories,
  };
}

async function loadArticleSourcePayload(article) {
  const rawPayload = article.rawAbsolutePath
    ? await readJsonFile(article.rawAbsolutePath, null)
    : null;
  const content = normalizeWhitespace(rawPayload?.article?.content || article.fallbackContent);

  return {
    ...article,
    rawPayload,
    content,
  };
}

function resolveArticleSelection(feed, articleQuery = '', monthBucket = '') {
  const normalizedQuery = String(articleQuery || '').trim().toLowerCase();
  const normalizedMonth = String(monthBucket || '').trim();
  const scopedArticles = normalizedMonth
    ? feed.articles.filter((item) => item.monthBucket === normalizedMonth)
    : feed.articles.slice();

  if (!normalizedQuery) {
    throw new Error('--article is required for pdf:attach');
  }

  const exactMatches = scopedArticles.filter((item) => {
    const baseName = path.basename(item.sourceArticlePath);
    const baseNameWithoutExt = baseName.replace(/\.md$/i, '');
    return (
      item.articleId.toLowerCase() === normalizedQuery ||
      item.sourceArticlePath.toLowerCase() === normalizedQuery ||
      baseName.toLowerCase() === normalizedQuery ||
      baseNameWithoutExt.toLowerCase() === normalizedQuery
    );
  });

  const suffixMatches =
    exactMatches.length > 0
      ? exactMatches
      : scopedArticles.filter((item) => {
          const baseName = path.basename(item.sourceArticlePath).toLowerCase();
          const baseNameWithoutExt = baseName.replace(/\.md$/i, '');
          return baseName.endsWith(normalizedQuery) || baseNameWithoutExt.endsWith(normalizedQuery);
        });

  const matches =
    suffixMatches.length > 0
      ? suffixMatches
      : scopedArticles.filter((item) => {
          const haystacks = [
            item.articleId,
            item.title,
            item.sourceArticlePath,
            path.basename(item.sourceArticlePath),
          ].map((value) => String(value || '').toLowerCase());
          return haystacks.some((value) => value.includes(normalizedQuery));
        });

  if (matches.length === 0) {
    const examples = scopedArticles
      .slice(0, 8)
      .map((item) => `- ${path.basename(item.sourceArticlePath)} | ${item.title}`);
    throw new Error(
      `no article matched "${articleQuery}"${normalizedMonth ? ` in ${normalizedMonth}` : ''}\n${examples.join('\n')}`
    );
  }

  if (matches.length > 1) {
    throw new Error(
      `article match is ambiguous for "${articleQuery}"\n${matches
        .slice(0, 12)
        .map((item) => `- ${path.basename(item.sourceArticlePath)} | ${item.title}`)
        .join('\n')}`
    );
  }

  return matches[0];
}

function buildFeedPaths(env, feedSlug) {
  const feedWikiRoot = path.join(env.wikisRoot, feedSlug);
  return {
    feedWikiRoot,
    articlesRoot: path.join(feedWikiRoot, 'articles'),
    projectsRoot: path.join(feedWikiRoot, 'projects'),
    monthsRoot: path.join(feedWikiRoot, 'months'),
    quartersRoot: path.join(feedWikiRoot, 'quarters'),
    outputArticlesRoot: path.join(feedWikiRoot, 'output', 'json', 'articles'),
    outputProjectsRoot: path.join(feedWikiRoot, 'output', 'json', 'projects'),
    outputMonthsRoot: path.join(feedWikiRoot, 'output', 'json', 'months'),
    outputQuartersRoot: path.join(feedWikiRoot, 'output', 'json', 'quarters'),
    pdfRoot: path.join(feedWikiRoot, 'assets', 'pdfs'),
    indexPath: path.join(feedWikiRoot, 'index.md'),
    logPath: path.join(feedWikiRoot, 'log.md'),
    agentsPath: path.join(feedWikiRoot, 'AGENTS.md'),
  };
}

function buildArticleOutputPaths(feedPaths, article) {
  const baseName = path.basename(article.sourceArticlePath);
  const jsonName = baseName.replace(/\.md$/i, '.json');
  return {
    articleMarkdownPath: path.join(feedPaths.articlesRoot, article.monthBucket, baseName),
    articleJsonPath: path.join(feedPaths.outputArticlesRoot, article.monthBucket, jsonName),
    pdfPath: path.join(feedPaths.pdfRoot, article.monthBucket, baseName.replace(/\.md$/i, '.pdf')),
  };
}

async function ensureFeedBaseFiles(env, feedSlug, feedTitle, feedSettings) {
  const feedPaths = buildFeedPaths(env, feedSlug);
  await ensureDirectory(feedPaths.feedWikiRoot, env.dryRun);
  await ensureDirectory(feedPaths.articlesRoot, env.dryRun);
  await ensureDirectory(feedPaths.projectsRoot, env.dryRun);
  await ensureDirectory(feedPaths.monthsRoot, env.dryRun);
  await ensureDirectory(feedPaths.quartersRoot, env.dryRun);
  await ensureDirectory(feedPaths.outputArticlesRoot, env.dryRun);
  await ensureDirectory(feedPaths.outputProjectsRoot, env.dryRun);
  await ensureDirectory(feedPaths.outputMonthsRoot, env.dryRun);
  await ensureDirectory(feedPaths.outputQuartersRoot, env.dryRun);
  await ensureDirectory(feedPaths.pdfRoot, env.dryRun);

  await writeTextFileIfChanged(
    feedPaths.agentsPath,
    buildFeedAgentInstructions(feedSlug, feedSettings),
    env.dryRun,
  );
  if (!(await pathExists(feedPaths.logPath))) {
    await writeTextFileIfChanged(feedPaths.logPath, buildInitialFeedLog(feedTitle), env.dryRun);
  }

  return feedPaths;
}

async function ensureHubBaseFiles(env) {
  const statusRoot = path.join(env.hubRoot, 'status');
  await ensureDirectory(env.hubRoot, env.dryRun);
  await ensureDirectory(statusRoot, env.dryRun);

  const hubLogPath = path.join(env.hubRoot, 'log.md');
  if (!(await pathExists(hubLogPath))) {
    await writeTextFileIfChanged(hubLogPath, buildInitialHubLog(), env.dryRun);
  }
}

async function listJsonFiles(rootDir) {
  if (!(await pathExists(rootDir))) {
    return [];
  }

  const result = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        result.push(absolutePath);
      }
    }
  }

  await walk(rootDir);
  return result.sort((left, right) => left.localeCompare(right));
}

async function removeStaleDerivedFiles(rootDir, keepNames, dryRun = false) {
  if (!(await pathExists(rootDir))) {
    return [];
  }

  const removed = [];
  const allowedNames = new Set(keepNames || []);
  const entries = await fs.readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    if (allowedNames.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(rootDir, entry.name);
    removed.push(absolutePath);
    if (!dryRun) {
      await fs.rm(absolutePath, { force: true });
    }
  }

  return removed.sort((left, right) => left.localeCompare(right));
}

async function loadFeedArticleOutputs(feedPaths, monthBuckets = null) {
  const jsonFiles = await listJsonFiles(feedPaths.outputArticlesRoot);
  const outputs = [];

  for (const filePath of jsonFiles) {
    const output = await readJsonFile(filePath, null);
    if (!output) {
      continue;
    }

    if (monthBuckets && !monthBuckets.has(getMonthBucket(new Date(output.published_at)))) {
      continue;
    }

    outputs.push(output);
  }

  return outputs.sort((left, right) => left.published_at.localeCompare(right.published_at));
}

async function rebuildFeedDerivedPages(env, feedSlug, feedTitle, monthsToRender) {
  const feedPaths = buildFeedPaths(env, feedSlug);
  const allArticleOutputs = await loadFeedArticleOutputs(feedPaths);
  const projectEntries = mergeProjectMentions(allArticleOutputs);
  const projectJsonNames = projectEntries.map((item) => `${item.canonical_key}.json`);
  const projectMarkdownNames = projectEntries.map((item) => `${item.canonical_key}.md`);

  for (const project of projectEntries) {
    const jsonPath = path.join(feedPaths.outputProjectsRoot, `${project.canonical_key}.json`);
    const markdownPath = path.join(feedPaths.projectsRoot, `${project.canonical_key}.md`);
    await writeJsonFileAtomic(jsonPath, project, env.dryRun);
    await writeTextFileIfChanged(markdownPath, buildProjectMarkdown(project), env.dryRun);
  }

  await removeStaleDerivedFiles(feedPaths.outputProjectsRoot, projectJsonNames, env.dryRun);
  await removeStaleDerivedFiles(feedPaths.projectsRoot, projectMarkdownNames, env.dryRun);

  const allMonthBuckets = dedupe(allArticleOutputs.map((item) => getMonthBucket(new Date(item.published_at)))).sort();
  const targetMonths = monthsToRender && monthsToRender.size > 0 ? monthsToRender : new Set(allMonthBuckets);
  const monthAggregates = [];

  for (const monthBucket of allMonthBuckets) {
    const monthOutputs = allArticleOutputs.filter(
      (item) => getMonthBucket(new Date(item.published_at)) === monthBucket,
    );
    const monthAggregate = buildMonthAggregate(feedSlug, feedTitle, monthBucket, monthOutputs, projectEntries);
    monthAggregates.push(monthAggregate);

    if (targetMonths.has(monthBucket)) {
      const jsonPath = path.join(feedPaths.outputMonthsRoot, `${monthBucket}.json`);
      const markdownPath = path.join(feedPaths.monthsRoot, `${monthBucket}.md`);
      await writeJsonFileAtomic(jsonPath, monthAggregate, env.dryRun);
      await writeTextFileIfChanged(markdownPath, buildMonthMarkdown(monthAggregate), env.dryRun);
    }
  }

  await removeStaleDerivedFiles(
    feedPaths.outputMonthsRoot,
    allMonthBuckets.map((item) => `${item}.json`),
    env.dryRun,
  );
  await removeStaleDerivedFiles(
    feedPaths.monthsRoot,
    allMonthBuckets.map((item) => `${item}.md`),
    env.dryRun,
  );

  const targetQuarterKeys = new Set(Array.from(targetMonths).map((item) => buildQuarterKey(item)));
  const quarterKeys = dedupe(monthAggregates.map((item) => buildQuarterKey(item.month_bucket))).sort();

  for (const quarterKey of quarterKeys) {
    const quarterMonths = monthAggregates.filter((item) => buildQuarterKey(item.month_bucket) === quarterKey);
    const quarterAggregate = buildQuarterAggregate(feedSlug, feedTitle, quarterKey, quarterMonths);
    if (targetQuarterKeys.has(quarterKey)) {
      const jsonPath = path.join(feedPaths.outputQuartersRoot, `${quarterKey}.json`);
      const markdownPath = path.join(feedPaths.quartersRoot, `${quarterKey}.md`);
      await writeJsonFileAtomic(jsonPath, quarterAggregate, env.dryRun);
      await writeTextFileIfChanged(markdownPath, buildQuarterMarkdown(quarterAggregate), env.dryRun);
    }
  }

  await removeStaleDerivedFiles(
    feedPaths.outputQuartersRoot,
    quarterKeys.map((item) => `${item}.json`),
    env.dryRun,
  );
  await removeStaleDerivedFiles(
    feedPaths.quartersRoot,
    quarterKeys.map((item) => `${item}.md`),
    env.dryRun,
  );

  const feedSummary = {
    feed_slug: feedSlug,
    feed_title: feedTitle,
    article_count: allArticleOutputs.length,
    project_count: projectEntries.length,
    months: allMonthBuckets.slice().sort((left, right) => right.localeCompare(left)),
    quarters: quarterKeys.slice().sort((left, right) => right.localeCompare(left)),
  };
  await writeTextFileIfChanged(
    feedPaths.indexPath,
    buildFeedIndexMarkdown(feedSummary, feedPaths.indexPath),
    env.dryRun,
  );

  return {
    articleCount: allArticleOutputs.length,
    projectCount: projectEntries.length,
    months: allMonthBuckets,
    quarters: quarterKeys,
  };
}

async function buildRegistry(env, sourceFeeds, wikiState) {
  const registry = {
    version: REGISTRY_VERSION,
    generated_at: formatIsoTimestamp(new Date()),
    feeds: [],
  };

  for (const sourceFeed of sourceFeeds) {
    const feedPaths = buildFeedPaths(env, sourceFeed.feedSlug);
    const generatedArticleCount = (await listJsonFiles(feedPaths.outputArticlesRoot)).length;
    const generatedProjectCount = (await listJsonFiles(feedPaths.outputProjectsRoot)).length;
    const feedState = wikiState.feeds[sourceFeed.feedSlug] || { articles: {} };
    const settings = env.config.feeds?.[sourceFeed.feedSlug] || {};

    registry.feeds.push({
      slug: sourceFeed.feedSlug,
      title: settings.display_name || sourceFeed.feedTitle || sourceFeed.feedSlug,
      enabled: Boolean(settings.enabled),
      source_article_count: sourceFeed.articles.length,
      month_count: sourceFeed.months.length,
      generated_article_count: generatedArticleCount,
      generated_project_count: generatedProjectCount,
      source_path: portablePath(path.join(env.weweRoot, sourceFeed.feedSlug)),
      wiki_path: portablePath(feedPaths.feedWikiRoot),
      last_run_at: feedState.lastRunAt || '',
      last_lint_at: feedState.lastLintAt || '',
    });
  }

  registry.feeds.sort((left, right) => left.slug.localeCompare(right.slug));
  return registry;
}

async function writeHubFiles(env, registry, lintByFeed = {}) {
  const hubIndexPath = path.join(env.hubRoot, 'index.md');
  const hubFeedsPath = path.join(env.hubRoot, 'feeds.md');

  await writeTextFileIfChanged(
    hubIndexPath,
    buildHubIndexMarkdown(registry, hubIndexPath),
    env.dryRun,
  );
  await writeTextFileIfChanged(
    hubFeedsPath,
    buildHubFeedsMarkdown(registry, hubFeedsPath),
    env.dryRun,
  );

  for (const feedEntry of registry.feeds) {
    const statusPath = path.join(env.hubRoot, 'status', `${feedEntry.slug}.md`);
    const lintSummary = lintByFeed[feedEntry.slug] || null;
    await writeTextFileIfChanged(statusPath, buildFeedStatusMarkdown(feedEntry, lintSummary), env.dryRun);
  }
}

async function writeRunReport(env, command, summary) {
  const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${command}.json`;
  const filePath = path.join(env.runsRoot, fileName);
  await ensureDirectory(env.runsRoot, env.dryRun);
  await writeJsonFileAtomic(filePath, summary, env.dryRun);
}

function feedSettingsFor(env, feedSlug) {
  return {
    enabled: false,
    display_name: feedSlug,
    classifier: 'generic',
    provider: env.config.providers?.default || 'local-rules',
    fallback_provider: env.config.providers?.fallback || 'local-rules',
    glm_manual_enabled: false,
    glm_manual_provider: 'glm_coding_manual',
    glm_primary_model: DEFAULT_GLM_MANUAL_PRIMARY_MODEL,
    glm_fallback_models: DEFAULT_GLM_MANUAL_FALLBACK_MODELS.slice(),
    project_extraction: false,
    pdf_enabled: false,
    pdf_auto_sync_enabled: false,
    pdf_auto_sync_initial_lookback_days: DEFAULT_PDF_SYNC_INITIAL_LOOKBACK_DAYS,
    pdf_policy: 'disabled',
    pdf_source_strategy: 'download_then_print',
    pdf_auth_strategy: '',
    pdf_browser_channel: 'chromium',
    pdf_profile_name: feedSlug,
    pdf_user_data_dir: '',
    pdf_profile_directory: '',
    ...(env.config.feeds?.[feedSlug] || {}),
  };
}

async function processFeedArticle(env, feedPaths, article, feedSettings, analysisOptions = {}) {
  const articleSource = await loadArticleSourcePayload(article);
  const analysis = await analyzeArticle(articleSource, env, feedSettings, analysisOptions);
  const outputPaths = buildArticleOutputPaths(feedPaths, articleSource);
  const rawPdfResult = await renderPdfIfNeeded({
    env,
    article: articleSource,
    analysis,
    rawPayload: articleSource.rawPayload,
    pdfPath: outputPaths.pdfPath,
    feedSettings,
    dryRun: env.dryRun,
  });
  const pdfResult = {
    ...rawPdfResult,
    pdf_path: rawPdfResult.pdf_path ? portablePath(path.relative(env.weweRoot, outputPaths.pdfPath)) : '',
  };
  const articleOutput = buildSourceArticleOutputJson(articleSource, analysis, pdfResult, outputPaths);
  const articleMarkdown = buildArticleMarkdownDocument(articleOutput, {
    ...outputPaths,
    sourceArticleAbsolutePath: articleSource.sourceAbsolutePath,
    pdfAbsolutePath: rawPdfResult.pdf_path ? outputPaths.pdfPath : '',
  });

  const jsonWrite = await writeJsonFileAtomic(outputPaths.articleJsonPath, articleOutput, env.dryRun);
  const markdownWrite = await writeTextFileIfChanged(
    outputPaths.articleMarkdownPath,
    articleMarkdown,
    env.dryRun,
  );

  return {
    articleOutput,
    outputPaths,
    written: jsonWrite.written || markdownWrite.written,
  };
}

async function shouldRetryPdfGeneration(env, outputPaths, feedSettings) {
  if (!isPdfToolEnabled(feedSettings) || String(feedSettings.pdf_policy || 'disabled') === 'disabled') {
    return false;
  }

  const articleOutput = await readJsonFile(outputPaths.articleJsonPath, null);
  if (!articleOutput || typeof articleOutput !== 'object') {
    return false;
  }

  if (articleOutput.pdf_status === 'generated') {
    if (!articleOutput.pdf_path) {
      return true;
    }

    return !(await pathExists(toAbsoluteFromPortable(env.weweRoot, articleOutput.pdf_path)));
  }

  if (articleOutput.pdf_status === 'dependency_missing') {
    const pdfRuntime = await getPdfRuntimeStatus(env);
    return pdfRuntime.available;
  }

  if (articleOutput.pdf_status === 'failed') {
    return true;
  }

  return false;
}

function getPdfSyncActivityMs(article, articleOutput, feedStateArticle) {
  const candidates = [article?.sourceMtimeMs];

  if (articleOutput?.generated_at) {
    candidates.push(Date.parse(articleOutput.generated_at));
  }

  if (feedStateArticle?.generatedAt) {
    candidates.push(Date.parse(feedStateArticle.generatedAt));
  }

  return Math.max(
    0,
    ...candidates.filter((value) => Number.isFinite(value) && value > 0),
  );
}

function getPdfSyncPublishedWindowMs(article, articleOutput, feedStateArticle) {
  const candidates = [Date.parse(article?.publishedAtIso || '')];

  if (articleOutput?.generated_at) {
    candidates.push(Date.parse(articleOutput.generated_at));
  }

  if (feedStateArticle?.generatedAt) {
    candidates.push(Date.parse(feedStateArticle.generatedAt));
  }

  return Math.max(
    0,
    ...candidates.filter((value) => Number.isFinite(value) && value > 0),
  );
}

function resolvePdfSyncWindow(feedState, feedSettings, options = {}) {
  if (options.month) {
    return {
      scanMode: 'month',
      windowBasis: 'all',
      windowStartMs: Number.NEGATIVE_INFINITY,
      windowStartAt: '',
      lastPdfSyncAt: String(feedState?.pdfSync?.lastRunAt || ''),
    };
  }

  const lastPdfSyncAt = String(feedState?.pdfSync?.lastRunAt || '').trim();
  const lastPdfSyncMs = lastPdfSyncAt ? Date.parse(lastPdfSyncAt) : NaN;
  if (Number.isFinite(lastPdfSyncMs) && lastPdfSyncMs > 0) {
    return {
      scanMode: 'incremental',
      windowBasis: 'activity',
      windowStartMs: lastPdfSyncMs,
      windowStartAt: formatIsoTimestamp(new Date(lastPdfSyncMs)),
      lastPdfSyncAt,
    };
  }

  const lookbackDays = getPdfAutoSyncInitialLookbackDays(feedSettings);
  const windowStartMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  return {
    scanMode: 'incremental_initial',
    windowBasis: 'published',
    windowStartMs,
    windowStartAt: formatIsoTimestamp(new Date(windowStartMs)),
    lastPdfSyncAt: '',
  };
}

async function updatePdfSyncState(env, feedSlug, patch = {}) {
  if (env.dryRun) {
    return;
  }

  const feedState = env.state.feeds[feedSlug] || { articles: {} };
  feedState.pdfSync = {
    ...(feedState.pdfSync || {}),
    ...patch,
  };
  env.state.feeds[feedSlug] = feedState;
  await writeFeedStateSnapshot(env, feedSlug);
}

async function executeFeedRun(env, sourceFeed, options = {}) {
  const feedSettings = feedSettingsFor(env, sourceFeed.feedSlug);
  const feedState = env.state.feeds[sourceFeed.feedSlug] || { articles: {} };
  const feedPaths = await ensureFeedBaseFiles(
    env,
    sourceFeed.feedSlug,
    feedSettings.display_name || sourceFeed.feedTitle,
    feedSettings,
  );
  const changedMonths = new Set();
  const summary = {
    feed: sourceFeed.feedSlug,
    processed: 0,
    skipped: 0,
    failures: 0,
    failures_by_article: [],
    changed_months: [],
  };

  for (const article of sourceFeed.articles) {
    const existingState = feedState.articles[article.articleId];
    const outputPaths = buildArticleOutputPaths(feedPaths, article);
    const outputsExist =
      (await pathExists(outputPaths.articleJsonPath)) && (await pathExists(outputPaths.articleMarkdownPath));
    const manualNewOnly = Boolean(options.newOnly);
    const shouldProcess =
      (manualNewOnly && (!existingState || !outputsExist)) ||
      (!manualNewOnly &&
        (options.force ||
      (options.forcePdf && String(feedSettings.pdf_policy || 'disabled') !== 'disabled') ||
      !existingState ||
      existingState.sourceMtimeMs !== article.sourceMtimeMs ||
      !outputsExist ||
      (await shouldRetryPdfGeneration(env, outputPaths, feedSettings))));

    if (!shouldProcess) {
      summary.skipped += 1;
      continue;
    }

    try {
      const result = await processFeedArticle(
        env,
        feedPaths,
        article,
        feedSettings,
        options.analysisOptions || {},
      );
      changedMonths.add(article.monthBucket);
      summary.processed += 1;
      feedState.articles[article.articleId] = {
        sourceMtimeMs: article.sourceMtimeMs,
        monthBucket: article.monthBucket,
        generatedAt: formatIsoTimestamp(new Date()),
        articleType: result.articleOutput.article_type,
        articleJsonPath: portablePath(result.outputPaths.articleJsonPath),
        articleMarkdownPath: portablePath(result.outputPaths.articleMarkdownPath),
      };
    } catch (error) {
      summary.failures += 1;
      summary.failures_by_article.push({
        article_id: article.articleId,
        title: article.title,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  feedState.lastRunAt = formatIsoTimestamp(new Date());
  env.state.feeds[sourceFeed.feedSlug] = feedState;
  await writeFeedStateSnapshot(env, sourceFeed.feedSlug);
  summary.changed_months = Array.from(changedMonths).sort((left, right) => left.localeCompare(right));

  if (changedMonths.size > 0 || options.renderOnly) {
    await rebuildFeedDerivedPages(
      env,
      sourceFeed.feedSlug,
      feedSettings.display_name || sourceFeed.feedTitle,
      changedMonths.size > 0 ? changedMonths : new Set(sourceFeed.months),
    );
  }

  const logLines = [
    `- processed: ${summary.processed}`,
    `- skipped: ${summary.skipped}`,
    `- failures: ${summary.failures}`,
    `- months: ${summary.changed_months.join(', ') || 'none'}`,
  ];
  if (summary.failures_by_article.length > 0) {
    logLines.push(...summary.failures_by_article.map((item) => `- failed: ${item.title} | ${item.error}`));
  }
  await appendLogEntry(feedPaths.logPath, options.logAction || 'ingest', logLines, env.dryRun);

  return summary;
}

function estimateGlmUnits(articleCount, options = {}) {
  const fallbackRate = Number.isFinite(Number(options.fallbackRate))
    ? Number(options.fallbackRate)
    : DEFAULT_GLM_MANUAL_FALLBACK_RATE;
  const offPeakPrimaryUnits = articleCount * DEFAULT_GLM5_OFF_PEAK_MULTIPLIER;
  const peakPrimaryUnits = articleCount * DEFAULT_GLM5_PEAK_MULTIPLIER;
  const conservativeOffPeakUnits = Number(
    (offPeakPrimaryUnits + articleCount * fallbackRate * DEFAULT_GLM_FALLBACK_MULTIPLIER).toFixed(1),
  );
  const conservativePeakUnits = Number(
    (peakPrimaryUnits + articleCount * fallbackRate * DEFAULT_GLM_FALLBACK_MULTIPLIER).toFixed(1),
  );

  return {
    article_count: articleCount,
    fallback_rate: fallbackRate,
    glm5_off_peak_units: offPeakPrimaryUnits,
    glm5_peak_units: peakPrimaryUnits,
    conservative_off_peak_units: conservativeOffPeakUnits,
    conservative_peak_units: conservativePeakUnits,
    conservative_selected_units: options.assumePeak ? conservativePeakUnits : conservativeOffPeakUnits,
  };
}

function getGlmCapabilitiesCachePath(env) {
  return path.join(env.stateRoot, 'cache', GLM_CAPABILITIES_CACHE_NAME);
}

async function writeGlmCapabilitiesCache(env, feedSlug, payload) {
  const cachePath = getGlmCapabilitiesCachePath(env);
  const currentCache = (await readJsonFile(cachePath, {})) || {};
  currentCache[feedSlug] = payload;
  await writeJsonFileAtomic(cachePath, currentCache, env.dryRun);
  return cachePath;
}

function summarizeGlmBatchGuard(articleCount) {
  return {
    warning: articleCount > 50,
    requires_allow_large_batch: articleCount > 100,
  };
}

function buildSelectedFeedSlice(sourceFeed, month) {
  if (!month) {
    return sourceFeed;
  }

  return {
    ...sourceFeed,
    articles: sourceFeed.articles.filter((item) => item.monthBucket === month),
    months: sourceFeed.months.filter((item) => item === month),
  };
}

async function executeGlmProbe(env, sourceFeed) {
  const feedSettings = feedSettingsFor(env, sourceFeed.feedSlug);
  if (!feedSettings.glm_manual_enabled) {
    throw new Error(`GLM manual mode is not enabled for ${sourceFeed.feedSlug}`);
  }

  const route = resolveGlmManualRoute(env, feedSettings);
  const testedModels = dedupe([
    ...route.models.flatMap((item) => expandManualModelCandidates(item)),
    ...GLM_PROBE_MODEL_CANDIDATES,
  ]);
  const supportedModels = [];
  const rejectedModels = [];
  const errorByModel = {};

  for (const modelName of testedModels) {
    try {
      await probeOpenAiCompatibleModel({
        providerConfig: route.providerConfig,
        providerName: route.providerName,
        providerModel: modelName,
        timeoutMs: route.timeoutMs,
      });
      supportedModels.push(modelName);
    } catch (error) {
      rejectedModels.push(modelName);
      errorByModel[modelName] = getErrorMessage(error);
      if (isTerminalProviderError(error)) {
        break;
      }
    }
  }

  const cachePayload = {
    endpoint: buildOpenAiCompatibleEndpoint(
      resolveProviderField(route.providerConfig, 'base_url') || DEFAULT_GLM_MANUAL_BASE_URL,
    ),
    tested_at: formatIsoTimestamp(new Date()),
    provider: route.providerName,
    configured_models: route.models,
    supported_models: supportedModels,
    rejected_models: rejectedModels,
    error_by_model: errorByModel,
  };
  const cachePath = await writeGlmCapabilitiesCache(env, sourceFeed.feedSlug, cachePayload);

  return {
    feed: sourceFeed.feedSlug,
    ...cachePayload,
    cache_path: portablePath(cachePath),
  };
}

async function executeGlmEstimate(env, sourceFeed, cliArgs) {
  const feedSettings = feedSettingsFor(env, sourceFeed.feedSlug);
  if (!feedSettings.glm_manual_enabled) {
    throw new Error(`GLM manual mode is not enabled for ${sourceFeed.feedSlug}`);
  }

  const selectedFeed = buildSelectedFeedSlice(sourceFeed, cliArgs.month);
  const estimate = estimateGlmUnits(selectedFeed.articles.length, {
    assumePeak: cliArgs.assumePeak,
  });
  const batchGuard = summarizeGlmBatchGuard(selectedFeed.articles.length);

  return {
    feed: sourceFeed.feedSlug,
    month: cliArgs.month || '',
    models: [
      String(feedSettings.glm_primary_model || DEFAULT_GLM_MANUAL_PRIMARY_MODEL).trim(),
      ...((Array.isArray(feedSettings.glm_fallback_models)
        ? feedSettings.glm_fallback_models
        : DEFAULT_GLM_MANUAL_FALLBACK_MODELS
      ).map((item) => String(item || '').trim()).filter(Boolean)),
    ],
    ...estimate,
    ...batchGuard,
    assume_peak: Boolean(cliArgs.assumePeak),
  };
}

async function executeGlmRun(env, sourceFeed, cliArgs) {
  if (!isInteractiveTerminal(cliArgs)) {
    throw new Error('wiki:glm:run requires an interactive terminal');
  }

  const feedSettings = feedSettingsFor(env, sourceFeed.feedSlug);
  if (!feedSettings.glm_manual_enabled) {
    throw new Error(`GLM manual mode is not enabled for ${sourceFeed.feedSlug}`);
  }

  const selectedFeed = buildSelectedFeedSlice(sourceFeed, cliArgs.month);
  const batchGuard = summarizeGlmBatchGuard(selectedFeed.articles.length);
  if (batchGuard.requires_allow_large_batch && !cliArgs.allowLargeBatch) {
    throw new Error(
      `glm batch too large: ${selectedFeed.articles.length} articles selected; pass --allow-large-batch to continue`,
    );
  }

  const runSummary = await executeFeedRun(env, selectedFeed, {
    force: !cliArgs.newOnly,
    newOnly: cliArgs.newOnly,
    analysisOptions: { mode: 'glm-manual' },
    logAction: 'glm-manual',
  });

  return {
    ...runSummary,
    month: cliArgs.month || '',
    new_only: Boolean(cliArgs.newOnly),
    allow_large_batch: Boolean(cliArgs.allowLargeBatch),
    ...estimateGlmUnits(selectedFeed.articles.length, {
      assumePeak: Boolean(cliArgs.assumePeak),
    }),
    ...batchGuard,
  };
}

async function buildPdfSyncPlan(env, sourceFeed, options = {}) {
  const feedSettings = feedSettingsFor(env, sourceFeed.feedSlug);
  const feedState = env.state.feeds[sourceFeed.feedSlug] || { articles: {}, pdfSync: {} };
  const feedPaths = await ensureFeedBaseFiles(
    env,
    sourceFeed.feedSlug,
    feedSettings.display_name || sourceFeed.feedTitle,
    feedSettings,
  );
  const relevantArticles = options.month
    ? sourceFeed.articles.filter((item) => item.monthBucket === options.month)
    : sourceFeed.articles.slice();
  const syncWindow = resolvePdfSyncWindow(feedState, feedSettings, options);
  const plan = {
    feed: sourceFeed.feedSlug,
    allowed: isPdfToolEnabled(feedSettings),
    auto_sync_enabled: isPdfAutoSyncEnabled(feedSettings),
    new_only: Boolean(options.newOnly),
    scan_mode: syncWindow.scanMode,
    last_pdf_sync_at: syncWindow.lastPdfSyncAt,
    window_start_at: syncWindow.windowStartAt,
    article_count_scanned: relevantArticles.length,
    generated_count: 0,
    manual_import_count: 0,
    skipped_count: 0,
    pending_new_count: 0,
    pending_retry_count: 0,
    deferred_count: 0,
    blocked_count: 0,
    pending_articles: [],
  };

  if (!isPdfToolEnabled(feedSettings) || String(feedSettings.pdf_policy || 'disabled') === 'disabled') {
    plan.blocked_count = relevantArticles.length;
    return { plan, pendingArticles: [], feedSettings };
  }

  for (const article of relevantArticles) {
    const outputPaths = buildArticleOutputPaths(feedPaths, article);
    const articleOutput = await readJsonFile(outputPaths.articleJsonPath, null);
    const feedStateArticle = feedState.articles?.[article.articleId] || null;
    const comparableMs =
      syncWindow.windowBasis === 'published'
        ? getPdfSyncPublishedWindowMs(article, articleOutput, feedStateArticle)
        : syncWindow.windowBasis === 'activity'
          ? getPdfSyncActivityMs(article, articleOutput, feedStateArticle)
          : Number.POSITIVE_INFINITY;
    const isInSyncWindow =
      syncWindow.scanMode === 'month' || comparableMs >= syncWindow.windowStartMs;

    if (!articleOutput || typeof articleOutput !== 'object') {
      if (isInSyncWindow) {
        plan.pending_new_count += 1;
        plan.pending_articles.push({
          article_id: article.articleId,
          title: article.title,
          month: article.monthBucket,
          article: path.basename(article.sourceArticlePath),
          status: 'pending_new',
        });
      } else {
        plan.deferred_count += 1;
      }
      continue;
    }

    if (articleOutput.pdf_status === 'generated') {
      const pdfExists =
        articleOutput.pdf_path &&
        (await pathExists(toAbsoluteFromPortable(env.weweRoot, articleOutput.pdf_path)));
      if (pdfExists) {
        plan.generated_count += 1;
        if (articleOutput.pdf_method === 'manual_import') {
          plan.manual_import_count += 1;
        }
        continue;
      }
    }

    if (articleOutput.pdf_status === 'skipped') {
      plan.skipped_count += 1;
      continue;
    }

    if (
      options.newOnly &&
      (articleOutput.pdf_status === 'failed' || articleOutput.pdf_status === 'dependency_missing')
    ) {
      plan.blocked_count += 1;
      continue;
    }

    if (await shouldRetryPdfGeneration(env, outputPaths, feedSettings)) {
      if (isInSyncWindow) {
        plan.pending_retry_count += 1;
        plan.pending_articles.push({
          article_id: article.articleId,
          title: article.title,
          month: article.monthBucket,
          article: path.basename(article.sourceArticlePath),
          status: 'pending_retry',
          pdf_status: articleOutput.pdf_status || '',
        });
      } else {
        plan.deferred_count += 1;
      }
      continue;
    }

    plan.blocked_count += 1;
    plan.pending_articles.push({
      article_id: article.articleId,
      title: article.title,
      month: article.monthBucket,
      article: path.basename(article.sourceArticlePath),
      status: 'blocked',
      pdf_status: articleOutput.pdf_status || '',
    });
  }

  return {
    plan,
    pendingArticles: relevantArticles.filter((article) =>
      plan.pending_articles.some((item) => item.article_id === article.articleId && item.status !== 'blocked')
    ),
    feedSettings,
  };
}

async function executePdfSync(env, sourceFeed, cliArgs = {}) {
  const { plan, pendingArticles, feedSettings } = await buildPdfSyncPlan(env, sourceFeed, cliArgs);

  if (!isPdfToolEnabled(feedSettings)) {
    return {
      ...plan,
      sync_status: 'not_allowed',
      processed: 0,
      skipped: 0,
      failures: 0,
      changed_months: [],
    };
  }

  if (!pendingArticles.length) {
    await updatePdfSyncState(env, sourceFeed.feedSlug, {
      lastRunAt: formatIsoTimestamp(new Date()),
      lastScanMode: plan.scan_mode,
      lastWindowStartAt: plan.window_start_at,
    });

    return {
      ...plan,
      sync_status: 'up_to_date',
      processed: 0,
      skipped: plan.article_count_scanned,
      failures: 0,
      changed_months: [],
    };
  }

  const filteredFeed = {
    ...sourceFeed,
    articles: pendingArticles,
    months: dedupe(pendingArticles.map((item) => item.monthBucket)).sort(),
  };
  const runSummary = await executeFeedRun(env, filteredFeed, {
    force: false,
    forcePdf: true,
  });

  await updatePdfSyncState(env, sourceFeed.feedSlug, {
    lastRunAt: formatIsoTimestamp(new Date()),
    lastScanMode: plan.scan_mode,
    lastWindowStartAt: plan.window_start_at,
  });

  return {
    ...plan,
    sync_status: 'processed',
    processed: runSummary.processed,
    skipped: runSummary.skipped,
    failures: runSummary.failures,
    failures_by_article: runSummary.failures_by_article,
    changed_months: runSummary.changed_months,
    pending_articles: plan.pending_articles.slice(0, 20),
  };
}

async function executePdfLogin(env, sourceFeed, cliArgs = {}) {
  const feedSettings = feedSettingsFor(env, sourceFeed.feedSlug);
  if (!isPdfToolEnabled(feedSettings)) {
    throw new Error(`pdf tool is not enabled for feed: ${sourceFeed.feedSlug}`);
  }
  const feedPaths = await ensureFeedBaseFiles(
    env,
    sourceFeed.feedSlug,
    feedSettings.display_name || sourceFeed.feedTitle,
    feedSettings,
  );
  const targetUrl =
    String(cliArgs.url || feedSettings.pdf_login_url || '').trim() ||
    sourceFeed.articles.find((item) => !cliArgs.month || item.monthBucket === cliArgs.month)?.sourceUrl ||
    '';

  if (!targetUrl) {
    throw new Error('no login url resolved; pass --url or ensure the feed has source_url entries');
  }

  const session = await openPdfBrowserSession(env, sourceFeed.feedSlug, feedSettings, {
    headless: false,
    forcePersistent: true,
    channel: cliArgs.channel,
    profileName: cliArgs.profile,
    userDataDir: cliArgs.userDataDir,
    profileDirectory: cliArgs.profileDirectory,
  });

  if (!session.ok) {
    throw new Error(session.warning || 'unable to open browser for pdf login');
  }

  try {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error('pdf login requires an interactive terminal');
    }

    const page = session.context.pages()[0] || (await session.context.newPage());
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    console.log(`Opened login page: ${targetUrl}`);
    console.log('Complete login in the opened browser window, then press Enter here to save the session.');

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      await rl.question('Press Enter when the authenticated session is ready...');
    } finally {
      rl.close();
    }

    await ensureDirectory(session.profilePaths.userDataDir, env.dryRun);
    await session.context.storageState({ path: session.profilePaths.storageStatePath });

    await appendLogEntry(
      feedPaths.logPath,
      'pdf:login',
      [
        `- url: ${targetUrl}`,
        `- profile: ${session.profilePaths.profileName}`,
        `- user_data_dir: ${portablePath(session.profilePaths.userDataDir)}`,
        `- profile_directory: ${session.profilePaths.profileDirectory || '(default)'}`,
        `- storage_state: ${portablePath(session.profilePaths.storageStatePath)}`,
      ],
      env.dryRun,
    );

    return {
      feed: sourceFeed.feedSlug,
      url: targetUrl,
      profile: session.profilePaths.profileName,
      user_data_dir: portablePath(session.profilePaths.userDataDir),
      profile_directory: session.profilePaths.profileDirectory || '',
      storage_state_path: portablePath(session.profilePaths.storageStatePath),
    };
  } finally {
    await session.close();
  }
}

async function executePdfAttach(env, sourceFeed, cliArgs = {}) {
  if (!cliArgs.file) {
    throw new Error('--file is required for pdf:attach');
  }

  const sourcePdfPath = path.resolve(String(cliArgs.file || '').trim());
  let sourcePdfBuffer;
  try {
    sourcePdfBuffer = await fs.readFile(sourcePdfPath);
  } catch (error) {
    throw new Error(`unable to read pdf file: ${sourcePdfPath} | ${getErrorMessage(error)}`);
  }

  if (!sourcePdfBuffer.slice(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new Error(`file is not a valid pdf: ${sourcePdfPath}`);
  }

  const feedSettings = feedSettingsFor(env, sourceFeed.feedSlug);
  if (!isPdfToolEnabled(feedSettings)) {
    throw new Error(`pdf tool is not enabled for feed: ${sourceFeed.feedSlug}`);
  }
  const feedPaths = await ensureFeedBaseFiles(
    env,
    sourceFeed.feedSlug,
    feedSettings.display_name || sourceFeed.feedTitle,
    feedSettings,
  );
  const article = resolveArticleSelection(sourceFeed, cliArgs.article, cliArgs.month);
  const outputPaths = buildArticleOutputPaths(feedPaths, article);
  const existingOutput = await readJsonFile(outputPaths.articleJsonPath, null);
  const articleSource = await loadArticleSourcePayload(article);
  const analysis =
    existingOutput && typeof existingOutput === 'object'
      ? {
          article_type: existingOutput.article_type,
          summary: existingOutput.summary,
          key_points: Array.isArray(existingOutput.key_points) ? existingOutput.key_points : [],
          projects: Array.isArray(existingOutput.projects) ? existingOutput.projects : [],
          repo_urls: Array.isArray(existingOutput.repo_urls) ? existingOutput.repo_urls : [],
          paper_urls: Array.isArray(existingOutput.paper_urls) ? existingOutput.paper_urls : [],
          warnings: stripPdfWarnings(existingOutput.warnings),
          confidence: Number(existingOutput.confidence || 0),
          review_status: existingOutput.review_status || 'auto_generated',
          provider: existingOutput.provider || 'local-rules',
          model: existingOutput.model || 'manual-import',
        }
      : await analyzeArticle(articleSource, env, feedSettings);

  if (!env.dryRun) {
    await ensureDirectory(path.dirname(outputPaths.pdfPath));
    await fs.copyFile(sourcePdfPath, outputPaths.pdfPath);
  }

  const pdfResult = {
    pdf_status: 'generated',
    pdf_path: portablePath(path.relative(env.weweRoot, outputPaths.pdfPath)),
    pdf_method: 'manual_import',
    pdf_source_url: String(cliArgs.url || existingOutput?.pdf_source_url || article.sourceUrl || '').trim(),
  };
  const articleOutput = buildSourceArticleOutputJson(articleSource, analysis, pdfResult, outputPaths);
  const articleMarkdown = buildArticleMarkdownDocument(articleOutput, {
    articleMarkdownPath: outputPaths.articleMarkdownPath,
    sourceArticleAbsolutePath: article.sourceAbsolutePath,
    pdfAbsolutePath: outputPaths.pdfPath,
  });

  await writeJsonFileAtomic(outputPaths.articleJsonPath, articleOutput, env.dryRun);
  await writeTextFileIfChanged(outputPaths.articleMarkdownPath, articleMarkdown, env.dryRun);

  const feedState = env.state.feeds[sourceFeed.feedSlug] || { articles: {} };
  feedState.articles[article.articleId] = {
    sourceMtimeMs: article.sourceMtimeMs,
    monthBucket: article.monthBucket,
    generatedAt: formatIsoTimestamp(new Date()),
    articleType: articleOutput.article_type,
    articleJsonPath: portablePath(outputPaths.articleJsonPath),
    articleMarkdownPath: portablePath(outputPaths.articleMarkdownPath),
  };
  feedState.lastRunAt = formatIsoTimestamp(new Date());
  env.state.feeds[sourceFeed.feedSlug] = feedState;
  await writeFeedStateSnapshot(env, sourceFeed.feedSlug);
  await rebuildFeedDerivedPages(
    env,
    sourceFeed.feedSlug,
    feedSettings.display_name || sourceFeed.feedTitle,
    new Set([article.monthBucket]),
  );

  await appendLogEntry(
    feedPaths.logPath,
    'pdf:attach',
    [
      `- article: ${path.basename(article.sourceArticlePath)}`,
      `- title: ${article.title}`,
      `- imported_from: ${portablePath(sourcePdfPath)}`,
      `- pdf_path: ${portablePath(outputPaths.pdfPath)}`,
      `- pdf_source_url: ${pdfResult.pdf_source_url || '(none)'}`,
    ],
    env.dryRun,
  );

  return {
    feed: sourceFeed.feedSlug,
    article_id: article.articleId,
    article: path.basename(article.sourceArticlePath),
    title: article.title,
    month: article.monthBucket,
    imported_from: portablePath(sourcePdfPath),
    pdf_path: portablePath(outputPaths.pdfPath),
    pdf_method: pdfResult.pdf_method,
    pdf_source_url: pdfResult.pdf_source_url,
  };
}

async function lintFeed(env, sourceFeed) {
  const feedPaths = buildFeedPaths(env, sourceFeed.feedSlug);
  const issues = [];
  const articleOutputs = await loadFeedArticleOutputs(feedPaths);
  const projectFiles = await listJsonFiles(feedPaths.outputProjectsRoot);
  const monthFiles = await listJsonFiles(feedPaths.outputMonthsRoot);
  const quarterFiles = await listJsonFiles(feedPaths.outputQuartersRoot);
  const articleIds = new Set();

  for (const articleOutput of articleOutputs) {
    if (articleIds.has(articleOutput.article_id)) {
      issues.push(`duplicate article output: ${articleOutput.article_id}`);
    }
    articleIds.add(articleOutput.article_id);

    const sourceArticleAbsolute = toAbsoluteFromPortable(env.weweRoot, articleOutput.source_article_path);
    if (!(await pathExists(sourceArticleAbsolute))) {
      issues.push(`missing source article: ${articleOutput.source_article_path}`);
    }

    if (articleOutput.pdf_status === 'generated' && articleOutput.pdf_path) {
      const pdfAbsolute = path.join(env.weweRoot, portablePath(articleOutput.pdf_path));
      if (!(await pathExists(pdfAbsolute))) {
        issues.push(`missing pdf file: ${articleOutput.pdf_path}`);
      }
    }
  }

  if (articleOutputs.length > 0 && projectFiles.length === 0) {
    issues.push('article outputs exist but no project json files were generated');
  }

  const expectedMonths = new Set(
    articleOutputs.map((item) => getMonthBucket(new Date(item.published_at))),
  );
  for (const monthBucket of expectedMonths) {
    const monthJsonPath = path.join(feedPaths.outputMonthsRoot, `${monthBucket}.json`);
    const monthMarkdownPath = path.join(feedPaths.monthsRoot, `${monthBucket}.md`);
    if (!(await pathExists(monthJsonPath)) || !(await pathExists(monthMarkdownPath))) {
      issues.push(`missing month output: ${monthBucket}`);
    }
  }

  const quarterKeys = dedupe(Array.from(expectedMonths).map((item) => buildQuarterKey(item)));
  for (const quarterKey of quarterKeys) {
    const quarterJsonPath = path.join(feedPaths.outputQuartersRoot, `${quarterKey}.json`);
    const quarterMarkdownPath = path.join(feedPaths.quartersRoot, `${quarterKey}.md`);
    if (!(await pathExists(quarterJsonPath)) || !(await pathExists(quarterMarkdownPath))) {
      issues.push(`missing quarter output: ${quarterKey}`);
    }
  }

  const feedState = env.state.feeds[sourceFeed.feedSlug] || { articles: {} };
  feedState.lastLintAt = formatIsoTimestamp(new Date());
  env.state.feeds[sourceFeed.feedSlug] = feedState;
  await writeFeedStateSnapshot(env, sourceFeed.feedSlug);

  const summary = {
    status: issues.length > 0 ? 'needs_attention' : 'ok',
    issue_count: issues.length,
    issues,
    counts: {
      article_outputs: articleOutputs.length,
      project_outputs: projectFiles.length,
      month_outputs: monthFiles.length,
      quarter_outputs: quarterFiles.length,
    },
  };

  const feedPathsWithLog = buildFeedPaths(env, sourceFeed.feedSlug);
  await appendLogEntry(
    feedPathsWithLog.logPath,
    'lint',
    [
      `- status: ${summary.status}`,
      `- issues: ${summary.issue_count}`,
      ...issues.map((item) => `- ${item}`),
    ],
    env.dryRun,
  );

  return summary;
}

export function parseCliArgs(argv) {
  const args = {
    all: false,
    assumePeak: false,
    allowLargeBatch: false,
    dryRun: false,
    forcePdf: false,
    newOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split('=', 2);
    const nextValue = argv[index + 1];
    const value =
      inlineValue !== undefined
        ? inlineValue
        : typeof nextValue === 'string' && !nextValue.startsWith('--')
          ? nextValue
          : undefined;

    if (inlineValue === undefined && value !== undefined && nextValue === value) {
      index += 1;
    }

    switch (rawKey) {
      case 'feed':
        args.feed = value || '';
        break;
      case 'month':
        args.month = value || '';
        break;
      case 'from':
        args.from = value || '';
        break;
      case 'to':
        args.to = value || '';
        break;
      case 'vault':
        args.vaultPath = value || '';
        break;
      case 'config':
        args.configPath = value || '';
        break;
      case 'url':
        args.url = value || '';
        break;
      case 'channel':
        args.channel = value || '';
        break;
      case 'profile':
        args.profile = value || '';
        break;
      case 'article':
        args.article = value || '';
        break;
      case 'file':
        args.file = value || '';
        break;
      case 'user-data-dir':
        args.userDataDir = value || '';
        break;
      case 'profile-directory':
        args.profileDirectory = value || '';
        break;
      case 'all':
        args.all = true;
        break;
      case 'assume-peak':
        args.assumePeak = true;
        break;
      case 'allow-large-batch':
        args.allowLargeBatch = true;
        break;
      case 'dry-run':
        args.dryRun = true;
        break;
      case 'new-only':
        args.newOnly = true;
        break;
      case 'force-pdf':
        args.forcePdf = true;
        break;
      case 'help':
        args.help = true;
        break;
      default:
        break;
    }
  }

  return args;
}

export function buildHelpText(commandName) {
  const commandUsage = {
    run: 'pnpm wiki:run -- --feed <slug> [--month YYYY-MM] [--force-pdf] [--dry-run]',
    backfill:
      'pnpm wiki:backfill -- --feed <slug> --from YYYY-MM --to YYYY-MM [--force-pdf] [--dry-run]',
    lint: 'pnpm wiki:lint -- --feed <slug> | --all [--dry-run]',
    'render:month': 'pnpm wiki:render:month -- --feed <slug> --month YYYY-MM [--dry-run]',
    'pdf:login':
      'pnpm wiki:pdf:login -- --feed <slug> [--month YYYY-MM] [--url URL] [--channel chromium|msedge] [--profile name] [--user-data-dir PATH] [--profile-directory NAME]',
    'pdf:sync':
      'pnpm wiki:pdf:sync -- --feed <slug> | --all [--month YYYY-MM] [--new-only] [--dry-run]',
    'pdf:attach':
      'pnpm wiki:pdf:attach -- --feed <slug> --article <id|filename|hash> --file PATH [--month YYYY-MM] [--url URL]',
    'glm:probe': 'pnpm wiki:glm:probe -- --feed <slug>',
    'glm:estimate':
      'pnpm wiki:glm:estimate -- --feed <slug> [--month YYYY-MM] [--assume-peak]',
    'glm:run':
      'pnpm wiki:glm:run -- --feed <slug> [--month YYYY-MM] [--new-only] [--allow-large-batch]',
  };

  return [
    'Usage:',
    `  ${commandUsage[commandName] || commandName}`,
    '',
    'Options:',
    '  --feed <slug>      Feed folder name under WeWe-RSS-AI/',
    '  --month YYYY-MM    Limit run/render to a single month bucket',
    '  --from YYYY-MM     Backfill start month',
    '  --to YYYY-MM       Backfill end month',
    '  --vault <path>     Obsidian vault root, defaults to OBSIDIAN_VAULT_PATH or sibling vault',
    '  --config <path>    Path to llm-wiki.config.json',
    '  --url URL          Explicit URL for pdf login or download-related flows',
    '  --channel <name>   Browser channel override, e.g. chromium or msedge',
    '  --profile <name>   Pdf browser profile name under .llm-wiki/cache/pdf-profiles/',
    '  --article <query>  Article id, filename, or unique hash fragment',
    '  --file PATH        Local pdf file path for manual import',
    '  --user-data-dir    Override the pdf browser user-data-dir',
    '  --profile-directory Reuse an existing Chromium/Edge profile directory, e.g. "Default" or "Profile 2"',
    '  --all              Lint every discovered feed',
    '  --assume-peak      For glm:estimate, compute the selected quota against peak-time pricing',
    '  --allow-large-batch Allow glm:run when more than 100 articles are selected',
    '  --new-only         For pdf:sync, only process newly discovered articles and skip failed retry candidates',
    '  --force-pdf        Reprocess selected articles to refresh pdf outputs',
    '  --dry-run          Compute outputs without writing files',
    '  --help             Show this message',
  ].join('\n');
}

export async function resolveWikiEnvironment(cliArgs = {}) {
  const repoRoot = path.resolve(
    cliArgs.repoRoot || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  );
  const stationRoot = path.resolve(repoRoot, '..');
  const defaultVaultRoot = path.join(stationRoot, 'obsidian-knowledge-base');
  const dotenvLocal = await loadDotEnvLocal(repoRoot);
  const vaultRoot = path.resolve(
    cliArgs.vaultPath ||
      process.env.OBSIDIAN_VAULT_PATH ||
      process.env.OBSIDIAN_VAULT_DIR ||
      defaultVaultRoot,
  );
  const configPath = path.resolve(cliArgs.configPath || path.join(repoRoot, 'llm-wiki.config.json'));
  const config = await readJsonFile(configPath, null);
  if (!config) {
    throw new Error(`missing config file: ${configPath}`);
  }

  const contentRootName = config.paths?.content_root || DEFAULT_CONTENT_ROOT;
  const hubDirName = config.paths?.hub_dir || DEFAULT_HUB_DIR;
  const wikisDirName = config.paths?.wikis_dir || DEFAULT_WIKIS_DIR;
  const stateDirName = config.paths?.state_dir || DEFAULT_STATE_DIR;
  const weweRoot = path.join(vaultRoot, contentRootName);

  if (!(await pathExists(weweRoot))) {
    throw new Error(`missing content root: ${weweRoot}`);
  }

  const env = {
    repoRoot,
    stationRoot,
    vaultRoot,
    weweRoot,
    hubRoot: path.join(weweRoot, hubDirName),
    wikisRoot: path.join(weweRoot, wikisDirName),
    stateRoot: path.join(vaultRoot, stateDirName),
    runsRoot: path.join(vaultRoot, stateDirName, 'runs'),
    dryRun: Boolean(cliArgs.dryRun),
    configPath,
    config,
    dotenvLocal,
  };

  await ensureHubBaseFiles(env);
  await ensureDirectory(env.stateRoot, env.dryRun);
  await ensureDirectory(path.join(env.stateRoot, 'feeds'), env.dryRun);
  await ensureDirectory(path.join(env.stateRoot, 'cache'), env.dryRun);
  env.state = await readWikiState(env);

  return env;
}

export async function executeWikiCommand(commandName, cliArgs = {}) {
  const env = await resolveWikiEnvironment(cliArgs);
  const sourceFeeds = [];

  for (const feedSlug of await discoverSourceFeeds(env)) {
    sourceFeeds.push(await scanFeedArticles(env, feedSlug));
  }

  const selectedFeeds =
    (commandName === 'lint' && cliArgs.all) ||
    (commandName === 'pdf:sync' && cliArgs.all)
      ? sourceFeeds
      : sourceFeeds.filter((item) => item.feedSlug === cliArgs.feed);

  if (
    (commandName === 'run' ||
      commandName === 'backfill' ||
      commandName === 'render:month' ||
      commandName === 'pdf:login' ||
      commandName === 'pdf:attach' ||
      commandName === 'glm:probe' ||
      commandName === 'glm:estimate' ||
      commandName === 'glm:run' ||
      (commandName === 'pdf:sync' && !cliArgs.all)) &&
    !cliArgs.feed
  ) {
    throw new Error(`--feed is required for ${commandName}`);
  }

  if (selectedFeeds.length === 0) {
    throw new Error(`no matching feed found for ${cliArgs.feed || 'selection'}`);
  }

  const summary = {
    command: commandName,
    started_at: formatIsoTimestamp(new Date()),
    dry_run: env.dryRun,
    feeds: [],
  };
  const lintByFeed = {};

  if (commandName === 'run') {
    for (const sourceFeed of selectedFeeds) {
      const filteredFeed = cliArgs.month
        ? {
            ...sourceFeed,
            articles: sourceFeed.articles.filter((item) => item.monthBucket === cliArgs.month),
            months: sourceFeed.months.filter((item) => item === cliArgs.month),
          }
        : sourceFeed;
      summary.feeds.push(
        await executeFeedRun(env, filteredFeed, { force: false, forcePdf: cliArgs.forcePdf })
      );
    }
  } else if (commandName === 'backfill') {
    if (!cliArgs.from || !cliArgs.to) {
      throw new Error('--from and --to are required for backfill');
    }

    const months = buildMonthRange(cliArgs.from, cliArgs.to);
    for (const sourceFeed of selectedFeeds) {
      const feedSummary = {
        feed: sourceFeed.feedSlug,
        months,
        runs: [],
      };
      for (const month of months) {
        const monthFeed = {
          ...sourceFeed,
          articles: sourceFeed.articles.filter((item) => item.monthBucket === month),
          months: sourceFeed.months.filter((item) => item === month),
        };
        feedSummary.runs.push(
          await executeFeedRun(env, monthFeed, { force: true, forcePdf: cliArgs.forcePdf })
        );
      }
      summary.feeds.push(feedSummary);
    }
  } else if (commandName === 'render:month') {
    if (!cliArgs.month) {
      throw new Error('--month is required for render:month');
    }

    for (const sourceFeed of selectedFeeds) {
      const feedSettings = feedSettingsFor(env, sourceFeed.feedSlug);
      await ensureFeedBaseFiles(
        env,
        sourceFeed.feedSlug,
        feedSettings.display_name || sourceFeed.feedTitle,
        feedSettings,
      );
      summary.feeds.push({
        feed: sourceFeed.feedSlug,
        rendered_month: cliArgs.month,
        ...(await rebuildFeedDerivedPages(
          env,
          sourceFeed.feedSlug,
          feedSettings.display_name || sourceFeed.feedTitle,
          new Set([cliArgs.month]),
        )),
      });
    }
  } else if (commandName === 'lint') {
    for (const sourceFeed of selectedFeeds) {
      const lintSummary = await lintFeed(env, sourceFeed);
      lintByFeed[sourceFeed.feedSlug] = lintSummary;
      summary.feeds.push({
        feed: sourceFeed.feedSlug,
        ...lintSummary,
      });
    }
  } else if (commandName === 'pdf:login') {
    for (const sourceFeed of selectedFeeds) {
      summary.feeds.push(await executePdfLogin(env, sourceFeed, cliArgs));
    }
  } else if (commandName === 'pdf:sync') {
    const candidateFeeds = cliArgs.all
      ? selectedFeeds.filter((item) => isPdfAutoSyncEnabled(feedSettingsFor(env, item.feedSlug)))
      : selectedFeeds;

    if (candidateFeeds.length === 0) {
      throw new Error(cliArgs.all ? 'no pdf auto-sync enabled feeds found' : `no matching feed found for ${cliArgs.feed || 'selection'}`);
    }

    for (const sourceFeed of candidateFeeds) {
      summary.feeds.push(await executePdfSync(env, sourceFeed, cliArgs));
    }
  } else if (commandName === 'pdf:attach') {
    if (!cliArgs.article || !cliArgs.file) {
      throw new Error('--article and --file are required for pdf:attach');
    }
    for (const sourceFeed of selectedFeeds) {
      summary.feeds.push(await executePdfAttach(env, sourceFeed, cliArgs));
    }
  } else if (commandName === 'glm:probe') {
    for (const sourceFeed of selectedFeeds) {
      summary.feeds.push(await executeGlmProbe(env, sourceFeed));
    }
  } else if (commandName === 'glm:estimate') {
    for (const sourceFeed of selectedFeeds) {
      summary.feeds.push(await executeGlmEstimate(env, sourceFeed, cliArgs));
    }
  } else if (commandName === 'glm:run') {
    for (const sourceFeed of selectedFeeds) {
      summary.feeds.push(await executeGlmRun(env, sourceFeed, cliArgs));
    }
  } else {
    throw new Error(`unsupported command: ${commandName}`);
  }

  const registry = await buildRegistry(env, sourceFeeds, env.state);
  await writeHubFiles(env, registry, lintByFeed);
  await writeJsonFileAtomic(path.join(env.stateRoot, 'registry.json'), registry, env.dryRun);
  await writeWikiState(env, env.state, env.dryRun);

  const hubLogPath = path.join(env.hubRoot, 'log.md');
  await appendLogEntry(
    hubLogPath,
    commandName,
    summary.feeds.map((item) => `- ${item.feed}: ${JSON.stringify(item)}`),
    env.dryRun,
  );

  summary.completed_at = formatIsoTimestamp(new Date());
  summary.registry_path = portablePath(path.join(env.stateRoot, 'registry.json'));
  await writeRunReport(env, commandName, summary);

  return summary;
}

export const llmWikiTestApi = {
  collectPdfCandidates,
  deriveKnownPdfUrls,
  extractLinkCatalog,
  normalizeRepoUrl,
  normalizePaperUrl,
  scorePdfSourcePriority,
};
