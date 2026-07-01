import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  permissionSchema,
  type AuthUser,
  type Permission,
  type Role,
} from "@amber/domain";
import { PrismaService } from "../prisma/prisma.service.js";
import { AuthService } from "../auth/auth.service.js";

const TEAM_MANAGE: Permission = "team.manage";
const SENSITIVE_PERMISSIONS = new Set<Permission>(["team.manage", "settings.manage"]);

/** Map a Prisma role row → the domain Role shape. */
function toDomainRole(row: {
  id: string;
  tenantId: string;
  name: string;
  permissions: string[];
  protected: boolean;
}): Role {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    permissions: row.permissions.filter(
      (p): p is Permission => permissionSchema.safeParse(p).success,
    ),
    protected: row.protected,
  };
}

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async list(tenantId: string): Promise<Role[]> {
    const rows = await this.prisma.role.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toDomainRole);
  }

  async create(
    tenantId: string,
    actor: AuthUser,
    input: { name: string; permissions: Permission[] },
  ): Promise<Role> {
    // Admin-tier guard: only an Admin may create a role that grants
    // sensitive/tier-defining permissions — otherwise a Manager could mint a
    // fresh (non-protected) role with team.manage/settings.manage and assign
    // it to themselves, sidestepping the protected-role check entirely.
    if (
      !actor.roleProtected &&
      input.permissions.some((p) => SENSITIVE_PERMISSIONS.has(p))
    ) {
      throw new ForbiddenException(
        "Only an Admin can create a role with team or settings management permissions",
      );
    }
    await this.assertNameFree(tenantId, input.name);
    const row = await this.prisma.role.create({
      data: { tenantId, name: input.name, permissions: input.permissions },
    });
    return toDomainRole(row);
  }

  async update(
    tenantId: string,
    actor: AuthUser,
    id: string,
    input: { name?: string; permissions?: Permission[] },
  ): Promise<Role> {
    const role = await this.getOwned(tenantId, id);
    // The protected (Admin) role defines the top tier — only an Admin may rename
    // it or change its permissions; a Manager with team.manage can't.
    if (role.protected && !actor.roleProtected) {
      throw new ForbiddenException("Only an Admin can edit the Admin role");
    }
    if (input.name && input.name !== role.name) {
      await this.assertNameFree(tenantId, input.name);
    }
    // A protected role (the Admin lockout role) must always keep team.manage.
    if (
      role.protected &&
      input.permissions &&
      !input.permissions.includes(TEAM_MANAGE)
    ) {
      throw new BadRequestException(
        "This role is protected and must keep the Manage Team permission",
      );
    }
    const row = await this.prisma.role.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.permissions !== undefined
          ? { permissions: input.permissions }
          : {}),
      },
    });
    // Every member on this role has stale cached permissions now — we don't
    // track role→members here, so drop the whole tenant's auth-user cache.
    this.auth.invalidateTenantAuthUsers(tenantId);
    return toDomainRole(row);
  }

  async remove(tenantId: string, id: string): Promise<{ ok: true }> {
    const role = await this.getOwned(tenantId, id);
    if (role.protected) {
      throw new BadRequestException("Protected roles can't be deleted");
    }
    const inUse = await this.prisma.membership.count({ where: { roleId: id } });
    if (inUse > 0) {
      throw new ConflictException(
        "Reassign the members on this role before deleting it",
      );
    }
    await this.prisma.role.delete({ where: { id } });
    this.auth.invalidateTenantAuthUsers(tenantId);
    return { ok: true };
  }

  /** Fetch a role and verify it belongs to the tenant (404 otherwise). */
  private async getOwned(tenantId: string, id: string) {
    const row = await this.prisma.role.findUnique({ where: { id } });
    if (!row || row.tenantId !== tenantId) {
      throw new NotFoundException("Role not found");
    }
    return row;
  }

  private async assertNameFree(tenantId: string, name: string): Promise<void> {
    const existing = await this.prisma.role.findUnique({
      where: { tenantId_name: { tenantId, name } },
    });
    if (existing) {
      throw new ConflictException(`A role named "${name}" already exists`);
    }
  }
}
