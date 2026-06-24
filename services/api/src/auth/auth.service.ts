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
  type Permission,
} from "@amber/domain";
import { PrismaService } from "../prisma/prisma.service.js";
import type { JwtPayload } from "./auth.types.js";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Verify email + password against the tenant and issue a token. The user must
   * have an active membership at this tenant (a valid login elsewhere is still
   * rejected here). The token carries only ids; permissions are re-resolved on
   * every request by the guard so a role/permission change takes effect at once.
   */
  async login(
    tenantId: string,
    email: string,
    password: string,
  ): Promise<LoginResponse> {
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

    const authUser = await this.resolveAuthUser(tenantId, user.id);
    const payload: JwtPayload = { sub: user.id, tid: tenantId };
    const token = await this.jwt.signAsync(payload);
    return { token, user: authUser };
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
      include: { role: true },
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
      roleId: membership.roleId,
      roleName: membership.role.name,
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
