# LLM-Wiki Current Status

Last updated: 2026-04-09

## Scope

This note records the current Windows-station status for the LLM-Wiki toolchain, the PDF workflow, the manual GLM workflow, and the double-click launcher.

It covers two layers:

- Git-tracked code and docs inside `D:\opt\app\wechat-obsidian-knowledge-base\wechat-backend`
- Local station entry points under `D:\opt\app\wechat-obsidian-knowledge-base`

The station root itself is not a Git repository. GitHub uploads only include the tracked `wechat-backend` repo, so root-level launchers are documented here instead of being pushed as source files.

## What Changed In This Round

### LLM-Wiki toolkit

- Added reusable sidecar commands for:
  - `wiki:run`
  - `wiki:backfill`
  - `wiki:lint`
  - `wiki:render:month`
- Added multi-feed config in `llm-wiki.config.json`
- Kept normal automation on `local-rules` by default

### PDF workflow

- Added PDF login, sync, and manual attach commands
- Added direct-download-first PDF strategy with print fallback
- Added publisher rules for common paper sites
- Added manual PDF import for sites that block browser automation
- Added scheduled PDF sync with explicit feed allowlist

### GLM workflow

- Added manual-only GLM commands:
  - `wiki:glm:probe`
  - `wiki:glm:estimate`
  - `wiki:glm:run`
- Added `.env.local` loading for GLM secrets
- Added model fallback order:
  - `glm-5`
  - `glm-4.7`
  - `glm-4.6`
  - `local-rules`
- Kept GLM out of unattended scheduled jobs

### Windows launcher

- Added a double-click launcher for common LLM-Wiki operations
- Added parameter help, command preview, and recent-parameter memory
- Fixed the startup path bug that caused:
  - `open-llm-wiki-tools.cmd` to appear unresponsive
  - `llm-wiki-tools.exe` to fail with an empty `Path` binding error
- The launcher now resolves station root robustly for:
  - direct `ps1` execution
  - root `cmd` wrapper execution
  - packaged `exe` execution

## Verified Current State

### Station layout

- Station root:
  - `D:\opt\app\wechat-obsidian-knowledge-base`
- Git-tracked repo:
  - `D:\opt\app\wechat-obsidian-knowledge-base\wechat-backend`
- Vault root:
  - `D:\opt\app\wechat-obsidian-knowledge-base\obsidian-knowledge-base`

### Enabled feed

- Currently enabled feed count: `1`
- Enabled feed:
  - `榴莲忘返-aidd-de39c3`

### Launcher entry points

These are local station files, not part of the Git repository:

- `D:\opt\app\wechat-obsidian-knowledge-base\open-llm-wiki-tools.cmd`
- `D:\opt\app\wechat-obsidian-knowledge-base\llm-wiki-tools.exe`

Launcher implementation source lives at:

- `D:\opt\app\wechat-obsidian-knowledge-base\scripts\gui\llm-wiki-tools.ps1`

### GUI self-test

Verified on 2026-04-09:

- station root resolved correctly
- backend repo resolved correctly
- config file resolved correctly
- command list loaded correctly
- enabled feed list loaded correctly

### Test status

Verified on 2026-04-09:

- `corepack pnpm@8.15.8 run test:llm-wiki`
- Result: `18/18` passing

### PDF schedule status

Verified on 2026-04-09:

- Task name:
  - `LLM Wiki PDF Sync`
- Current state:
  - `Ready`
- Next run time:
  - `2026-04-09 21:15`
- Routine schedule:
  - daily at `09:15`
  - daily at `21:15`
- Routine mode:
  - `--new-only`

This means routine sync handles only newly eligible PDF work. Failed retries are excluded from the normal schedule and remain manual or on-demand operations.

## Runtime Rules

### Normal wiki generation

- `wiki:run` remains on `local-rules`
- Scheduled tasks do not trigger GLM

### Manual GLM

- Use `.env.local` for:
  - `GLM_API_KEY`
  - `GLM_MANUAL_BASE_URL`
- Manual GLM is interactive-only
- Batch guardrails:
  - over `50` articles: strong warning
  - over `100` articles: requires `--allow-large-batch`

### PDF auth profile

The tracked config intentionally leaves these blank:

- `pdf_user_data_dir`
- `pdf_profile_directory`

Reason:

- these values are machine-specific
- they should not be hardcoded into the public repository

If a local station wants to reuse a signed-in Edge profile for institution-login PDF downloads, fill those values locally through the launcher or local config edits after clone.

## Recommended Entry Points

### Local double-click entry

- `D:\opt\app\wechat-obsidian-knowledge-base\open-llm-wiki-tools.cmd`

### Repo docs

- [GLM-MANUAL-MODE.md](./GLM-MANUAL-MODE.md)
- [PDF-AUTO-SYNC.md](./PDF-AUTO-SYNC.md)
- [ZJU-INSTITUTIONAL-PDF-LOGIN.md](./ZJU-INSTITUTIONAL-PDF-LOGIN.md)
- [NEW-MACHINE-DEPLOYMENT.md](./NEW-MACHINE-DEPLOYMENT.md)

## Upload Boundary

The GitHub upload for this round includes:

- LLM-Wiki scripts under `wechat-backend/scripts/`
- config and package updates under `wechat-backend/`
- docs under `wechat-backend/docs/`

The GitHub upload for this round does not include:

- local station root wrappers outside the Git repository
- local Obsidian vault contents
- local `.env.local`
- local browser profile data
