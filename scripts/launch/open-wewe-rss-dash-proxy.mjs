import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const envPath = resolve(repoRoot, 'backups', 'z001-deploy', '.env');

function parseEnvFile(filePath) {
  const out = {};
  let text = '';
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    return out;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    out[key] = value;
  }

  return out;
}

const env = parseEnvFile(envPath);
const remoteOrigin = env.SERVER_ORIGIN_URL || 'https://z001.tail904288.ts.net';
const authCode = env.AUTH_CODE || '';
const port = Number(process.env.WEWE_RSS_DASH_PORT || '43100');
const localOrigin = `http://localhost:${port}`;
const openUrl = `${localOrigin}/dash`;
const shouldOpenBrowser = process.env.WEWE_RSS_DASH_NO_BROWSER !== '1';
const chromeProfileDir = process.env.WEWE_RSS_DASH_CHROME_PROFILE_DIR
  || resolve(process.env.TEMP || process.env.LOCALAPPDATA || repoRoot, 'wewe-rss-dash-chrome-profile');

const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function openBrowser(url) {
  if (process.platform === 'win32') {
    const chromePath = getChromeExecutable();
    if (chromePath) {
      // Open the dashboard in a dedicated Chrome window and profile instead of
      // reusing the user's existing tab session.
      const child = spawn(
        chromePath,
        [
          '--new-window',
          '--no-first-run',
          '--no-default-browser-check',
          `--user-data-dir=${chromeProfileDir}`,
          url,
        ],
        {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        },
      );

      child.unref();
      return;
    }
  }

  const child = spawn(
    process.platform === 'win32' ? 'cmd.exe' : 'xdg-open',
    process.platform === 'win32'
      ? ['/c', 'start', '', url]
      : [url],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    },
  );

  child.unref();
}

function getChromeExecutable() {
  const overridePath = process.env.WEWE_RSS_DASH_CHROME_PATH;
  if (overridePath && existsSync(overridePath)) {
    return overridePath;
  }

  if (process.platform !== 'win32') {
    return '';
  }

  const candidates = [];
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const localAppData = process.env.LOCALAPPDATA;

  if (programFiles) {
    candidates.push(resolve(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }

  if (programFilesX86) {
    candidates.push(resolve(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }

  if (localAppData) {
    candidates.push(resolve(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return '';
}

function isTextResponse(contentType) {
  return /^(text\/|application\/(javascript|json|xml|xhtml\+xml)|image\/svg\+xml)/i.test(
    contentType,
  );
}

function isHtmlResponse(contentType) {
  return /text\/html|application\/xhtml\+xml/i.test(contentType);
}

function rewriteOrigin(text) {
  return text.split(remoteOrigin).join(localOrigin);
}

function injectAuthBootstrap(html) {
  if (!authCode) {
    return html;
  }

  const bootstrap = `<script>try{localStorage.setItem('authCode',${JSON.stringify(authCode)});}catch(_){}</script>`;
  return html.includes("localStorage.setItem('authCode'")
    ? html
    : html.replace(/<head([^>]*)>/i, `<head$1>${bootstrap}`);
}

function copyResponseHeaders(upstreamHeaders, res) {
  for (const [header, value] of upstreamHeaders) {
    const lower = header.toLowerCase();

    if (hopByHopHeaders.has(lower) || lower === 'content-length' || lower === 'content-encoding') {
      continue;
    }

    if (lower === 'location') {
      res.setHeader(header, value.split(remoteOrigin).join(localOrigin));
      continue;
    }

    res.setHeader(header, value);
  }
}

function collectRequestBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];

    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => {
      resolveBody(Buffer.concat(chunks));
    });
    req.on('error', rejectBody);
  });
}

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', localOrigin);

    if (requestUrl.pathname === '/') {
      res.statusCode = 302;
      res.setHeader('Location', '/dash');
      res.end();
      return;
    }

    const targetUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, remoteOrigin);
    const headers = new Headers();

    for (const [name, value] of Object.entries(req.headers)) {
      if (value == null) {
        continue;
      }

      const lower = name.toLowerCase();
      if (lower === 'host' || hopByHopHeaders.has(lower)) {
        continue;
      }

      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }

    if (authCode) {
      headers.set('authorization', authCode);
    }

    const method = req.method || 'GET';
    const body = method === 'GET' || method === 'HEAD' ? undefined : await collectRequestBody(req);
    const upstream = await fetch(targetUrl, {
      method,
      headers,
      body,
      redirect: 'manual',
    });

    res.statusCode = upstream.status;
    copyResponseHeaders(upstream.headers, res);

    const contentType = upstream.headers.get('content-type') || '';
    let responseBuffer = Buffer.from(await upstream.arrayBuffer());

    if (isTextResponse(contentType)) {
      let text = responseBuffer.toString('utf8');
      if (text.includes(remoteOrigin)) {
        text = rewriteOrigin(text);
      }

      if (isHtmlResponse(contentType)) {
        text = injectAuthBootstrap(text);
      }

      responseBuffer = Buffer.from(text, 'utf8');
    }

    const upstreamLength = upstream.headers.get('content-length');
    if (method === 'HEAD' && upstreamLength) {
      res.setHeader('Content-Length', upstreamLength);
      res.end();
      return;
    }

    res.setHeader('Content-Length', String(responseBuffer.length));
    res.end(responseBuffer);
  } catch (error) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(`Proxy error: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  }
});

server.on('error', (error) => {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
    if (shouldOpenBrowser) {
      openBrowser(openUrl);
    }
    process.exit(0);
    return;
  }

  console.error(error);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`WeWe RSS dash proxy listening at ${openUrl}`);
  if (shouldOpenBrowser) {
    openBrowser(openUrl);
  }
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
