# GLM Manual Mode

## Scope

This mode is for manual LLM-Wiki article summarization only.

- It does not change scheduled tasks.
- It does not change `wiki:run`.
- It does not auto-switch to the standard GLM paid API.

## Environment

Create `D:\opt\app\wechat-obsidian-knowledge-base\wechat-backend\.env.local`:

```bash
GLM_API_KEY=your-rotated-glm-key
GLM_MANUAL_BASE_URL=https://open.bigmodel.cn/api/coding/paas/v4
```

`process.env` takes precedence over `.env.local`.

## Feed Flags

Example feed settings:

```json
{
  "provider": "local-rules",
  "fallback_provider": "local-rules",
  "glm_manual_enabled": true,
  "glm_manual_provider": "glm_coding_manual",
  "glm_primary_model": "glm-5",
  "glm_fallback_models": ["glm-4.7", "glm-4.6"]
}
```

## Commands

Probe model availability:

```bash
corepack pnpm@8.15.8 run wiki:glm:probe -- --feed 榴莲忘返-aidd-de39c3
```

Estimate quota usage:

```bash
corepack pnpm@8.15.8 run wiki:glm:estimate -- --feed 榴莲忘返-aidd-de39c3 --month 2025-03
corepack pnpm@8.15.8 run wiki:glm:estimate -- --feed 榴莲忘返-aidd-de39c3 --month 2025-03 --assume-peak
```

Run manual GLM summarization:

```bash
corepack pnpm@8.15.8 run wiki:glm:run -- --feed 榴莲忘返-aidd-de39c3 --month 2025-03
corepack pnpm@8.15.8 run wiki:glm:run -- --feed 榴莲忘返-aidd-de39c3 --month 2025-03 --new-only
corepack pnpm@8.15.8 run wiki:glm:run -- --feed 榴莲忘返-aidd-de39c3 --month 2025-03 --allow-large-batch
```

## Behavior

- Primary model: `glm-5`
- Fallback order: `glm-4.7`, `glm-4.6`, `local-rules`
- Model fallback happens only for timeout, network failure, unsupported model, empty content, or invalid JSON
- Authentication, quota, permission, and account-level rejections stop the GLM chain and fall back directly to `local-rules`

## Batch Protection

- More than `50` selected articles: the command reports a strong warning in the summary
- More than `100` selected articles: the command stops unless `--allow-large-batch` is provided

## Notes

- The command requires an interactive terminal.
- Manual GLM runs are intended for per-feed or per-month batches, not a whole-vault backfill.
