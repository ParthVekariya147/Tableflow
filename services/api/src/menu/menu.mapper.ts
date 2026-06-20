import type { MenuItem, MenuCategory } from "@amber/domain";
import type {
  MenuItem as PrismaMenuItem,
  MenuCategory as PrismaMenuCategory,
} from "@prisma/client";

/** Prisma category row -> domain MenuCategory. */
export function toDomainCategory(c: PrismaMenuCategory): MenuCategory {
  return {
    id: c.id,
    tenantId: c.tenantId,
    name: c.name,
    sortOrder: c.sortOrder,
  };
}

/** Prisma item row (with its category) -> domain MenuItem (category as name). */
export function toDomainItem(
  i: PrismaMenuItem & { category: PrismaMenuCategory },
): MenuItem {
  return {
    id: i.id,
    tenantId: i.tenantId,
    name: i.name,
    description: i.description,
    price: i.price,
    category: i.category.name,
    badge: i.badge ?? undefined,
    imageUrl: i.imageUrl ?? undefined,
    icon: i.icon ?? undefined,
    swatch: i.swatch ?? undefined,
    available: i.available,
    sortOrder: i.sortOrder,
  };
}
