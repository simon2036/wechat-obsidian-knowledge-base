#!/usr/bin/env node
import process from 'node:process';

import { buildHelpText, executeWikiCommand, parseCliArgs } from './llm-wiki-lib.mjs';

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log(buildHelpText('run'));
    return;
  }

  const result = await executeWikiCommand('run', args);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
