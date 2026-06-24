import {
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import bcrypt from "bcryptjs";
import {
  effectivePermissions,
  permissionSchema,
  type AuthUser,
  type LoginResponse,
  type LoginResult,
  type Permission,
} from "@amber/domain";
import { PrismaService } from "../prisma/prisma.service.js";
import type { JwtPayload, TicketPayload } from "./auth.types.js";

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
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException("Invalid email or password");
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
