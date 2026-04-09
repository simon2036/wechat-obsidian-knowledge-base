#!/usr/bin/env node
import { execFile } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { defaultArchiveOptions, repairArchive, syncArchive } from './obsidian-archive-lib.mjs';

const execFileAsync = promisify(execFile);
const GIT_LOCK_RETRY_ATTEMPTS = 120;
const GIT_LOCK_RETRY_DELAY_MS = 5000;

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseArgs(argv) {
  const args = {};
  const flagKeys = new Set([
    'once',
    'help',
    'no-discover',
    'include-all',
    'dry-run',
    'git-sync',
    'repair-feed-sourced',
    'repair-all',
  ]);

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
      case 'once':
        args.once = true;
        break;
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
      case 'git-sync':
        args.gitSync = true;
        break;
      case 'git-remote':
        args.gitRemote = value;
        break;
      case 'git-branch':
        args.gitBranch = value;
        break;
      case 'git-remote-path':
        args.gitRemotePath = value;
        break;
      case 'repair-feed-sourced':
        args.repairFeedSourced = true;
        break;
      case 'repair-all':
        args.repairAll = true;
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

function resolveWorkerOptions(cliArgs) {
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
        : parseInteger(env.OBSIDIAN_FEED_LIMIT, defaultArchiveOptions.limit),
    mode: cliArgs.mode || env.OBSIDIAN_FEED_MODE || defaultArchiveOptions.mode,
    stateDir: cliArgs.stateDir || env.OBSIDIAN_STATE_DIR || defaultArchiveOptions.stateDir,
    timeoutMs:
      Number.isFinite(cliArgs.timeoutMs)
        ? cliArgs.timeoutMs
        : parseInteger(env.OBSIDIAN_TIMEOUT_MS, defaultArchiveOptions.timeoutMs),
    vaultPath:
      cliArgs.vaultPath ||
      env.OBSIDIAN_VAULT_PATH ||
      env.OBSIDIAN_VAULT_DIR ||
      '',
    dryRun:
      typeof cliArgs.dryRun === 'boolean'
        ? cliArgs.dryRun
        : env.OBSIDIAN_DRY_RUN === 'true',
    gitSync:
      typeof cliArgs.gitSync === 'boolean'
        ? cliArgs.gitSync
        : parseBoolean(env.OBSIDIAN_GIT_SYNC, false),
    gitRemote: cliArgs.gitRemote || env.OBSIDIAN_GIT_REMOTE || 'origin',
    gitBranch: cliArgs.gitBranch || env.OBSIDIAN_GIT_BRANCH || 'main',
    gitRemotePath: cliArgs.gitRemotePath || env.OBSIDIAN_GIT_REMOTE_PATH || '',
    repairFeedSourced:
      typeof cliArgs.repairFeedSourced === 'boolean'
        ? cliArgs.repairFeedSourced
        : parseBoolean(env.OBSIDIAN_REPAIR_FEED_SOURCED, false),
    repairAll:
      typeof cliArgs.repairAll === 'boolean'
        ? cliArgs.repairAll
        : parseBoolean(env.OBSIDIAN_REPAIR_ALL, false),
    gitAuthorName: env.GIT_AUTHOR_NAME || 'WeWe RSS Archive Bot',
    gitAuthorEmail: env.GIT_AUTHOR_EMAIL || 'archive-bot@z001.local',
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`
Usage:
  node scripts/obsidian-archive-worker.mjs [options]

Options:
  --once                Run a single sync and exit
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
  --git-sync            Stage, commit, and push the canonical archive directory
  --git-remote <name>   Git remote name, defaults to origin
  --git-branch <name>   Git branch name, defaults to main
  --git-remote-path     Override remote URL/path before push
  --repair-feed-sourced Re-check existing feed-sourced articles and backfill original_page metadata/content
  --repair-all          Rebuild every archived article with current extraction and cleaning rules
  --help                Show this message

Environment:
  OBSIDIAN_VAULT_PATH
  OBSIDIAN_VAULT_DIR
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
  OBSIDIAN_RUN_ONCE
  OBSIDIAN_GIT_SYNC
  OBSIDIAN_GIT_REMOTE
  OBSIDIAN_GIT_BRANCH
  OBSIDIAN_GIT_REMOTE_PATH
  OBSIDIAN_REPAIR_FEED_SOURCED
  OBSIDIAN_REPAIR_ALL
  GIT_AUTHOR_NAME
  GIT_AUTHOR_EMAIL
  WEWE_RSS_BASE_URL
  SERVER_ORIGIN_URL
`);
}

async function runGit(args, { cwd, env = {} }) {
  for (let attempt = 1; attempt <= GIT_LOCK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const result = await execFileAsync('git', args, {
        cwd,
        env: {
          ...process.env,
          ...env,
        },
        windowsHide: true,
      });

      return {
        stdout: String(result.stdout || '').trim(),
        stderr: String(result.stderr || '').trim(),
      };
    } catch (error) {
      const stderr = String(error?.stderr || '');
      const stdout = String(error?.stdout || '');
      const message = `${stdout}\n${stderr}`.toLowerCase();
      const hasGitLock =
        message.includes('index.lock') ||
        message.includes('another git process seems to be running');

      if (!hasGitLock || attempt === GIT_LOCK_RETRY_ATTEMPTS) {
        throw error;
      }

      await sleep(GIT_LOCK_RETRY_DELAY_MS);
    }
  }

  throw new Error(`git ${args.join(' ')} exhausted retries`);
}

function toGitPath(value) {
  return String(value).replace(/\\/g, '/');
}

async function gitRemoteExists(repoRoot, remoteName) {
  try {
    await runGit(['remote', 'get-url', remoteName], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

async function syncVaultGitRepo(options) {
  const repoRootResult = await runGit(['rev-parse', '--show-toplevel'], {
    cwd: options.vaultPath,
  });
  const repoRoot = repoRootResult.stdout;
  const resolvedVaultPath = path.resolve(options.vaultPath);
  const relativeVaultPath = toGitPath(path.relative(repoRoot, resolvedVaultPath) || '.');
  const pathspecs = relativeVaultPath === '.' ? ['.'] : [relativeVaultPath];
  const gitEnv = {
    GIT_AUTHOR_NAME: options.gitAuthorName,
    GIT_AUTHOR_EMAIL: options.gitAuthorEmail,
    GIT_COMMITTER_NAME: options.gitAuthorName,
    GIT_COMMITTER_EMAIL: options.gitAuthorEmail,
  };

  if (options.gitRemotePath) {
    const remoteExists = await gitRemoteExists(repoRoot, options.gitRemote);
    if (remoteExists) {
      await runGit(['remote', 'set-url', options.gitRemote, options.gitRemotePath], {
        cwd: repoRoot,
        env: gitEnv,
      });
    } else {
      await runGit(['remote', 'add', options.gitRemote, options.gitRemotePath], {
        cwd: repoRoot,
        env: gitEnv,
      });
    }
  }

  await runGit(['add', '--all', '--', ...pathspecs], {
    cwd: repoRoot,
    env: gitEnv,
  });

  let hasChanges = true;
  try {
    await runGit(['diff', '--cached', '--quiet', '--', ...pathspecs], {
      cwd: repoRoot,
      env: gitEnv,
    });
    hasChanges = false;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 1) {
      hasChanges = true;
    } else {
      throw error;
    }
  }

  if (!hasChanges) {
    return {
      status: 'no_changes',
      repoRoot,
      remote: options.gitRemote,
      branch: options.gitBranch,
      pathspecs,
    };
  }

  const commitMessage = `archive(obsidian): sync WeWe-RSS-AI ${new Date().toISOString()}`;
  await runGit(['commit', '-m', commitMessage, '--', ...pathspecs], {
    cwd: repoRoot,
    env: gitEnv,
  });

  await runGit(['push', options.gitRemote, options.gitBranch], {
    cwd: repoRoot,
    env: gitEnv,
  });

  return {
    status: 'committed',
    repoRoot,
    remote: options.gitRemote,
    branch: options.gitBranch,
    pathspecs,
    commitMessage,
  };
}

async function runOnce(options) {
  const startedAt = new Date();
  const result = await syncArchive(options);
  const repair =
    (options.repairFeedSourced || options.repairAll) && !options.dryRun
      ? await repairArchive({
          vaultPath: options.vaultPath,
          stateDir: options.stateDir,
          timeoutMs: options.timeoutMs,
          dryRun: options.dryRun,
          onlyFeedSourced: !options.repairAll,
        })
      : { status: 'disabled' };
  const gitSync =
    options.gitSync && !options.dryRun ? await syncVaultGitRepo(options) : { status: 'disabled' };
  console.log(
    JSON.stringify(
      {
        level: 'info',
        event: 'archive-sync-complete',
        startedAt: startedAt.toISOString(),
        ...result,
        repair,
        gitSync,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const cliArgs = parseArgs(process.argv.slice(2));
  if (cliArgs.help) {
    printHelp();
    return;
  }

  const options = resolveWorkerOptions(cliArgs);
  if (!options.vaultPath) {
    throw new Error('Missing vault path. Set OBSIDIAN_VAULT_PATH or OBSIDIAN_VAULT_DIR.');
  }

  const once = cliArgs.once || process.env.OBSIDIAN_RUN_ONCE === 'true';
  if (once) {
    await runOnce(options);
    return;
  }

  const intervalMinutes = parseInteger(
    process.env.OBSIDIAN_ARCHIVE_INTERVAL_MINUTES,
    1440,
  );
  const intervalMs = Math.max(5, intervalMinutes) * 60 * 1000;
  const initialDelayMs = parseInteger(
    process.env.OBSIDIAN_ARCHIVE_INITIAL_DELAY_SECONDS,
    0,
  ) * 1000;

  if (initialDelayMs > 0) {
    await sleep(initialDelayMs);
  }

  for (;;) {
    try {
      await runOnce(options);
    } catch (error) {
      console.error(
        JSON.stringify(
          {
            level: 'error',
            event: 'archive-sync-failed',
            startedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error),
          },
          null,
          2,
        ),
      );
    }

    await sleep(intervalMs);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
