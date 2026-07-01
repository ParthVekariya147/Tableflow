import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import bcrypt from "bcryptjs";
import {
  effectivePermissions,
  permissionSchema,
  type AuthUser,
  type Membership,
  type Permission,
} from "@amber/domain";
import { PrismaService } from "../prisma/prisma.service.js";
import { AuthService } from "../auth/auth.service.js";

const TEAM_MANAGE: Permission = "team.manage";

/** Default password for a newly-added member (until email invites land). */
export const DEFAULT_MEMBER_PASSWORD = "changeme123";

type MembershipRow = {
  id: string;
  tenantId: string;
  userId: string;
  roleId: string;
  permissions: string[];
  active: boolean;
  user: { id: string; email: string; name: string; isSuperAdmin: boolean; active: boolean };
  role: { id: string; tenantId: string; name: string; permissions: string[]; protected: boolean };
};

function sanitize(keys: string[]): Permission[] {
  return keys.filter((k): k is Permission => permissionSchema.safeParse(k).success);
}

function toDomainMembership(row: MembershipRow): Membership {
  const rolePerms = sanitize(row.role.permissions);
  const override = sanitize(row.permissions);
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    roleId: row.roleId,
    permissions: override,
    active: row.active,
    user: {
      id: row.user.id,
      email: row.user.email,
      name: row.user.name,
      isSuperAdmin: row.user.isSuperAdmin,
      active: row.user.active,
    },
    role: {
      id: row.role.id,
      tenantId: row.role.tenantId,
      name: row.role.name,
      permissions: rolePerms,
      protected: row.role.protected,
    },
  };
}

/** Does this membership effectively hold team.manage? */
function isManager(row: { permissions: string[]; role: { permissions: string[] } }): boolean {
  return effectivePermissions(
    sanitize(row.role.permissions),
    sanitize(row.permissions),
  ).includes(TEAM_MANAGE);
}

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async list(tenantId: string): Promise<Membership[]> {
    const rows = await this.prisma.membership.findMany({
      where: { tenantId },
      include: { user: true, role: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => toDomainMembership(r as MembershipRow));
  }

  async add(
    tenantId: string,
    actor: AuthUser,
    input: { email: string; name: string; roleId: string; permissions: Permission[] },
  ): Promise<Membership> {
    const role = await this.assertRoleOwned(tenantId, input.roleId);
    // Only an Admin can mint another Admin — a Manager can't promote into the
    // protected tier (would side-step the whole hierarchy).
    this.assertCanManageProtected(actor, role.protected);
    const email = input.email.toLowerCase();

    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email,
          name: input.name,
          passwordHash: await bcrypt.hash(DEFAULT_MEMBER_PASSWORD, 10),
          mustChangePassword: true,
        },
      });
    }

    const existing = await this.prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: user.id } },
    });
    if (existing) {
      throw new ConflictException("This person is already a member");
    }

    const row = await this.prisma.membership.create({
      data: {
        tenantId,
        userId: user.id,
        roleId: input.roleId,
        permissions: input.permissions,
      },
      include: { user: true, role: true },
    });
    return toDomainMembership(row as MembershipRow);
  }

  async update(
    tenantId: string,
    actor: AuthUser,
    id: string,
    input: { roleId?: string; permissions?: Permission[]; active?: boolean },
  ): Promise<Membership> {
    const current = await this.getOwned(tenantId, id);
    // Admin-tier guard: a non-Admin can neither touch a member who is already on
    // a protected (Admin) role, nor move someone onto one.
    this.assertCanManageProtected(actor, current.role.protected);
    if (input.roleId && input.roleId !== current.roleId) {
      const nextRole = await this.assertRoleOwned(tenantId, input.roleId);
      this.assertCanManageProtected(actor, nextRole.protected);
    }

    // Predict whether this member would still be a team manager after the change,
    // and block if it would remove the LAST one (lockout guard).
    const nextRolePerms = input.roleId
      ? (await this.prisma.role.findUnique({ where: { id: input.roleId } }))!.permissions
      : current.role.permissions;
    const nextOverride = input.permissions ?? current.permissions;
    const nextActive = input.active ?? current.active;
    const stillManager =
      nextActive &&
      effectivePermissions(sanitize(nextRolePerms), sanitize(nextOverride)).includes(
        TEAM_MANAGE,
      );
    if (isManager(current) && !stillManager) {
      await this.assertNotLastManager(tenantId, id);
    }

    const row = await this.prisma.membership.update({
      where: { id },
      data: {
        ...(input.roleId !== undefined ? { roleId: input.roleId } : {}),
        ...(input.permissions !== undefined
          ? { permissions: input.permissions }
          : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
      include: { user: true, role: true },
    });
    this.auth.invalidateAuthUser(tenantId, current.userId);
    return toDomainMembership(row as MembershipRow);
  }

  async remove(tenantId: string, actor: AuthUser, id: string): Promise<{ ok: true }> {
    const current = await this.getOwned(tenantId, id);
    // A non-Admin can't remove a member on the protected (Admin) tier.
    this.assertCanManageProtected(actor, current.role.protected);
    if (isManager(current)) {
      await this.assertNotLastManager(tenantId, id);
    }
    await this.prisma.membership.delete({ where: { id } });
    this.auth.invalidateAuthUser(tenantId, current.userId);
    return { ok: true };
  }

  // ── guards ────────────────────────────────────────────────────────────────

  private async getOwned(tenantId: string, id: string): Promise<MembershipRow> {
    const row = await this.prisma.membership.findUnique({
      where: { id },
      include: { user: true, role: true },
    });
    if (!row || row.tenantId !== tenantId) {
      throw new NotFoundException("Member not found");
    }
    return row as MembershipRow;
  }

  private async assertRoleOwned(tenantId: string, roleId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role || role.tenantId !== tenantId) {
      throw new NotFoundException("Role not found");
    }
    return role;
  }

  /**
   * Admin-tier guard: a protected-role member can only be managed by another
   * protected-role holder. Stops a Manager (with team.manage) from editing,
   * removing, or promoting into the Admin tier — only an Admin manages Admins.
   */
  private assertCanManageProtected(actor: AuthUser, targetProtected: boolean): void {
    if (targetProtected && !actor.roleProtected) {
      throw new ForbiddenException("Only an Admin can manage Admin-level members");
    }
  }

  /** Throw if `excludeId` is the only active member who holds team.manage. */
  private async assertNotLastManager(
    tenantId: string,
    excludeId: string,
  ): Promise<void> {
    const others = await this.prisma.membership.findMany({
      where: { tenantId, active: true, id: { not: excludeId } },
      include: { role: true },
    });
    const someoneElseManages = others.some((m) =>
      isManager(m as { permissions: string[]; role: { permissions: string[] } }),
    );
    if (!someoneElseManages) {
      throw new BadRequestException(
        "Can't remove the last admin — assign Manage Team to someone else first",
      );
    }
  }
}
