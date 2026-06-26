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

const TEAM_MANAGE: Permission = "team.manage";

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
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<Role[]> {
    const rows = await this.prisma.role.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toDomainRole);
  }

  async create(
    tenantId: string,
    input: { name: string; permissions: Permission[] },
  ): Promise<Role> {
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
