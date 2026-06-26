# Pending Changes Summary

> Snapshot of uncommitted working-tree changes as of 2026-06-25.
> Last commit: `84ba6c2 Before Auth Implementation`.

## Files touched
- `package.json`
- `pnpm-lock.yaml`
- `services/api/package.json`
- `services/api/prisma/schema.prisma`
- `tools/dev.mjs`

## What changed

### Fix: Windows dev launcher (`tools/dev.mjs`)
`run("turbo", "pnpm", ...)` failed to spawn on Windows because `pnpm` resolves to
`pnpm.cmd`, not a directly executable binary via `child_process`. Now picks
`pnpm.cmd` when `process.platform === "win32"`, `pnpm` otherwise.

### Dependency: `prisma-erd-generator` added
Added to both root `package.json` (devDependencies) and
`services/api/package.json` (devDependencies). Lockfile updated accordingly
(also picked up some transitive bumps, e.g. `jiti` 1.21.7 → 2.7.0).

### ⚠️ Inconsistency: Prisma ERD generator block removed
`services/api/prisma/schema.prisma` had its
```prisma
generator erd {
  provider = "prisma-erd-generator"
}
```
block deleted, and the file now has no trailing newline. **This is currently
inconsistent with the dependency add above** — `prisma-erd-generator` is
installed but has no generator block wired into the schema, so it does
nothing. Either restore the generator block (if ERD generation is wanted) or
drop the dependency (if it isn't).

## Suggested next step
Decide whether ERD generation is wanted for this project:
- **Keep it**: re-add the `generator erd { provider = "prisma-erd-generator" }`
  block to `schema.prisma` and run `pnpm db:generate`.
- **Drop it**: remove `prisma-erd-generator` from both `package.json` files and
  run `pnpm install` to clean the lockfile.
