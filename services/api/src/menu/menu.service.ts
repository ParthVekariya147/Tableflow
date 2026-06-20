import { Injectable } from "@nestjs/common";
import type { Menu } from "@amber/domain";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

  /** Full menu for a tenant. All queries scoped by tenantId. */
  async getMenu(tenantId: string): Promise<Menu> {
    const [categories, items] = await Promise.all([
      this.prisma.menuCategory.findMany({
        where: { tenantId },
        orderBy: { sortOrder: "asc" },
      }),
      this.prisma.menuItem.findMany({
        where: { tenantId },
        orderBy: [{ categoryId: "asc" }, { sortOrder: "asc" }],
        include: { category: true },
      }),
    ]);

    return {
      categories: categories.map((c) => ({
        id: c.id,
        tenantId: c.tenantId,
        name: c.name,
        sortOrder: c.sortOrder,
      })),
      items: items.map((i) => ({
        id: i.id,
        tenantId: i.tenantId,
        name: i.name,
        description: i.description,
        price: i.price,
        category: i.category.name,
        badge: i.badge ?? undefined,
        imageUrl: i.imageUrl ?? undefined,
        available: i.available,
        sortOrder: i.sortOrder,
      })),
    };
  }
}
