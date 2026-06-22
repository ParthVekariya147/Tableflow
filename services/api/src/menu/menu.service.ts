import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import type { Menu, MenuItem, MenuCategory } from "@amber/domain";
import { PrismaService } from "../prisma/prisma.service.js";
import { toDomainCategory, toDomainItem } from "./menu.mapper.js";
import type {
  CreateCategoryDto,
  CreateItemDto,
  UpdateCategoryDto,
  UpdateItemDto,
} from "./menu.dto.js";

/** Everything an item needs to map to the full domain shape. */
const ITEM_INCLUDE = {
  category: true,
  modifierGroups: {
    orderBy: { sortOrder: "asc" },
    include: { options: { orderBy: { sortOrder: "asc" } } },
  },
} as const;

type ModifierGroupInput = NonNullable<CreateItemDto["modifierGroups"]>[number];

@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

  /** Build the nested Prisma `create` payload for an item's modifier groups +
   *  options. `text` groups carry no options. */
  private modifierGroupsCreate(tenantId: string, groups: ModifierGroupInput[]) {
    return groups.map((g, gi) => ({
      tenantId,
      name: g.name,
      inputType: g.inputType,
      required: g.required ?? false,
      minSelect: g.minSelect ?? 0,
      maxSelect: g.maxSelect ?? null,
      maxLength: g.maxLength ?? null,
      placeholder: g.placeholder,
      sortOrder: g.sortOrder ?? gi,
      options: {
        create: (g.inputType === "text" ? [] : g.options).map((o, oi) => ({
          tenantId,
          name: o.name,
          priceDelta: o.priceDelta,
          available: o.available ?? true,
          sortOrder: o.sortOrder ?? oi,
        })),
      },
    }));
  }

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
        include: ITEM_INCLUDE,
      }),
    ]);

    return {
      categories: categories.map(toDomainCategory),
      items: items.map(toDomainItem),
    };
  }

  /** Create a menu category for the tenant. */
  async createCategory(
    tenantId: string,
    dto: CreateCategoryDto,
  ): Promise<MenuCategory> {
    const sortOrder = dto.sortOrder ?? (await this.nextCategorySort(tenantId));
    const row = await this.prisma.menuCategory.create({
      data: { tenantId, name: dto.name, sortOrder },
    });
    return toDomainCategory(row);
  }

  /** Rename / reorder a category. Name stays unique per tenant. */
  async updateCategory(
    tenantId: string,
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<MenuCategory> {
    await this.assertCategory(tenantId, id);
    if (dto.name) {
      const clash = await this.prisma.menuCategory.findFirst({
        where: { tenantId, name: dto.name, id: { not: id } },
        select: { id: true },
      });
      if (clash)
        throw new BadRequestException(`Category already exists: ${dto.name}`);
    }
    const row = await this.prisma.menuCategory.update({
      where: { id },
      data: { name: dto.name, sortOrder: dto.sortOrder },
    });
    return toDomainCategory(row);
  }

  /** Delete a category. Blocked while it still holds items (FK is Restrict). */
  async deleteCategory(tenantId: string, id: string): Promise<void> {
    await this.assertCategory(tenantId, id);
    const itemCount = await this.prisma.menuItem.count({
      where: { tenantId, categoryId: id },
    });
    if (itemCount > 0)
      throw new BadRequestException(
        `Category has ${itemCount} item(s). Move or delete them first.`,
      );
    await this.prisma.menuCategory.delete({ where: { id } });
  }

  /** Create a menu item under one of the tenant's categories. */
  async createItem(tenantId: string, dto: CreateItemDto): Promise<MenuItem> {
    await this.assertCategory(tenantId, dto.categoryId);
    const sortOrder =
      dto.sortOrder ?? (await this.nextItemSort(tenantId, dto.categoryId));
    const row = await this.prisma.menuItem.create({
      data: {
        tenantId,
        categoryId: dto.categoryId,
        name: dto.name,
        description: dto.description ?? "",
        price: dto.price,
        badge: dto.badge,
        imageUrl: dto.imageUrl,
        icon: dto.icon,
        swatch: dto.swatch,
        available: dto.available ?? true,
        dietary: dto.dietary ?? null,
        jain: dto.jain ?? false,
        sortOrder,
        modifierGroups: dto.modifierGroups?.length
          ? { create: this.modifierGroupsCreate(tenantId, dto.modifierGroups) }
          : undefined,
      },
      include: ITEM_INCLUDE,
    });
    return toDomainItem(row);
  }

  /** Patch a menu item (price, availability, name, category, …). */
  async updateItem(
    tenantId: string,
    id: string,
    dto: UpdateItemDto,
  ): Promise<MenuItem> {
    await this.assertItem(tenantId, id);
    if (dto.categoryId) await this.assertCategory(tenantId, dto.categoryId);
    const row = await this.prisma.menuItem.update({
      where: { id },
      data: {
        categoryId: dto.categoryId,
        name: dto.name,
        description: dto.description,
        price: dto.price,
        badge: dto.badge,
        imageUrl: dto.imageUrl,
        icon: dto.icon,
        swatch: dto.swatch,
        available: dto.available,
        dietary: dto.dietary,
        jain: dto.jain,
        sortOrder: dto.sortOrder,
        // Replace-on-save: only when the client sent a modifier set. `deleteMany`
        // clears the old groups (options cascade); past order snapshots are kept.
        modifierGroups:
          dto.modifierGroups !== undefined
            ? {
                deleteMany: {},
                create: this.modifierGroupsCreate(tenantId, dto.modifierGroups),
              }
            : undefined,
      },
      include: ITEM_INCLUDE,
    });
    return toDomainItem(row);
  }

  /** Delete a menu item. Past order lines keep their snapshot (FK set null). */
  async deleteItem(tenantId: string, id: string): Promise<void> {
    await this.assertItem(tenantId, id);
    await this.prisma.orderItem.updateMany({
      where: { tenantId, menuItemId: id },
      data: { menuItemId: null },
    });
    await this.prisma.menuItem.delete({ where: { id } });
  }

  private async assertCategory(tenantId: string, id: string): Promise<void> {
    const found = await this.prisma.menuCategory.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!found) throw new BadRequestException(`Category not found: ${id}`);
  }

  private async assertItem(tenantId: string, id: string): Promise<void> {
    const found = await this.prisma.menuItem.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`Menu item not found: ${id}`);
  }

  private async nextCategorySort(tenantId: string): Promise<number> {
    const last = await this.prisma.menuCategory.findFirst({
      where: { tenantId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? -1) + 1;
  }

  private async nextItemSort(
    tenantId: string,
    categoryId: string,
  ): Promise<number> {
    const last = await this.prisma.menuItem.findFirst({
      where: { tenantId, categoryId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? -1) + 1;
  }
}
