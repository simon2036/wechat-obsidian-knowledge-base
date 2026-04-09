#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { defaultArchiveOptions, syncArchive } from './obsidian-archive-lib.mjs';

function parseArgs(argv) {
  const args = {};
  const flagKeys = new Set(['no-discover', 'include-all', 'dry-run', 'help']);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (!arg.startsWith('--')) {
      continue;
    }

    const raw = arg.slice(2);
    const equalsIndex = raw.indexOf('=');
    const key = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw;
    const inlineValue = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : undefined;
    const nextValue = argv[i + 1];
    const value = inlineValue ?? nextValue;
    if (
      inlineValue === undefined &&
      !flagKeys.has(key) &&
      typeof nextValue === 'string' &&
      !nextValue.startsWith('--')
    ) {
      i += 1;
    }

    switch (key) {
      case 'base-url':
        args.baseUrl = value;
        break;
      case 'feed-url':
        args.feedUrls = [value];
        break;
      case 'feed-urls':
        args.feedUrls = String(value)
          .split(/[\n,]+/)
          .map((item) => item.trim())
          .filter(Boolean);
        break;
      case 'no-discover':
        args.discoverFeeds = false;
        break;
      case 'include-all':
        args.includeAllFeed = true;
        break;
      case 'limit':
        args.limit = Number.parseInt(value, 10);
        break;
      case 'mode':
        args.mode = value;
        break;
      case 'state-dir':
        args.stateDir = value;
        break;
      case 'timeout':
        args.timeoutMs = Number.parseInt(value, 10);
        break;
      case 'vault':
        args.vaultPath = value;
        break;
      case 'dry-run':
        args.dryRun = true;
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

function splitEnvList(value) {
  return String(value || '')
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveOptions(cliArgs) {
  const env = process.env;
  const feedUrls = cliArgs.feedUrls || splitEnvList(env.OBSIDIAN_FEED_URLS || env.OBSIDIAN_FEED_URL);

  return {
    ...defaultArchiveOptions,
    baseUrl:
      cliArgs.baseUrl ||
      env.OBSIDIAN_BASE_URL ||
      env.WEWE_RSS_BASE_URL ||
      env.SERVER_ORIGIN_URL ||
      defaultArchiveOptions.baseUrl,
    feedUrls,
    discoverFeeds:
      typeof cliArgs.discoverFeeds === 'boolean'
        ? cliArgs.discoverFeeds
        : env.OBSIDIAN_DISCOVER_FEEDS !== 'false',
    includeAllFeed:
      typeof cliArgs.includeAllFeed === 'boolean'
        ? cliArgs.includeAllFeed
        : env.OBSIDIAN_INCLUDE_ALL_FEED === 'true',
    limit:
      Number.isFinite(cliArgs.limit)
        ? cliArgs.limit
        : Number.parseInt(env.OBSIDIAN_FEED_LIMIT || '', 10) || defaultArchiveOptions.limit,
    mode: cliArgs.mode || env.OBSIDIAN_FEED_MODE || defaultArchiveOptions.mode,
    stateDir: cliArgs.stateDir || env.OBSIDIAN_STATE_DIR || defaultArchiveOptions.stateDir,
    timeoutMs:
      Number.isFinite(cliArgs.timeoutMs)
        ? cliArgs.timeoutMs
        : Number.parseInt(env.OBSIDIAN_TIMEOUT_MS || '', 10) || defaultArchiveOptions.timeoutMs,
    vaultPath:
      cliArgs.vaultPath ||
      env.OBSIDIAN_VAULT_PATH ||
      env.OBSIDIAN_VAULT_DIR ||
      '',
    dryRun:
      typeof cliArgs.dryRun === 'boolean'
        ? cliArgs.dryRun
        : env.OBSIDIAN_DRY_RUN === 'true',
  };
}

function printHelp() {
  console.log(`
Usage:
  node scripts/obsidian-archive.mjs [options]

Options:
  --vault <path>        Obsidian vault path
  --base-url <url>      WeWe RSS base URL
  --feed-url <url>      Sync a single feed URL
  --feed-urls <list>    Sync explicit feed URLs separated by comma or newline
  --no-discover         Disable automatic discovery from /feeds/
  --include-all         Also archive /feeds/all.json
  --limit <n>           Page size used for feed pagination
  --mode <name>         Feed mode, defaults to fulltext
  --state-dir <path>    Vault-relative state directory, defaults to .wewe-rss-archive
  --timeout <ms>        Request timeout in milliseconds
  --dry-run             Do not write files
  --help                Show this message

Environment:
  OBSIDIAN_VAULT_PATH
  OBSIDIAN_BASE_URL
  OBSIDIAN_FEED_URL
  OBSIDIAN_FEED_URLS
  OBSIDIAN_DISCOVER_FEEDS
  OBSIDIAN_INCLUDE_ALL_FEED
  OBSIDIAN_FEED_LIMIT
  OBSIDIAN_FEED_MODE
  OBSIDIAN_STATE_DIR
  OBSIDIAN_TIMEOUT_MS
  OBSIDIAN_DRY_RUN
  WEWE_RSS_BASE_URL
  SERVER_ORIGIN_URL
`);
}

async function main() {
  const cliArgs = parseArgs(process.argv.slice(2));
  if (cliArgs.help) {
    printHelp();
    return;
  }

  const options = resolveOptions(cliArgs);
  if (!options.vaultPath) {
    throw new Error('Missing vault path. Set OBSIDIAN_VAULT_PATH or pass --vault.');
  }

  const result = await syncArchive(options);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
