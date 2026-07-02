# API Reference

Central place for the TableFlow (Amber & Grain) API surface — kept here so it can
be picked up later without re-scanning the NestJS controllers.

## Contents

**API reference (new, generated here):**

| File | What it is |
|---|---|
| `tableflow.postman_collection.json` | Importable Postman collection — all 67 endpoints, grouped by module, with auth auto-save scripts. |
| `API-ENDPOINTS.md` | Full endpoint catalog: method, path, auth/permission gate, request body/DTO, and the controller→service→DTO source files. **Data-mutating (write) endpoints are flagged.** |
| `SECURITY-REVIEW.md` | Security audit — findings ranked by severity, plus the trust model and what's already solid. |

**Project docs (moved here from the repo root):**

| File | What it is |
|---|---|
| `FEATURES.md` | Per-app feature → data-requirement inventory that drives the schema. |
| `MODIFIERS.md` | The custom menu-modifier feature (input types, price deltas). |
| `BRAIN.md` · `CHANGES.md` · `PENDING_TASKS.md` | Working notes, changelog, and open TODOs. |
| `PLATFORM_PLAN.md` · `REALTIME-SYNC-PLAN.md` · `PRINT_RECEIPT_PLAN.md` | Design/implementation plans. |
| `PERFORMANCE_INVESTIGATION.md` · `PRODUCTION_READINESS_AUDIT.md` | Perf and prod-readiness write-ups. |

> `CLAUDE.md` and `README.md` stayed at the repo root (the harness auto-loads
> `CLAUDE.md`; `README.md` is the repo landing page). ⚠️ `CLAUDE.md` still references
> `FEATURES.md`/`MODIFIERS.md` by bare name — they now live in this folder.

## Import the Postman collection

Postman (snap) → **Import** → **files** → pick
`api-reference/tableflow.postman_collection.json` (the snap can read your home dir),
or drag the file onto the window.

Then set the collection **Variables** (`baseUrl`, `tenantSlug`) and run
**Auth → Login** first — a test script auto-saves the JWT into `{{token}}` so every
guarded request works.

## Base facts

- **Base URL:** `http://localhost:3001` (no global prefix — routes are at the root).
- **Tenant scoping:** most routes need `X-Tenant-Slug: <slug>` (SSE streams take
  `?tenant=<slug>` instead — EventSource can't set headers). `/auth/*` and
  `/admin/*` are excluded from tenant scoping.
- **Auth:** `Authorization: Bearer <jwt>` from `POST /auth/login`. 12h access tokens.
- **Guest order routes** are device-bound: `X-Device-Id: <opaque id>` must match the
  id stored when the order was created.
- **Money is always integer cents.**
