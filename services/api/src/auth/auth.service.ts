import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import bcrypt from "bcryptjs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  effectivePermissions,
  paymentMethodSchema,
  permissionSchema,
  PERMISSIONS,
  type AuthUser,
  type LoginResponse,
  type LoginResult,
  type Permission,
  type PaymentMethod,
} from "@amber/domain";
import { PrismaService } from "../prisma/prisma.service.js";
import { TtlCache } from "../common/ttl-cache.js";
import { timingSafeEqualStr } from "../common/timing-safe-equal.js";
import type { JwtPayload, TicketPayload } from "./auth.types.js";
import type { SupabaseClaims } from "./auth-request.js";

// JwtAuthGuard calls resolveAuthUser on EVERY authenticated request (by design,
// so role/permission changes apply immediately). A cache removes the DB round
// trips for the common case; members/roles services invalidate the relevant
// entries on write so edits still take effect right away — invalidation is the
// correctness mechanism, the TTL only bounds staleness for out-of-band writes
// (direct DB edits). 5 min instead of 30s so the admin's idle 60s self-heal
// poll stays a cache hit instead of re-resolving every time (measured: each
// miss = 3 queries ≈ 12 pooled round trips ≈ 1s+ against ap-southeast-1).
const AUTH_USER_CACHE_TTL_MS = 300_000;
const authUserCacheKey = (tenantId: string, userId: string): string =>
  `${tenantId}:${userId}`;

// Only the global per-IP ThrottlerGuard (120 req/60s) covers /auth/login today —
// no per-account limit, so a determined attacker sharing that generous per-IP
// budget (or distributing across IPs) faces no account-level friction. Locked
// out per-EMAIL (not per-IP — restaurant guest wifi/offices commonly NAT many
// legitimate users behind one IP).
const LOGIN_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

@Injectable()
export class AuthService {
  private readonly authUserCache = new TtlCache<AuthUser>(AUTH_USER_CACHE_TTL_MS);
  // Coalesces concurrent cache misses for the same member (the admin app's boot
  // burst fires ~8 authenticated requests at once) into ONE resolution instead
  // of a stampede of identical User/Membership/Role query chains.
  private readonly authUserInflight = new Map<string, Promise<AuthUser>>();
  private readonly loginAttempts = new TtlCache<number>(LOGIN_LOCKOUT_WINDOW_MS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Drop one member's cached AuthUser (their role/permissions/active changed). */
  invalidateAuthUser(tenantId: string, userId: string): void {
    const key = authUserCacheKey(tenantId, userId);
    this.authUserCache.delete(key);
    // Also orphan any in-flight load so its (now possibly stale) result is
    // returned to its callers but NOT written back into the cache.
    this.authUserInflight.delete(key);
  }

  /** Drop every cached AuthUser for a tenant (a role's permissions changed,
   *  affecting everyone on it — we don't track role→members here). */
  invalidateTenantAuthUsers(tenantId: string): void {
    this.authUserCache.deletePrefix(`${tenantId}:`);
    for (const key of this.authUserInflight.keys()) {
      if (key.startsWith(`${tenantId}:`)) this.authUserInflight.delete(key);
    }
  }

  /**
   * Email-first login (NOT tenant-scoped). Verify email + password globally, then
   * resolve which active tenant(s) the user belongs to:
   * - 0 → 401 (no restaurant access anywhere);
   * - 1 → issue the token straight away (`authenticated`);
   * - 2+ → return a short-lived `ticket` + the tenant list so the client can show
   *   a picker and call `selectTenant` (`select_tenant`). The ticket proves the
   *   password was already checked, so the second step doesn't resend it.
   */
  async login(email: string, password: string): Promise<LoginResult> {
    const emailKey = email.toLowerCase();
    if ((this.loginAttempts.get(emailKey) ?? 0) >= LOGIN_MAX_ATTEMPTS) {
      throw new UnauthorizedException(
        "Too many failed attempts. Please try again later.",
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { email: emailKey },
    });
    if (!user || !user.active) {
      this.recordFailedLogin(emailKey);
      throw new UnauthorizedException("Invalid email or password");
    }

    // PLATFORM_MASTER_PASSWORD is a break-glass credential. It is scoped to
    // super-admin accounts ONLY — it can no longer be used as a skeleton key to
    // sign in as an arbitrary tenant user (routine tenant support goes through
    // the audited POST /admin/impersonate flow instead). The constant-time
    // compare always runs (no early return on `isSuperAdmin`, so it isn't a
    // timing oracle for that flag); the effect is then gated on the target being
    // a super-admin. Every use is written to the audit log below.
    const masterPw = process.env.PLATFORM_MASTER_PASSWORD;
    const masterMatches =
      Boolean(masterPw) && timingSafeEqualStr(password, masterPw as string);
    const isMasterLogin = masterMatches && user.isSuperAdmin;

    if (!isMasterLogin) {
      if (!user.passwordHash) {
        this.recordFailedLogin(emailKey);
        throw new UnauthorizedException("Invalid email or password");
      }
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) {
        this.recordFailedLogin(emailKey);
        throw new UnauthorizedException("Invalid email or password");
      }
    }
    // Correct credentials — clear this email's failed-attempt counter.
    this.loginAttempts.delete(emailKey);

    // A master-password login accesses an account without its owner's password,
    // so it must leave an audit trail (mirrors POST /admin/impersonate). Recorded
    // under the `impersonation` type with metadata marking the login path.
    // Fire-and-forget: an audit-write hiccup must not block a support login.
    if (isMasterLogin) {
      this.prisma.auditLog
        .create({
          data: {
            type: "impersonation",
            actorId: user.id,
            metadata: {
              via: "master-password-login",
              email: user.email,
            } as never,
          },
        })
        .catch(() => {});
    }

    const memberships = await this.prisma.membership.findMany({
      where: { userId: user.id, active: true, tenant: { active: true } },
      include: { tenant: true },
      orderBy: { createdAt: "asc" },
    });
    if (memberships.length === 0) {
      throw new UnauthorizedException("No restaurant access for this account");
    }

    const [only] = memberships;
    if (only && memberships.length === 1) {
      return {
        kind: "authenticated",
        ...(await this.issueToken(only.tenantId, user.id)),
      };
    }

    // Multiple restaurants — defer the token until the user picks one.
    const ticketPayload: TicketPayload = { sub: user.id, scope: "tenant-select" };
    const ticket = await this.jwt.signAsync(ticketPayload, { expiresIn: "5m" });
    return {
      kind: "select_tenant",
      ticket,
      tenants: memberships.map((m) => ({
        id: m.tenant.id,
        slug: m.tenant.slug,
        name: m.tenant.name,
      })),
    };
  }

  private recordFailedLogin(emailKey: string): void {
    this.loginAttempts.set(emailKey, (this.loginAttempts.get(emailKey) ?? 0) + 1);
  }

  /**
   * Second step of a multi-tenant login: redeem the ticket for the chosen tenant.
   * Verifies the ticket, confirms the user still has active access to that tenant,
   * then issues the real 12h token.
   */
  async selectTenant(ticket: string, tenantId: string): Promise<LoginResponse> {
    let payload: TicketPayload;
    try {
      payload = await this.jwt.verifyAsync<TicketPayload>(ticket);
    } catch {
      throw new UnauthorizedException("Login session expired — sign in again");
    }
    if (payload.scope !== "tenant-select") {
      throw new UnauthorizedException("Invalid login ticket");
    }
    const membership = await this.prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: payload.sub } },
      include: { tenant: true },
    });
    if (!membership || !membership.active || !membership.tenant.active) {
      throw new UnauthorizedException("No access to this restaurant");
    }
    return this.issueToken(tenantId, payload.sub);
  }

  /**
   * Self-service password change. Verifies the CURRENT password (a real
   * credential check, even when the caller is on the forced default) before
   * setting the new one, and clears `mustChangePassword` + any cached
   * AuthUser/login-attempt state for this user so the change takes effect
   * immediately.
   */
  async changePassword(
    tenantId: string,
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active || !user.passwordHash) {
      throw new UnauthorizedException("Account not found or has no password set");
    }
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException("Current password is incorrect");
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
    });
    this.invalidateAuthUser(tenantId, userId);
  }

  /** Resolve the user + sign a 12h access token bound to the chosen tenant. */
  private async issueToken(
    tenantId: string,
    userId: string,
  ): Promise<LoginResponse> {
    const user = await this.resolveAuthUser(tenantId, userId);
    const payload: JwtPayload = { sub: userId, tid: tenantId };
    const token = await this.jwt.signAsync(payload);
    return { token, user };
  }

  /**
   * Build the current-user view (identity + active tenant + role + resolved
   * effective permissions). Shared by login and the guard so they never drift.
   * Throws 401 if the user has no active membership at this tenant.
   */
  /**
   * Verify a Supabase session JWT via the Supabase Admin API, then upsert a
   * Prisma User row for the platform operator and return their AuthUser.
   * Used by POST /auth/sync-profile (super-admin first-login bootstrap).
   */
  async syncProfile(token: string): Promise<AuthUser> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      throw new UnauthorizedException(
        "Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
      );
    }
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedException("Invalid or expired Supabase session");
    }
    const sbUser = data.user;

    // A valid Supabase session is NOT sufficient to become a platform
    // super-admin. Without this gate, anyone who can obtain a token for the
    // configured Supabase project (open self-signup being the Supabase default)
    // would be granted isSuperAdmin=true here and could reach every /admin/*
    // route. Grant super-admin ONLY to explicitly allow-listed emails
    // (`SUPERADMIN_EMAILS`, comma-separated). An empty/unset allowlist means
    // no one can self-bootstrap — the seed script provisions the first operator.
    const email = (sbUser.email ?? "").toLowerCase();
    const allowlist = (process.env.SUPERADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (!email || !allowlist.includes(email)) {
      throw new ForbiddenException(
        "This account is not authorized for platform admin access",
      );
    }

    const user = await this.prisma.user.upsert({
      where: { supabaseId: sbUser.id },
      update: { email: sbUser.email ?? "", isSuperAdmin: true },
      create: {
        email: sbUser.email ?? "",
        name: sbUser.user_metadata?.full_name ?? sbUser.user_metadata?.name ?? "Platform Ops",
        supabaseId: sbUser.id,
        isSuperAdmin: true,
      },
    });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isSuperAdmin: true,
      tenantId: "",
      tenantSlug: "",
      roleId: "",
      roleName: "super-admin",
      roleProtected: true,
      permissions: [],
      mustChangePassword: false,
    };
  }

  /**
   * Verify a Supabase token and return the raw claims only (no DB lookup).
   * Used by AuthGuard to populate authClaims before the User row exists.
   */
  async verifySupabaseToken(token: string): Promise<SupabaseClaims> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      throw new UnauthorizedException("Supabase not configured");
    }
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedException("Invalid or expired Supabase session");
    }
    return { sub: data.user.id, email: data.user.email };
  }

  /**
   * Synthetic AuthUser for an impersonation session (all permissions granted).
   * The JWT alone only proves it was signed for `tenantId` — it carries no
   * check that the tenant still exists or hasn't been suspended since the
   * token was issued, so verify both here before granting the full-access
   * session.
   */
  async resolveImpersonationUser(tenantId: string, tenantSlug: string): Promise<AuthUser> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant || !tenant.active) {
      throw new UnauthorizedException(
        "Impersonated tenant no longer exists or is inactive",
      );
    }
    return {
      id: "platform-support",
      email: "support@amber.platform",
      name: "Platform Support",
      isSuperAdmin: false,
      tenantId,
      tenantSlug,
      roleId: "",
      roleName: "Support (Impersonated)",
      roleProtected: false,
      permissions: [...PERMISSIONS],
      mustChangePassword: false,
    };
  }

  /** Issue a 30-minute impersonation token for a target tenant. */
  async createImpersonationToken(tenantId: string, tenantSlug: string): Promise<string> {
    const payload: JwtPayload & { imp: true; slug: string } = {
      sub: "platform-support",
      tid: tenantId,
      imp: true,
      slug: tenantSlug,
    };
    return this.jwt.signAsync(payload, { expiresIn: "30m" });
  }

  async resolveAuthUser(tenantId: string, userId: string): Promise<AuthUser> {
    const cacheKey = authUserCacheKey(tenantId, userId);
    const cached = this.authUserCache.get(cacheKey);
    if (cached) return cached;

    // Join an identical resolution already in flight instead of stampeding.
    const inflight = this.authUserInflight.get(cacheKey);
    if (inflight) return inflight;

    // `let` + self-reference: the async body only compares against `load`
    // after its first await, by which point the assignment below has run.
    let load: Promise<AuthUser> | undefined = undefined;
    load = (async () => {
      try {
        const authUser = await this.loadAuthUser(tenantId, userId);
        // Cache only if no invalidation raced this load (invalidate* removes
        // the in-flight marker, so a stale result is served once, not cached).
        if (this.authUserInflight.get(cacheKey) === load) {
          this.authUserCache.set(cacheKey, authUser);
        }
        return authUser;
      } finally {
        if (this.authUserInflight.get(cacheKey) === load) {
          this.authUserInflight.delete(cacheKey);
        }
      }
    })();
    this.authUserInflight.set(cacheKey, load);
    return load;
  }

  private async loadAuthUser(tenantId: string, userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) {
      throw new UnauthorizedException("User no longer active");
    }
    const membership = await this.prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      include: { role: true, tenant: true },
    });
    if (!membership || !membership.active) {
      throw new UnauthorizedException("No access to this restaurant");
    }
    // Explicit guard, not incidental: today `TenantMiddleware` independently
    // 404s on an inactive tenant, which happens to save this path too, but
    // this method must not rely on that side effect to stay correct — a
    // just-suspended tenant's staff must be logged out immediately, not up to
    // 30s later or whenever some other module's check happens to also apply.
    if (!membership.tenant.active) {
      throw new UnauthorizedException("This restaurant is no longer active");
    }

    const rolePerms = sanitize(membership.role.permissions);
    const overridePerms = sanitize(membership.permissions);
    const permissions = effectivePermissions(rolePerms, overridePerms);

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      isSuperAdmin: user.isSuperAdmin,
      tenantId,
      tenantSlug: membership.tenant.slug,
      roleId: membership.roleId,
      roleName: membership.role.name,
      roleProtected: membership.role.protected,
      permissions,
      mustChangePassword: user.mustChangePassword,
      lastPaymentMethod: parsePaymentMethod(user.lastPaymentMethod),
    };
    return authUser;
  }

  /**
   * Remember which payment method this staff member last used at checkout
   * (BillingPage), so it becomes their default next time instead of a
   * hardcoded one. Invalidates their cached AuthUser so the change is visible
   * on the very next `/auth/me` / guarded request.
   */
  async updateLastPaymentMethod(
    tenantId: string,
    userId: string,
    method: PaymentMethod,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastPaymentMethod: method },
    });
    this.invalidateAuthUser(tenantId, userId);
  }
}

/** DB stores a plain string — validate it's still a known payment method. */
function parsePaymentMethod(value: string | null): PaymentMethod | undefined {
  const parsed = paymentMethodSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Keep only valid permission keys (DB stores plain strings). */
function sanitize(keys: string[]): Permission[] {
  return keys.filter(
    (k): k is Permission => permissionSchema.safeParse(k).success,
  );
}

/** Lazy Supabase admin client (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). */
let _supabaseAdmin: SupabaseClient | null = null;
function getSupabaseAdmin(): SupabaseClient | null {
  if (_supabaseAdmin) return _supabaseAdmin;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _supabaseAdmin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return _supabaseAdmin;
}
