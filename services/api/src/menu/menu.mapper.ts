import type { MenuItem, MenuCategory, ModifierGroup } from "@amber/domain";
import type {
  MenuItem as PrismaMenuItem,
  MenuCategory as PrismaMenuCategory,
  ModifierGroup as PrismaModifierGroup,
  ModifierOption as PrismaModifierOption,
} from "@prisma/client";

/** The item shape menu queries must `include` to map fully. */
export type ItemWithRelations = PrismaMenuItem & {
  category: PrismaMenuCategory;
  modifierGroups: (PrismaModifierGroup & { options: PrismaModifierOption[] })[];
};

/** Prisma category row -> domain MenuCategory. */
export function toDomainCategory(c: PrismaMenuCategory): MenuCategory {
  return {
    id: c.id,
    tenantId: c.tenantId,
    name: c.name,
    sortOrder: c.sortOrder,
  };
}

function toDomainModifierGroup(
  g: PrismaModifierGroup & { options: PrismaModifierOption[] },
): ModifierGroup {
  return {
    id: g.id,
    name: g.name,
    inputType: g.inputType,
    required: g.required,
    minSelect: g.minSelect,
    maxSelect: g.maxSelect,
    maxLength: g.maxLength,
    placeholder: g.placeholder ?? undefined,
    sortOrder: g.sortOrder,
    options: g.options.map((o) => ({
      id: o.id,
      name: o.name,
      priceDelta: o.priceDelta,
      available: o.available,
      sortOrder: o.sortOrder,
    })),
  };
}

/** Prisma item row (with its category + modifiers) -> domain MenuItem. */
export function toDomainItem(i: ItemWithRelations): MenuItem {
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
    dietary: i.dietary ?? null,
    jain: i.jain,
    sortOrder: i.sortOrder,
    modifierGroups: (i.modifierGroups ?? []).map(toDomainModifierGroup),
  };
}
