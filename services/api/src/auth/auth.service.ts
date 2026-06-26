import {
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import bcrypt from "bcryptjs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  effectivePermissions,
  permissionSchema,
  PERMISSIONS,
  type AuthUser,
  type LoginResponse,
  type LoginResult,
  type Permission,
} from "@amber/domain";
import { PrismaService } from "../prisma/prisma.service.js";
import type { JwtPayload, TicketPayload } from "./auth.types.js";
import type { SupabaseClaims } from "./auth-request.js";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

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
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user || !user.active) {
      throw new UnauthorizedException("Invalid email or password");
    }

    // PLATFORM_MASTER_PASSWORD lets super-admins log in as any tenant user
    // without knowing that user's password (for support / impersonation via login).
    const masterPw = process.env.PLATFORM_MASTER_PASSWORD;
    const isMasterLogin = masterPw && password === masterPw;

    if (!isMasterLogin) {
      if (!user.passwordHash) {
        throw new UnauthorizedException("Invalid email or password");
      }
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) {
        throw new UnauthorizedException("Invalid email or password");
      }
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

  /** Synthetic AuthUser for an impersonation session (all permissions granted). */
  resolveImpersonationUser(tenantId: string, tenantSlug: string): AuthUser {
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

    const rolePerms = sanitize(membership.role.permissions);
    const overridePerms = sanitize(membership.permissions);
    const permissions = effectivePermissions(rolePerms, overridePerms);

    return {
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
    };
  }
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
