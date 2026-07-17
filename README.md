# TableFlow

A **multi-tenant restaurant ordering platform**: guests scan a table QR code, order
from their phone, and pay — while staff run the floor, kitchen, billing and menu from
an admin panel. One codebase serves every restaurant tenant; a tenant is just a row
of config (theme, menu, taxes, printer, loyalty) rendered by shared components.

> "Amber" (`@amber/*` package scope, "Amber & Grain" demo tenant) is the internal
> codename / demo data. The product is **TableFlow**.

## What's inside (pnpm workspaces + Turborepo)

| Path | Package | What it is |
|---|---|---|
| `apps/customer` | `@amber/customer` | Guest ordering PWA (Vite + React 19) — QR scan → order → pay. Port **5173** |
| `apps/restaurant-admin` | `@amber/restaurant-admin` | Staff panel — floor/tables, KDS, menu, billing, quick sale, loyalty, analytics, settings + RBAC. Port **5174** |
| `apps/super-admin` | `@amber/super-admin` | Platform panel (tenant onboarding / billing) — shell. Port **5175** |
| `packages/domain` | `@amber/domain` | The contract: Zod schemas + types + money/loyalty/print-layout helpers |
| `packages/api-client` | `@amber/api-client` | One typed HTTP/SSE client for all apps (validates responses against domain schemas) |
| `packages/ui` | `@amber/ui` | `TenantThemeProvider` + design tokens + shared components |
| `packages/config` | `@amber/config` | Shared tsconfig / eslint / Tailwind preset (token → CSS var mapping) |
| `services/api` | `@amber/api` | NestJS 10 + Prisma 6 + PostgreSQL (Supabase) — the source of truth. Port **3001** |
| `services/print-agent` | `@amber/print-agent` | Local print bridge for thermal/label printers (ESC/POS + TSPL). Port **9200** |
| `tools/kds-relay.mjs` | — | Dev KDS relay (SSE, in-memory). Port **4001** |

## Quick start

```bash
pnpm install                                  # install the workspace
cp services/api/.env.example services/api/.env # then fill in DB + Supabase values
pnpm db:generate                              # Prisma client (offline, schema-only)
pnpm --filter @amber/api exec prisma db push  # push schema to the DB
pnpm db:seed                                  # 3 demo tenants with full demo data
pnpm dev                                      # all apps + API via Turbo
```

Seeded demo logins (password `demo1234`): `admin@amberandgrain.com` (Admin),
`manager@amberandgrain.com` (Manager), `kitchen@amberandgrain.com` (Kitchen),
plus `admin@greenbowl.com`, `admin@bellapizza.com`, and the multi-tenant
`owner@ambergroup.com` (exercises the tenant picker).

## Commands (from the repo root)

- `pnpm dev` / `pnpm build` / `pnpm lint` / `pnpm typecheck` / `pnpm test` — fan out via Turbo
- `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:seed` — Prisma (in `@amber/api`)
- Per app: `pnpm --filter @amber/customer dev` (same for the others)
- Tests: Vitest unit tests in `packages/domain/test/`; CI (`.github/workflows/ci.yml`)
  runs install → db:generate → lint → typecheck → test → build on push/PR to main/develop

## Testing on a phone (LAN)

All dev servers bind `0.0.0.0`. Point the apps at your machine's LAN IP via each
app's git-ignored `.env.local` (`VITE_API_URL`, `VITE_KDS_URL`, and for the admin
`VITE_CUSTOMER_URL` so table QR codes resolve from the phone). Restart Vite after
editing. See CLAUDE.md → "LAN / mobile access".

## Documentation map

- **`CLAUDE.md`** / `AGENTS.md` — the project reference: layout, contracts, API
  modules, apps, and the 9 end-to-end flows (start here)
- `docs/PROJECT.md` — deep tree + schema/route maps
- `docs/apps/customer.md` · `docs/apps/restaurant-admin.md` — per-app write-ups
- `api-reference/API-ENDPOINTS.md` — full REST route list
- `api-reference/FEATURES.md` · `api-reference/MODIFIERS.md` — feature inventory / modifier spec
- `services/print-agent/README.md` — printer bridge setup (ESC/POS + TSPL)
