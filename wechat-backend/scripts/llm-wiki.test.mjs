import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  executeWikiCommand,
  llmWikiTestApi,
  parseFrontmatterDocument,
} from './llm-wiki-lib.mjs';

function buildSourceMarkdown({
  title,
  feedId,
  feedTitle,
  articleId,
  sourceUrl,
  publishTime,
  articlePath,
  rawPath,
  content,
}) {
  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    `feed_id: ${JSON.stringify(feedId)}`,
    `feed_title: ${JSON.stringify(feedTitle)}`,
    `article_id: ${JSON.stringify(articleId)}`,
    `source_url: ${JSON.stringify(sourceUrl)}`,
    `link: ${JSON.stringify(sourceUrl)}`,
    `publish_time: ${JSON.stringify(publishTime)}`,
    `content_source: "original_page"`,
    `content_fetch_status: "original_page_rich_media"`,
    `content_quality_reason: "ok"`,
    `content_status: "available"`,
    `article_path: ${JSON.stringify(articlePath)}`,
    `raw_path: ${JSON.stringify(rawPath)}`,
    '---',
    '',
    `# ${title}`,
    '',
    '## Content',
    '',
    content,
    '',
  ].join('\n');
}

function buildRawPayload({ feedId, feedTitle, articleId, title, sourceUrl, content, contentHtml }) {
  return {
    archived_at: '2026-04-08T00:00:00.000Z',
    canonical_store: 'WeWe-RSS-AI',
    feed: {
      id: feedId,
      title: feedTitle,
      home_page_url: '',
      feed_url: '',
    },
    article: {
      id: articleId,
      title,
      url: sourceUrl,
      date_published: '',
      date_modified: '2025-03-28T01:00:00.000Z',
      content_status: 'available',
      content_source: 'original_page',
      content_fetch_status: 'original_page_rich_media',
      content_quality_reason: 'ok',
      content,
      tags: [],
    },
    source_item: {
      id: articleId,
      title,
      url: sourceUrl,
      content_html:
        contentHtml ?? `<div class="rich_media_content" id="js_content"><p>${title}</p><p>${content}</p></div>`,
    },
  };
}

async function writeArticleFixture({
  vaultRoot,
  feedSlug,
  month,
  fileName,
  title,
  articleId,
  sourceUrl,
  content,
  contentHtml,
}) {
  const feedId = 'MP_WXS_3204910472';
  const feedTitle = '榴莲忘返 AIDD';
  const articleRoot = path.join(vaultRoot, 'WeWe-RSS-AI', feedSlug, month);
  const rawRoot = path.join(articleRoot, '_raw');
  await fs.mkdir(rawRoot, { recursive: true });

  const articlePath = `${feedSlug}/${month}/${fileName}`;
  const rawFileName = fileName.replace(/\.md$/i, '.json');
  const rawPath = `${feedSlug}/${month}/_raw/${rawFileName}`;
  const markdownPath = path.join(articleRoot, fileName);
  const rawPathAbsolute = path.join(rawRoot, rawFileName);

  await fs.writeFile(
    markdownPath,
    buildSourceMarkdown({
      title,
      feedId,
      feedTitle,
      articleId,
      sourceUrl,
      publishTime: `${month}-28T01:00:00.000Z`,
      articlePath,
      rawPath,
      content,
    }),
    'utf8',
  );

  await fs.writeFile(
    rawPathAbsolute,
    JSON.stringify(
      buildRawPayload({
        feedId,
        feedTitle,
        articleId,
        title,
        sourceUrl,
        content,
        contentHtml,
      }),
      null,
      2,
    ),
    'utf8',
  );
}

async function createWorkspaceFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-wiki-test-'));
  const vaultRoot = path.join(root, 'obsidian-knowledge-base');
  const contentRoot = path.join(vaultRoot, 'WeWe-RSS-AI');
  const feedSlug = '榴莲忘返-aidd-de39c3';

  await fs.mkdir(contentRoot, { recursive: true });

  const digestContent = [
    '# TL;DR',
    '',
    '- MuLAAIP 融合结构和序列，提高抗体-抗原相互作用预测准确率。',
    '- CheapVS 结合专家偏好和贝叶斯优化，加速虚拟筛选。',
    '- RiboFlow 协同设计 RNA 序列和结构。',
    '- SynBioGPT 2.0 用关键词检索增强合成生物学问答。',
    '- NetTCR-struc 利用结构信息提升 TCR-pMHC 相互作用预测。',
    '',
    '### 1. MuLAAIP: 预测抗体-抗原相互作用',
    '',
    'MuLAAIP 整合序列和结构信息，显著提升了抗体-抗原相互作用预测性能。',
    '',
    '📜Paper: https://arxiv.org/abs/2503.17666',
    '💻Code: https://github.com/trashTian/MuLAAIP',
    '',
    '### 2. CheapVS: 专家偏好驱动的虚拟筛选',
    '',
    'CheapVS 让化学家通过两两比较来指导先导化合物选择。',
    '',
    '📜Paper: https://arxiv.org/abs/2503.16841',
    '💻Code: https://github.com/vietai/cheapvs',
    '',
    '### 3. RiboFlow: RNA 协同设计框架',
    '',
    'RiboFlow 同时设计 RNA 序列和结构，在 AF3 结合指标上大幅提升。',
    '',
    '📜Paper: https://arxiv.org/abs/2503.17007',
    '',
    '### 4. SynBioGPT 2.0: 更精准的微生物菌株开发 AI 平台',
    '',
    'SynBioGPT 2.0 通过关键词检索和子问题分解减少幻觉。',
    '',
    '📜Paper: https://www.biorxiv.org/content/10.1101/2025.03.23.644789v1',
    '',
    '### 5. NetTCR-struc: 用结构预测 TCR-pMHC 相互作用',
    '',
    'NetTCR-struc 用结构驱动方法提升 TCR-pMHC 相互作用预测鲁棒性。',
    '',
    '📜Paper: https://www.biorxiv.org/content/10.1101/2025.03.22.644721v1',
    '💻Code: https://github.com/mnielLab/NetTCR-struc',
    '',
    '— 完 —',
  ].join('\n');

  const singleContent = [
    'Chem42 这一系列新型生成式化学语言模型为靶向药物发现带来了革新。',
    '',
    'Chem42 的核心优势在于整合来自蛋白质语言模型的信息，实现精准的靶向配体生成。',
    '',
    '📜Paper: https://arxiv.org/abs/2503.16563',
    '💻Code: https://github.com/vietai/cheapvs',
    '',
    '— 完 —',
  ].join('\n');

  await writeArticleFixture({
    vaultRoot,
    feedSlug,
    month: '2025-03',
    fileName: '2025-03-28-synbiogpt-2.0-更精准的微生物菌株开发-ai-平台-63b7f9ca.md',
    title: 'SynBioGPT 2.0：更精准的微生物菌株开发 AI 平台',
    articleId: 'article-digest-1',
    sourceUrl: 'https://mp.weixin.qq.com/s/digest-1',
    content: digestContent,
  });

  await writeArticleFixture({
    vaultRoot,
    feedSlug,
    month: '2025-03',
    fileName: '2025-03-27-chem42-利用蛋白质信息生成靶向配体-089c3c59.md',
    title: 'Chem42 利用蛋白质信息生成靶向配体',
    articleId: 'article-single-1',
    sourceUrl: 'https://mp.weixin.qq.com/s/single-1',
    content: singleContent,
  });

  const configPath = path.join(root, 'llm-wiki.config.json');
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        version: 1,
        paths: {
          content_root: 'WeWe-RSS-AI',
          hub_dir: 'Hub',
          wikis_dir: 'Wikis',
          state_dir: '.llm-wiki',
        },
        providers: {
          default: 'local-rules',
          fallback: 'local-rules',
          'local-rules': {
            type: 'local-rules',
            model: 'local-rules-v1',
          },
        },
        feeds: {
          [feedSlug]: {
            enabled: true,
            display_name: '榴莲忘返 AIDD',
            classifier: 'aidd-digest',
            provider: 'local-rules',
            fallback_provider: 'local-rules',
            project_extraction: true,
            pdf_enabled: true,
            pdf_auto_sync_enabled: true,
            pdf_policy: 'key_articles_only',
          },
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  return { root, vaultRoot, configPath, feedSlug };
}

async function writeManualGlmConfig({
  configPath,
  feedSlug,
  baseUrl,
  apiKeyEnv = 'GLM_API_KEY',
  baseUrlEnv = 'GLM_MANUAL_BASE_URL',
}) {
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        version: 1,
        paths: {
          content_root: 'WeWe-RSS-AI',
          hub_dir: 'Hub',
          wikis_dir: 'Wikis',
          state_dir: '.llm-wiki',
        },
        providers: {
          default: 'local-rules',
          fallback: 'local-rules',
          glm_coding_manual: {
            type: 'openai-compatible',
            api_key_env: apiKeyEnv,
            base_url_env: baseUrlEnv,
            base_url: baseUrl,
          },
          'local-rules': {
            type: 'local-rules',
            model: 'local-rules-v1',
          },
        },
        feeds: {
          [feedSlug]: {
            enabled: true,
            display_name: '姒磋幉蹇樿繑 AIDD',
            classifier: 'aidd-digest',
            provider: 'local-rules',
            fallback_provider: 'local-rules',
            glm_manual_enabled: true,
            glm_manual_provider: 'glm_coding_manual',
            glm_primary_model: 'glm-5',
            glm_fallback_models: ['glm-4.7', 'glm-4.6'],
            project_extraction: true,
            pdf_enabled: false,
            pdf_auto_sync_enabled: false,
            pdf_policy: 'disabled',
          },
        },
      },
      null,
      2,
    ),
    'utf8',
  );
}

async function startMockGlmServer(responder) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    const payload = body ? JSON.parse(body) : {};
    requests.push(payload);
    const response = await responder(payload, req);
    res.statusCode = response.status || 200;
    if (response.headers) {
      for (const [key, value] of Object.entries(response.headers)) {
        res.setHeader(key, value);
      }
    } else {
      res.setHeader('content-type', 'application/json');
    }

    if (response.json !== undefined) {
      res.end(JSON.stringify(response.json));
      return;
    }

    res.end(String(response.text || ''));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: async () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function buildMinimalPdfBuffer(label) {
  return Buffer.from(
    `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 1 /Kids [3 0 R] >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Font << /F1 5 0 R >> >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 18 Tf 36 96 Td (${label}) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000221 00000 n 
0000000314 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
384
%%EOF
`,
    'utf8',
  );
}

async function startPdfDownloadServer() {
  const pdfBuffer = buildMinimalPdfBuffer('Test PDF');
  const server = http.createServer((req, res) => {
    if (req.url === '/paper.pdf') {
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': Buffer.byteLength(pdfBuffer),
      });
      res.end(pdfBuffer);
      return;
    }

    if (req.url === '/paper') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><a href="/paper.pdf">Download PDF</a></body></html>');
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
  };
}

test('parseFrontmatterDocument reads simple arrays and quoted values', () => {
  const parsed = parseFrontmatterDocument(`---\ntitle: "Hello"\ntags:\n  - "a"\n  - "b"\n---\n\nbody`);
  assert.equal(parsed.data.title, 'Hello');
  assert.deepEqual(parsed.data.tags, ['a', 'b']);
  assert.equal(parsed.body.trim(), 'body');
});

test('link extraction normalizes github repo urls and doi text', () => {
  const linkCatalog = llmWikiTestApi.extractLinkCatalog([
    '📜Paper: 10.1021/jacs.5c01234',
    '💻Code: https://github.com/hanjunwei-lab/labyrinth)，方便其他研究者使用和改进。',
    'Mirror: https://github.com/hanjunwei-lab/labyrinth/tree/main',
  ].join('\n'));

  assert.deepEqual(linkCatalog.repoUrls, ['https://github.com/hanjunwei-lab/labyrinth']);
  assert.deepEqual(linkCatalog.paperUrls, ['https://doi.org/10.1021/jacs.5c01234']);
});

test('deriveKnownPdfUrls covers common publisher landing pages', () => {
  assert.deepEqual(llmWikiTestApi.deriveKnownPdfUrls('https://arxiv.org/abs/2503.17666'), [
    'https://arxiv.org/pdf/2503.17666.pdf',
  ]);
  assert.deepEqual(
    llmWikiTestApi.deriveKnownPdfUrls('https://pubs.acs.org/doi/10.1021/jacs.5c01234'),
    [
      'https://pubs.acs.org/doi/pdf/10.1021/jacs.5c01234',
      'https://pubs.acs.org/doi/epdf/10.1021/jacs.5c01234',
    ],
  );
  assert.deepEqual(
    llmWikiTestApi.deriveKnownPdfUrls('https://onlinelibrary.wiley.com/doi/10.1002/adma.202410876'),
    [
      'https://onlinelibrary.wiley.com/doi/pdf/10.1002/adma.202410876',
      'https://onlinelibrary.wiley.com/doi/epdf/10.1002/adma.202410876',
    ],
  );
  assert.deepEqual(
    llmWikiTestApi.deriveKnownPdfUrls('https://www.sciencedirect.com/science/article/pii/S0092867425001234'),
    ['https://www.sciencedirect.com/science/article/pii/S0092867425001234/pdf'],
  );
});

test('collectPdfCandidates prefers configured publisher host over open preprints', () => {
  const candidates = llmWikiTestApi.collectPdfCandidates(
    {
      sourceUrl: 'https://mp.weixin.qq.com/s/example',
      fallbackContent: '',
    },
    {
      article: {
        content: [
          '正式论文: https://pubs.acs.org/doi/10.1021/acs.jmedchem.4c03159',
          '预印本: https://www.biorxiv.org/content/10.1101/2025.03.26.645438v1',
        ].join('\n'),
      },
      source_item: {
        content_html: '',
      },
    },
    {
      paper_urls: [
        'https://www.biorxiv.org/content/10.1101/2025.03.26.645438v1',
        'https://pubs.acs.org/doi/10.1021/acs.jmedchem.4c03159',
      ],
    },
    {
      pdf_login_url: 'https://pubs.acs.org/doi/10.1021/acs.jmedchem.4c03159',
    },
  );

  assert.equal(candidates.directUrls[0], 'https://pubs.acs.org/doi/pdf/10.1021/acs.jmedchem.4c03159');
  assert.equal(candidates.pageUrls[0], 'https://pubs.acs.org/doi/10.1021/acs.jmedchem.4c03159');
});

test('wiki run renders article, project, month, quarter, and hub outputs', async () => {
  const { root, vaultRoot, configPath, feedSlug } = await createWorkspaceFixture();

  try {
    const result = await executeWikiCommand('run', {
      feed: feedSlug,
      month: '2025-03',
      vaultPath: vaultRoot,
      configPath,
    });

    assert.equal(result.feeds.length, 1);
    assert.equal(result.feeds[0].processed, 2);
    assert.equal(result.feeds[0].failures, 0);

    const articleJson = path.join(
      vaultRoot,
      'WeWe-RSS-AI',
      'Wikis',
      feedSlug,
      'output',
      'json',
      'articles',
      '2025-03',
      '2025-03-28-synbiogpt-2.0-更精准的微生物菌株开发-ai-平台-63b7f9ca.json',
    );
    const articlePayload = JSON.parse(await fs.readFile(articleJson, 'utf8'));
    assert.equal(articlePayload.article_type, 'five_work_digest');
    assert.equal(articlePayload.projects.length, 5);
    assert.ok(['generated', 'dependency_missing'].includes(articlePayload.pdf_status));
    if (articlePayload.pdf_status === 'generated') {
      assert.match(articlePayload.pdf_path, /\.pdf$/);
      await fs.access(
        path.join(
          vaultRoot,
          'WeWe-RSS-AI',
          ...String(articlePayload.pdf_path).split('/').filter(Boolean)
        )
      );
    } else {
      assert.equal(articlePayload.pdf_path, '');
    }

    const monthPage = path.join(
      vaultRoot,
      'WeWe-RSS-AI',
      'Wikis',
      feedSlug,
      'months',
      '2025-03.md',
    );
    const quarterPage = path.join(
      vaultRoot,
      'WeWe-RSS-AI',
      'Wikis',
      feedSlug,
      'quarters',
      '2025-Q1.md',
    );
    const hubIndex = path.join(vaultRoot, 'WeWe-RSS-AI', 'Hub', 'index.md');

    assert.equal(await fs.readFile(monthPage, 'utf8').then(Boolean), true);
    assert.equal(await fs.readFile(quarterPage, 'utf8').then(Boolean), true);
    assert.equal(await fs.readFile(hubIndex, 'utf8').then(Boolean), true);

    const projectFiles = await fs.readdir(
      path.join(vaultRoot, 'WeWe-RSS-AI', 'Wikis', feedSlug, 'output', 'json', 'projects'),
    );
    assert.equal(projectFiles.length, 5);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('wiki run is idempotent on rerun and lint succeeds', async () => {
  const { root, vaultRoot, configPath, feedSlug } = await createWorkspaceFixture();

  try {
    await executeWikiCommand('run', {
      feed: feedSlug,
      month: '2025-03',
      vaultPath: vaultRoot,
      configPath,
    });

    const rerun = await executeWikiCommand('run', {
      feed: feedSlug,
      month: '2025-03',
      vaultPath: vaultRoot,
      configPath,
    });

    assert.equal(rerun.feeds[0].processed, 0);
    assert.equal(rerun.feeds[0].skipped, 2);

    const lint = await executeWikiCommand('lint', {
      feed: feedSlug,
      vaultPath: vaultRoot,
      configPath,
    });
    assert.equal(lint.feeds[0].status, 'ok');
    assert.equal(lint.feeds[0].issue_count, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('wiki run downloads pdf from source page before print fallback', async (t) => {
  let playwrightReady = true;
  try {
    const { chromium } = await import('playwright');
    await fs.access(chromium.executablePath());
  } catch {
    playwrightReady = false;
  }

  if (!playwrightReady) {
    t.skip('playwright chromium runtime is unavailable');
    return;
  }

  const { server, origin } = await startPdfDownloadServer();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-wiki-download-test-'));
  const vaultRoot = path.join(root, 'obsidian-knowledge-base');
  const contentRoot = path.join(vaultRoot, 'WeWe-RSS-AI');
  const feedSlug = '姒磋幉蹇樿繑-aidd-de39c3';
  const configPath = path.join(root, 'llm-wiki.config.json');
  const digestContent = [
    '# TL;DR',
    '',
    '- Item 1',
    '- Item 2',
    '- Item 3',
    '',
    '### 1. Project One',
    '',
    'Summary one.',
    '',
    '### 2. Project Two',
    '',
    'Summary two.',
    '',
    '### 3. Project Three',
    '',
    'Summary three.',
  ].join('\n');

  try {
    await fs.mkdir(contentRoot, { recursive: true });
    await writeArticleFixture({
      vaultRoot,
      feedSlug,
      month: '2025-03',
      fileName: '2025-03-28-downloadable-paper-63b7f9ca.md',
      title: 'Downloadable Paper',
      articleId: 'article-download-1',
      sourceUrl: `${origin}/paper`,
      content: digestContent,
      contentHtml: '<div class="rich_media_content" id="js_content"><p>Fallback html</p></div>',
    });

    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          version: 1,
          paths: {
            content_root: 'WeWe-RSS-AI',
            hub_dir: 'Hub',
            wikis_dir: 'Wikis',
            state_dir: '.llm-wiki',
          },
          providers: {
            default: 'local-rules',
            fallback: 'local-rules',
            'local-rules': {
              type: 'local-rules',
              model: 'local-rules-v1',
            },
          },
          feeds: {
            [feedSlug]: {
              enabled: true,
              display_name: '姒磋幉蹇樿繑 AIDD',
              classifier: 'aidd-digest',
              provider: 'local-rules',
              fallback_provider: 'local-rules',
              project_extraction: true,
              pdf_enabled: true,
              pdf_auto_sync_enabled: true,
              pdf_policy: 'all',
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    await executeWikiCommand('run', {
      feed: feedSlug,
      month: '2025-03',
      vaultPath: vaultRoot,
      configPath,
    });

    const articleJson = path.join(
      vaultRoot,
      'WeWe-RSS-AI',
      'Wikis',
      feedSlug,
      'output',
      'json',
      'articles',
      '2025-03',
      '2025-03-28-downloadable-paper-63b7f9ca.json',
    );
    const articlePayload = JSON.parse(await fs.readFile(articleJson, 'utf8'));

    assert.equal(articlePayload.pdf_status, 'generated');
    assert.equal(articlePayload.pdf_method, 'download');
    assert.match(articlePayload.pdf_source_url, /paper\.pdf$/);
    await fs.access(
      path.join(vaultRoot, 'WeWe-RSS-AI', ...String(articlePayload.pdf_path).split('/').filter(Boolean))
    );
  } finally {
    server.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('pdf attach imports a manually downloaded pdf into article outputs', async () => {
  const { root, vaultRoot, configPath, feedSlug } = await createWorkspaceFixture();

  try {
    await executeWikiCommand('run', {
      feed: feedSlug,
      month: '2025-03',
      vaultPath: vaultRoot,
      configPath,
    });

    const importedPdfPath = path.join(root, 'manual-import.pdf');
    await fs.writeFile(importedPdfPath, buildMinimalPdfBuffer('Manual Import PDF'));

    const attach = await executeWikiCommand('pdf:attach', {
      feed: feedSlug,
      month: '2025-03',
      article: '63b7f9ca',
      file: importedPdfPath,
      url: 'https://pubs.acs.org/doi/pdf/10.1021/acs.jmedchem.4c03159',
      vaultPath: vaultRoot,
      configPath,
    });

    assert.equal(attach.feeds[0].pdf_method, 'manual_import');

    const articleJson = path.join(
      vaultRoot,
      'WeWe-RSS-AI',
      'Wikis',
      feedSlug,
      'output',
      'json',
      'articles',
      '2025-03',
      '2025-03-28-synbiogpt-2.0-更精准的微生物菌株开发-ai-平台-63b7f9ca.json',
    );
    const articleMarkdown = path.join(
      vaultRoot,
      'WeWe-RSS-AI',
      'Wikis',
      feedSlug,
      'articles',
      '2025-03',
      '2025-03-28-synbiogpt-2.0-更精准的微生物菌株开发-ai-平台-63b7f9ca.md',
    );
    const articlePayload = JSON.parse(await fs.readFile(articleJson, 'utf8'));
    const articleMarkdownContent = await fs.readFile(articleMarkdown, 'utf8');

    assert.equal(articlePayload.pdf_status, 'generated');
    assert.equal(articlePayload.pdf_method, 'manual_import');
    assert.equal(
      articlePayload.pdf_source_url,
      'https://pubs.acs.org/doi/pdf/10.1021/acs.jmedchem.4c03159',
    );
    await fs.access(
      path.join(vaultRoot, 'WeWe-RSS-AI', ...String(articlePayload.pdf_path).split('/').filter(Boolean))
    );
    assert.match(articleMarkdownContent, /manual_import/);
    assert.match(articleMarkdownContent, /Open PDF/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('pdf sync --all processes only auto-sync enabled feeds', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-wiki-pdf-sync-test-'));
  const vaultRoot = path.join(root, 'obsidian-knowledge-base');
  const contentRoot = path.join(vaultRoot, 'WeWe-RSS-AI');
  const enabledFeed = '姒磋幉蹇樿繑-aidd-de39c3';
  const disabledFeed = 'other-feed-123';
  const configPath = path.join(root, 'llm-wiki.config.json');

  try {
    await fs.mkdir(contentRoot, { recursive: true });
    await writeArticleFixture({
      vaultRoot,
      feedSlug: enabledFeed,
      month: '2025-03',
      fileName: '2025-03-28-enabled-paper-63b7f9ca.md',
      title: 'Enabled Feed Paper',
      articleId: 'enabled-article-1',
      sourceUrl: 'https://mp.weixin.qq.com/s/enabled-1',
      content: 'Paper: https://arxiv.org/abs/2503.17666',
    });
    await writeArticleFixture({
      vaultRoot,
      feedSlug: disabledFeed,
      month: '2025-03',
      fileName: '2025-03-28-disabled-paper-63b7f9ca.md',
      title: 'Disabled Feed Paper',
      articleId: 'disabled-article-1',
      sourceUrl: 'https://mp.weixin.qq.com/s/disabled-1',
      content: 'Paper: https://arxiv.org/abs/2503.17666',
    });

    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          version: 1,
          paths: {
            content_root: 'WeWe-RSS-AI',
            hub_dir: 'Hub',
            wikis_dir: 'Wikis',
            state_dir: '.llm-wiki',
          },
          providers: {
            default: 'local-rules',
            fallback: 'local-rules',
            'local-rules': {
              type: 'local-rules',
              model: 'local-rules-v1',
            },
          },
          feeds: {
            [enabledFeed]: {
              enabled: true,
              display_name: 'Enabled Feed',
              classifier: 'generic',
              provider: 'local-rules',
              fallback_provider: 'local-rules',
              project_extraction: true,
              pdf_enabled: true,
              pdf_auto_sync_enabled: true,
              pdf_auto_sync_initial_lookback_days: 1000,
              pdf_policy: 'all',
            },
            [disabledFeed]: {
              enabled: true,
              display_name: 'Disabled Feed',
              classifier: 'generic',
              provider: 'local-rules',
              fallback_provider: 'local-rules',
              project_extraction: true,
              pdf_enabled: false,
              pdf_auto_sync_enabled: false,
              pdf_policy: 'all',
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await executeWikiCommand('pdf:sync', {
      all: true,
      vaultPath: vaultRoot,
      configPath,
    });

    assert.equal(result.feeds.length, 1);
    assert.equal(result.feeds[0].feed, enabledFeed);
    assert.equal(result.feeds[0].article_count_scanned, 1);
    assert.equal(result.feeds[0].pending_new_count, 1);
    assert.equal(result.feeds[0].processed, 1);

    const enabledArticleJson = path.join(
      vaultRoot,
      'WeWe-RSS-AI',
      'Wikis',
      enabledFeed,
      'output',
      'json',
      'articles',
      '2025-03',
      '2025-03-28-enabled-paper-63b7f9ca.json',
    );
    const disabledArticleJson = path.join(
      vaultRoot,
      'WeWe-RSS-AI',
      'Wikis',
      disabledFeed,
      'output',
      'json',
      'articles',
      '2025-03',
      '2025-03-28-disabled-paper-63b7f9ca.json',
    );

    await fs.access(enabledArticleJson);
    await assert.rejects(fs.access(disabledArticleJson));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('pdf sync defers historical backlog outside the initial auto-sync lookback window', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-wiki-pdf-sync-lookback-test-'));
  const vaultRoot = path.join(root, 'obsidian-knowledge-base');
  const contentRoot = path.join(vaultRoot, 'WeWe-RSS-AI');
  const feedSlug = 'history-feed-123';
  const configPath = path.join(root, 'llm-wiki.config.json');
  const fileName = '2025-01-10-historical-paper-63b7f9ca.md';
  const sourcePath = path.join(contentRoot, feedSlug, '2025-01', fileName);
  const rawPath = path.join(contentRoot, feedSlug, '2025-01', '_raw', '2025-01-10-historical-paper-63b7f9ca.json');

  try {
    await fs.mkdir(contentRoot, { recursive: true });
    await writeArticleFixture({
      vaultRoot,
      feedSlug,
      month: '2025-01',
      fileName,
      title: 'Historical Feed Paper',
      articleId: 'historical-article-1',
      sourceUrl: 'https://mp.weixin.qq.com/s/historical-1',
      content: 'Paper: https://arxiv.org/abs/2503.17666',
    });

    const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    await fs.utimes(sourcePath, oldDate, oldDate);
    await fs.utimes(rawPath, oldDate, oldDate);

    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          version: 1,
          paths: {
            content_root: 'WeWe-RSS-AI',
            hub_dir: 'Hub',
            wikis_dir: 'Wikis',
            state_dir: '.llm-wiki',
          },
          providers: {
            default: 'local-rules',
            fallback: 'local-rules',
            'local-rules': {
              type: 'local-rules',
              model: 'local-rules-v1',
            },
          },
          feeds: {
            [feedSlug]: {
              enabled: true,
              display_name: 'History Feed',
              classifier: 'generic',
              provider: 'local-rules',
              fallback_provider: 'local-rules',
              project_extraction: true,
              pdf_enabled: true,
              pdf_auto_sync_enabled: true,
              pdf_auto_sync_initial_lookback_days: 7,
              pdf_policy: 'all',
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await executeWikiCommand('pdf:sync', {
      feed: feedSlug,
      vaultPath: vaultRoot,
      configPath,
    });

    assert.equal(result.feeds.length, 1);
    assert.equal(result.feeds[0].pending_new_count, 0);
    assert.equal(result.feeds[0].pending_retry_count, 0);
    assert.equal(result.feeds[0].deferred_count, 1);
    assert.equal(result.feeds[0].processed, 0);
    assert.equal(result.feeds[0].sync_status, 'up_to_date');

    const articleJson = path.join(
      vaultRoot,
      'WeWe-RSS-AI',
      'Wikis',
      feedSlug,
      'output',
      'json',
      'articles',
      '2025-01',
      '2025-01-10-historical-paper-63b7f9ca.json',
    );
    await assert.rejects(fs.access(articleJson));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('pdf sync --new-only skips failed retry candidates during routine runs', async () => {
  const { root, vaultRoot, configPath, feedSlug } = await createWorkspaceFixture();

  try {
    await executeWikiCommand('run', {
      feed: feedSlug,
      month: '2025-03',
      vaultPath: vaultRoot,
      configPath,
    });

    const articleJson = path.join(
      vaultRoot,
      'WeWe-RSS-AI',
      'Wikis',
      feedSlug,
      'output',
      'json',
      'articles',
      '2025-03',
    );
    const articleJsonName = (await fs.readdir(articleJson)).find((item) => item.endsWith('63b7f9ca.json'));
    assert.ok(articleJsonName);
    const articleJsonPath = path.join(articleJson, articleJsonName);
    const payload = JSON.parse(await fs.readFile(articleJsonPath, 'utf8'));
    payload.pdf_status = 'failed';
    payload.pdf_path = '';
    payload.pdf_method = '';
    payload.pdf_source_url = '';
    payload.generated_at = new Date().toISOString();
    await fs.writeFile(articleJsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

    const result = await executeWikiCommand('pdf:sync', {
      feed: feedSlug,
      month: '2025-03',
      newOnly: true,
      vaultPath: vaultRoot,
      configPath,
    });

    assert.equal(result.feeds.length, 1);
    assert.equal(result.feeds[0].new_only, true);
    assert.equal(result.feeds[0].pending_retry_count, 0);
    assert.equal(result.feeds[0].blocked_count, 1);
    assert.equal(result.feeds[0].processed, 0);
    assert.equal(result.feeds[0].sync_status, 'up_to_date');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('render month removes stale derived project and aggregate files', async () => {
  const { root, vaultRoot, configPath, feedSlug } = await createWorkspaceFixture();

  try {
    await executeWikiCommand('run', {
      feed: feedSlug,
      month: '2025-03',
      vaultPath: vaultRoot,
      configPath,
    });

    const feedWikiRoot = path.join(vaultRoot, 'WeWe-RSS-AI', 'Wikis', feedSlug);
    const stalePaths = [
      path.join(feedWikiRoot, 'projects', 'stale-project.md'),
      path.join(feedWikiRoot, 'output', 'json', 'projects', 'stale-project.json'),
      path.join(feedWikiRoot, 'months', '1999-01.md'),
      path.join(feedWikiRoot, 'output', 'json', 'months', '1999-01.json'),
      path.join(feedWikiRoot, 'quarters', '1999-Q1.md'),
      path.join(feedWikiRoot, 'output', 'json', 'quarters', '1999-Q1.json'),
    ];

    for (const filePath of stalePaths) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, '{}', 'utf8');
    }

    await executeWikiCommand('render:month', {
      feed: feedSlug,
      month: '2025-03',
      vaultPath: vaultRoot,
      configPath,
    });

    for (const filePath of stalePaths) {
      await assert.rejects(fs.access(filePath));
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('render month rebuilds derived pages from existing json output', async () => {
  const { root, vaultRoot, configPath, feedSlug } = await createWorkspaceFixture();

  try {
    await executeWikiCommand('run', {
      feed: feedSlug,
      month: '2025-03',
      vaultPath: vaultRoot,
      configPath,
    });

    const monthPath = path.join(
      vaultRoot,
      'WeWe-RSS-AI',
      'Wikis',
      feedSlug,
      'months',
      '2025-03.md',
    );
    await fs.rm(monthPath, { force: true });

    const render = await executeWikiCommand('render:month', {
      feed: feedSlug,
      month: '2025-03',
      vaultPath: vaultRoot,
      configPath,
    });

    assert.equal(render.feeds[0].articleCount, 2);
    assert.equal(await fs.readFile(monthPath, 'utf8').then(Boolean), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('glm:estimate reports quota usage for the selected month', async () => {
  const { root, vaultRoot, configPath, feedSlug } = await createWorkspaceFixture();

  try {
    await writeManualGlmConfig({
      configPath,
      feedSlug,
      baseUrl: 'https://example.invalid',
    });

    const result = await executeWikiCommand('glm:estimate', {
      feed: feedSlug,
      month: '2025-03',
      vaultPath: vaultRoot,
      configPath,
      repoRoot: root,
    });

    assert.equal(result.feeds[0].article_count, 2);
    assert.equal(result.feeds[0].glm5_off_peak_units, 4);
    assert.equal(result.feeds[0].glm5_peak_units, 6);
    assert.equal(result.feeds[0].conservative_off_peak_units, 4.2);
    assert.equal(result.feeds[0].requires_allow_large_batch, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('glm:probe loads .env.local before probing models', async () => {
  const { root, vaultRoot, configPath, feedSlug } = await createWorkspaceFixture();
  const apiKeyEnv = 'GLM_API_KEY_FILE_TEST';
  const baseUrlEnv = 'GLM_MANUAL_BASE_URL_FILE_TEST';
  delete process.env[apiKeyEnv];
  delete process.env[baseUrlEnv];

  const mockServer = await startMockGlmServer(async (payload) => ({
    status: 200,
    json: {
      choices: [
        {
          message: {
            content: JSON.stringify({ ok: true, model: payload.model }),
          },
        },
      ],
    },
  }));

  try {
    await writeManualGlmConfig({
      configPath,
      feedSlug,
      baseUrl: mockServer.baseUrl,
      apiKeyEnv,
      baseUrlEnv,
    });
    await fs.writeFile(
      path.join(root, '.env.local'),
      `${apiKeyEnv}=from-file-key\n${baseUrlEnv}=${mockServer.baseUrl}\n`,
      'utf8',
    );

    const result = await executeWikiCommand('glm:probe', {
      feed: feedSlug,
      vaultPath: vaultRoot,
      configPath,
      repoRoot: root,
    });

    assert.equal(mockServer.requests.length > 0, true);
    assert.equal(mockServer.requests[0].model, 'glm-5');
    assert.equal(result.feeds[0].supported_models.includes('glm-5'), true);
    await fs.access(path.join(vaultRoot, '.llm-wiki', 'cache', 'glm-capabilities.json'));
  } finally {
    delete process.env[apiKeyEnv];
    delete process.env[baseUrlEnv];
    await mockServer.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('glm:run falls back from glm-5 to glm-4.7 on retryable failures', async () => {
  const { root, vaultRoot, configPath, feedSlug } = await createWorkspaceFixture();
  const apiKeyEnv = 'GLM_API_KEY_CHAIN_TEST';
  const baseUrlEnv = 'GLM_MANUAL_BASE_URL_CHAIN_TEST';
  process.env[apiKeyEnv] = 'test-key';

  const mockServer = await startMockGlmServer(async (payload) => {
    if (payload.model === 'glm-5') {
      return {
        status: 500,
        text: 'temporary upstream failure',
        headers: { 'content-type': 'text/plain' },
      };
    }

    return {
      status: 200,
      json: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                article_type: 'single_project_article',
                summary: `summary from ${payload.model}`,
                key_points: ['point'],
                projects: [],
                repo_urls: [],
                paper_urls: [],
                warnings: [],
                confidence: 0.9,
                review_status: 'auto_generated',
              }),
            },
          },
        ],
      },
    };
  });
  process.env[baseUrlEnv] = mockServer.baseUrl;

  try {
    await writeManualGlmConfig({
      configPath,
      feedSlug,
      baseUrl: mockServer.baseUrl,
      apiKeyEnv,
      baseUrlEnv,
    });

    const result = await executeWikiCommand('glm:run', {
      feed: feedSlug,
      month: '2025-03',
      vaultPath: vaultRoot,
      configPath,
      repoRoot: root,
      allowNonInteractive: true,
    });

    assert.equal(result.feeds[0].processed, 2);
    assert.equal(mockServer.requests.some((item) => item.model === 'glm-5'), true);
    assert.equal(mockServer.requests.some((item) => item.model === 'glm-4.7'), true);

    const articleDir = path.join(
      vaultRoot,
      'WeWe-RSS-AI',
      'Wikis',
      feedSlug,
      'output',
      'json',
      'articles',
      '2025-03',
    );
    const [articleFile] = await fs.readdir(articleDir);
    const articleJson = JSON.parse(await fs.readFile(path.join(articleDir, articleFile), 'utf8'));
    assert.equal(articleJson.provider, 'glm_coding_manual');
    assert.equal(articleJson.model, 'glm-4.7');
  } finally {
    delete process.env[apiKeyEnv];
    delete process.env[baseUrlEnv];
    await mockServer.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('glm:run falls back directly to local-rules on terminal auth errors', async () => {
  const { root, vaultRoot, configPath, feedSlug } = await createWorkspaceFixture();
  const apiKeyEnv = 'GLM_API_KEY_AUTH_TEST';
  const baseUrlEnv = 'GLM_MANUAL_BASE_URL_AUTH_TEST';
  process.env[apiKeyEnv] = 'bad-key';

  const mockServer = await startMockGlmServer(async () => ({
    status: 401,
    text: 'invalid api key',
    headers: { 'content-type': 'text/plain' },
  }));
  process.env[baseUrlEnv] = mockServer.baseUrl;

  try {
    await writeManualGlmConfig({
      configPath,
      feedSlug,
      baseUrl: mockServer.baseUrl,
      apiKeyEnv,
      baseUrlEnv,
    });

    const result = await executeWikiCommand('glm:run', {
      feed: feedSlug,
      month: '2025-03',
      vaultPath: vaultRoot,
      configPath,
      repoRoot: root,
      allowNonInteractive: true,
    });

    assert.equal(result.feeds[0].processed, 2);
    assert.equal(mockServer.requests.every((item) => item.model === 'glm-5'), true);

    const articleDir = path.join(
      vaultRoot,
      'WeWe-RSS-AI',
      'Wikis',
      feedSlug,
      'output',
      'json',
      'articles',
      '2025-03',
    );
    const [articleFile] = await fs.readdir(articleDir);
    const articleJson = JSON.parse(await fs.readFile(path.join(articleDir, articleFile), 'utf8'));
    assert.equal(articleJson.provider, 'local-rules');
    assert.equal(articleJson.review_status, 'needs_review');
  } finally {
    delete process.env[apiKeyEnv];
    delete process.env[baseUrlEnv];
    await mockServer.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('glm:run requires an interactive terminal', async () => {
  const { root, vaultRoot, configPath, feedSlug } = await createWorkspaceFixture();

  try {
    await writeManualGlmConfig({
      configPath,
      feedSlug,
      baseUrl: 'https://example.invalid',
    });

    await assert.rejects(
      executeWikiCommand('glm:run', {
        feed: feedSlug,
        month: '2025-03',
        vaultPath: vaultRoot,
        configPath,
        repoRoot: root,
      }),
      /interactive terminal/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
