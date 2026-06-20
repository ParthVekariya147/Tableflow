import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Menu, MenuCategory, MenuItem, Tenant } from "@amber/domain";
import { MenuService } from "./menu.service.js";
import { StorageService } from "../storage/storage.service.js";
import { CurrentTenant } from "../tenant/current-tenant.decorator.js";
import {
  createCategorySchema,
  createItemSchema,
  updateCategorySchema,
  updateItemSchema,
} from "./menu.dto.js";

@Controller("menu")
export class MenuController {
  constructor(
    private readonly menu: MenuService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  get(@CurrentTenant() tenant: Tenant): Promise<Menu> {
    return this.menu.getMenu(tenant.id);
  }

  /** Upload an item photo to storage; returns its public URL. */
  @Post("upload")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async uploadImage(
    @CurrentTenant() tenant: Tenant,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ url: string }> {
    if (!file) throw new BadRequestException("No file provided.");
    if (!file.mimetype?.startsWith("image/"))
      throw new BadRequestException("Only image files are allowed.");
    const url = await this.storage.uploadImage(tenant.id, file);
    return { url };
  }

  @Post("categories")
  createCategory(
    @CurrentTenant() tenant: Tenant,
    @Body() body: unknown,
  ): Promise<MenuCategory> {
    return this.menu.createCategory(tenant.id, createCategorySchema.parse(body));
  }

  @Patch("categories/:id")
  updateCategory(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<MenuCategory> {
    return this.menu.updateCategory(
      tenant.id,
      id,
      updateCategorySchema.parse(body),
    );
  }

  @Delete("categories/:id")
  async deleteCategory(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
  ): Promise<{ ok: true }> {
    await this.menu.deleteCategory(tenant.id, id);
    return { ok: true };
  }

  @Post("items")
  createItem(
    @CurrentTenant() tenant: Tenant,
    @Body() body: unknown,
  ): Promise<MenuItem> {
    return this.menu.createItem(tenant.id, createItemSchema.parse(body));
  }

  @Patch("items/:id")
  updateItem(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<MenuItem> {
    return this.menu.updateItem(tenant.id, id, updateItemSchema.parse(body));
  }

  @Delete("items/:id")
  async deleteItem(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
  ): Promise<{ ok: true }> {
    await this.menu.deleteItem(tenant.id, id);
    return { ok: true };
  }
}
