## Summary

Describe the change and why it matters.

## What Changed

- 

## Verification

- [ ] `make up`
- [ ] `make backend`
- [ ] `make frontend`
- [ ] `make seed`
- [ ] `UV_CACHE_DIR=/tmp/uv-cache uv run pytest apps/backend/tests/ -v --tb=short`
- [ ] `pnpm lint` in `apps/frontend`
- [ ] `pnpm exec tsc --noEmit` in `apps/frontend`

## Screenshots / Notes

Add screenshots, logs, or extra context if helpful.

## Checklist

- [ ] I updated docs if behavior or setup changed
- [ ] I added or updated tests when appropriate
- [ ] I did not commit secrets, caches, or generated junk
