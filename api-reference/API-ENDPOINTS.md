# API Endpoint Catalog

All routes of `@amber/api` (NestJS). Base URL `http://localhost:3001`, no global prefix.

**Legend**
- ✏️ = **writes/mutates data** (creates, updates, deletes, or captures money)
- 🔓 = public / no auth token (guest or unauthenticated)
- 🔑 = requires `Authorization: Bearer <jwt>` + the listed permission
- 🎫 = super-admin (Supabase token) route
- 📱 = guest, device-bound (`X-Device-Id` must match the order)
- 🏷️ = needs `X-Tenant-Slug` header (or `?tenant=` for SSE)

Source layout per module: `*.controller.ts` (routes/guards) → `*.service.ts`
(logic + DB) → `*.dto.ts` (Zod request validation, the trust boundary).

---

## Health — `health/`
| M | Path | Gate | Notes |
|---|---|---|---|
| GET | `/health` | 🔓 | liveness check |

## Auth — `auth/` (NOT tenant-scoped)
| M | Path | Gate | Body |
|---|---|---|---|
| ✏️ POST | `/auth/login` | 🔓 | `{ email, password }` → `{token,user}` or `{kind:"select_tenant",ticket,tenants}` |
| ✏️ POST | `/auth/select-tenant` | 🔓 (ticket) | `{ ticket, tenantId }` → `{token,user}` |
| GET | `/auth/me` | 🔑 | current `AuthUser` |
| ✏️ POST | `/auth/change-password` | 🔑 | `{ currentPassword, newPassword(min 8) }` |
| ✏️ POST | `/auth/sync-profile` | 🎫 Supabase | super-admin first-login bootstrap |

## Tenant — `tenant/`
| M | Path | Gate | Body |
|---|---|---|---|
| GET | `/tenant` | 🏷️ | active tenant |
| ✏️ PATCH | `/tenant` | 🏷️🔑 `settings.manage` | `{ name, currency, taxRate, gstNumber?, upiId?, upiMobile?, theme }` |
| GET | `/tenants/:slug` | 🔓 | public tenant by slug (guest boot) |

## Menu — `menu/`  (all writes gated by `menu.manage`)
| M | Path | Gate | Body |
|---|---|---|---|
| GET | `/menu` | 🏷️🔓 | full menu (guest reads it) |
| ✏️ POST | `/menu/upload` | 🏷️🔑 `menu.manage` | multipart `file` (image, ≤5 MB) → `{ url }` |
| ✏️ POST | `/menu/categories` | 🏷️🔑 `menu.manage` | `{ name, sortOrder? }` |
| ✏️ PATCH | `/menu/categories/:id` | 🏷️🔑 `menu.manage` | `{ name?, sortOrder? }` |
| ✏️ DELETE | `/menu/categories/:id` | 🏷️🔑 `menu.manage` | (blocked while it holds items) |
| ✏️ POST | `/menu/items` | 🏷️🔑 `menu.manage` | `{ categoryId, name, price(cents), …, modifierGroups[] }` |
| ✏️ PATCH | `/menu/items/:id` | 🏷️🔑 `menu.manage` | partial item; `modifierGroups` = replace-on-save |
| ✏️ DELETE | `/menu/items/:id` | 🏷️🔑 `menu.manage` | |

## Tables — `tables/`  (all writes gated by `tables.manage`)
| M | Path | Gate | Body |
|---|---|---|---|
| GET | `/tables` | 🏷️🔑 `tables.manage` | floor + live sessions |
| GET | `/tables/qr/:token` | 🏷️🔓 | resolve table by QR token (guest boot) |
| ✏️ POST | `/tables` | 🏷️🔑 `tables.manage` | `{ label, seats?, room?, sortOrder? }` |
| ✏️ PATCH | `/tables/:id` | 🏷️🔑 `tables.manage` | partial table |
| ✏️ POST | `/tables/:id/qr` | 🏷️🔑 `tables.manage` | regenerate QR token |
| ✏️ DELETE | `/tables/:id` | 🏷️🔑 `tables.manage` | (blocked while occupied / with history) |

## Orders — `orders/`  (mixed: staff routes gated, guest routes device-bound)
| M | Path | Gate | Body / notes |
|---|---|---|---|
| GET (SSE) | `/orders/stream` | 🏷️ `OrderStreamGuard` | `?tenant=slug`; snapshot + live events |
| GET | `/orders` | 🏷️🔑 `tables.manage` | `?status=open\|billed\|paid\|closed` |
| GET | `/orders/open-table-ids` | 🏷️🔓 | occupancy list (guest boot) |
| GET | `/orders/sales` | 🏷️🔑 `orders.history` | `?from=&to=` |
| GET | `/orders/analytics` | 🏷️🔑 `analytics.view`\|`dashboard.view` | `?from=&to=` |
| GET | `/orders/:id` | 🏷️📱 | guest reads own order (device check) |
| GET | `/orders/:id/payment` | 🏷️🔑 `tables.manage` | |
| ✏️ POST | `/orders/reclaim` | 🏷️📱 | `{ tableId, customerPhone }` — re-bind lost session |
| ✏️ POST | `/orders` | 🏷️📱🔓 | `{ tableId, customerName?, customerPhone? }` — guest reserve |
| ✏️ POST | `/orders/:id/rounds` | 🏷️📱 | `{ type, items[] }` — guest adds a round |
| ✏️ POST | `/orders/:id/items` | 🏷️🔑 `tables.manage` | `{ menuItemId, qty }` — staff adds item |
| ✏️ PATCH | `/orders/:id/items/:itemId` | 🏷️🔑 `kds.use`\|`tables.manage` | `{ qty?\|qtyDelta?, status? }` |
| ✏️ POST | `/orders/:id/bill` | 🏷️📱 | guest requests bill |
| ✏️ POST | `/orders/:id/cancel` | 🏷️🔑 `tables.manage` | staff cancels session |
| ✏️ POST | `/orders/:id/payment` | 🏷️📱 | `{ method, tip, tendered? }` — capture + close |

> ⚠️ The guest-facing `/orders` write routes (create, rounds, bill, payment,
> reclaim) are **not JWT-gated by design** — they rely on the `X-Device-Id`
> capability + the create-order occupancy guard. See `SECURITY-REVIEW.md` for the
> residual gaps (a caller who omits the header is indistinguishable from staff).

## Service Requests — `service-requests/`
| M | Path | Gate | Body |
|---|---|---|---|
| GET (SSE) | `/service-requests/stream` | 🏷️ `ServiceRequestStreamGuard` | `?tenant=slug` |
| ✏️ POST | `/service-requests` | 🏷️🔓 | `{ tableId, type }` — guest create (deduped) |
| GET | `/service-requests` | 🏷️🔑 `tables.manage` | `?status=` |
| ✏️ PATCH | `/service-requests/:id` | 🏷️🔑 `tables.manage` | `{ status }` ack/resolve |

## Roles — `roles/`  (whole controller: `team.manage`)
| M | Path | Body |
|---|---|---|
| GET | `/roles` | list |
| ✏️ POST | `/roles` | `{ name, permissions[] }` |
| ✏️ PATCH | `/roles/:id` | `{ name?, permissions? }` |
| ✏️ DELETE | `/roles/:id` | (blocked if protected / has members) |

## Members — `members/`  (whole controller: `team.manage`)
| M | Path | Body |
|---|---|---|
| GET | `/members` | list |
| ✏️ POST | `/members` | `{ email, name, roleId, permissions[] }` — creates user if new (temp pw `changeme123`) |
| ✏️ PATCH | `/members/:id` | `{ roleId?, permissions?, active? }` |
| ✏️ DELETE | `/members/:id` | (last-admin lockout guard) |

## Super Admin — `admin/`  (🎫 `SupabaseAuthGuard`+`SuperAdminGuard`, no tenant header)
| M | Path | Body / notes |
|---|---|---|
| GET | `/admin/tenants` | list w/ subscriptions |
| ✏️ POST | `/admin/tenants` | `{ slug, name, currency, taxRate, theme, ownerEmail?, ownerName?, ownerPassword? }` |
| GET | `/admin/tenants/:id` | one tenant |
| ✏️ PATCH | `/admin/tenants/:id` | `{ name?, active?, taxRate?, currency?, theme? }` |
| GET | `/admin/tenants/:id/payments` | payments feed |
| GET | `/admin/credentials` | credentials overview |
| ✏️ POST | `/admin/tenants/:id/reset-owner-password` | `{ userId, newPassword }` |
| ✏️ POST | `/admin/impersonate` | `{ tenantSlug, masterPassword }` → 30-min token (audit-logged) |
| GET | `/admin/analytics` | platform analytics |
| GET | `/admin/audit-log` | `?type&tenantId&from&to&limit&offset` |

## Billing — `billing/`
| M | Path | Gate | Body |
|---|---|---|---|
| GET | `/admin/plans` | 🎫 | list plans |
| ✏️ POST | `/admin/plans` | 🎫 | `{ name, priceCents, interval, limits }` |
| ✏️ PATCH | `/admin/plans/:id` | 🎫 | partial + `active?` |
| ✏️ POST | `/admin/tenants/:id/subscription` | 🎫 | `{ planId }` |
| GET | `/admin/tenants/:id/subscription` | 🎫 | |
| ✏️ PATCH | `/admin/tenants/:id/subscription` | 🎫 | `{ status?, cancelAtPeriodEnd? }` |
| GET | `/billing/me` | 🏷️🔑 | tenant's own subscription |

---

## Quick index of "adds data" endpoints (the ✏️ writes)

Onboarding/config: `POST /admin/tenants`, `POST /admin/plans`, `PATCH /tenant`,
`POST /roles`, `POST /members`, `POST /menu/categories`, `POST /menu/items`,
`POST /menu/upload`, `POST /tables`.

Live session flow: `POST /orders` → `POST /orders/:id/rounds` /
`POST /orders/:id/items` → `PATCH /orders/:id/items/:itemId` →
`POST /orders/:id/bill` → `POST /orders/:id/payment`.

Guest signals: `POST /service-requests`.
