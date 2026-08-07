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
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Menu, MenuCategory, MenuItem, Tenant } from "@amber/domain";
import { MenuService } from "./menu.service.js";
import { StorageService, isAllowedImageMime } from "../storage/storage.service.js";
import { CurrentTenant } from "../tenant/current-tenant.decorator.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import {
  PermissionsGuard,
  RequirePermission,
} from "../auth/permissions.guard.js";
import {
  createCategorySchema,
  createItemSchema,
  importImageSchema,
  updateCategorySchema,
  updateItemSchema,
} from "./menu.dto.js";

@Controller("menu")
export class MenuController {
  constructor(
    private readonly menu: MenuService,
    private readonly storage: StorageService,
  ) {}

  /** Public — the guest app reads the menu with no login. */
  @Get()
  get(@CurrentTenant() tenant: Tenant): Promise<Menu> {
    return this.menu.getMenu(tenant.id);
  }

  /** Staff-only: upload an item photo to storage; returns its public URL. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission("menu.manage")
  @Post("upload")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async uploadImage(
    @CurrentTenant() tenant: Tenant,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ url: string }> {
    if (!file) throw new BadRequestException("No file provided.");
    // Exact allow-list, not `mimetype.startsWith("image/")` — that prefix
    // check would also admit `image/svg+xml` (stored-XSS risk; SVGs can carry
    // <script>/event-handler payloads and are served back with the
    // client-supplied content-type from the public bucket).
    if (!file.mimetype || !isAllowedImageMime(file.mimetype))
      throw new BadRequestException("Only PNG, JPEG, WEBP, GIF, or AVIF images are allowed.");
    const url = await this.storage.uploadImage(tenant.id, file);
    return { url };
  }

  /**
   * Staff-only: import a photo from a pasted link into our own storage.
   *
   * The admin used to save a pasted URL verbatim, which makes the menu depend
   * on a stranger's server — those links expire, get hotlink-blocked, or
   * rate-limit when a full menu loads at once. Importing turns "paste a link"
   * into the same outcome as "upload a file".
   */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission("menu.manage")
  @Post("import-image")
  async importImage(
    @CurrentTenant() tenant: Tenant,
    @Body() body: unknown,
  ): Promise<{ url: string }> {
    const parsed = importImageSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("A valid image link is required.");
    const url = await this.storage.importImageFromUrl(tenant.id, parsed.data.url);
    return { url };
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission("menu.manage")
  @Post("categories")
  createCategory(
    @CurrentTenant() tenant: Tenant,
    @Body() body: unknown,
  ): Promise<MenuCategory> {
    return this.menu.createCategory(tenant.id, createCategorySchema.parse(body));
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission("menu.manage")
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

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission("menu.manage")
  @Delete("categories/:id")
  async deleteCategory(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
  ): Promise<{ ok: true }> {
    await this.menu.deleteCategory(tenant.id, id);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission("menu.manage")
  @Post("items")
  createItem(
    @CurrentTenant() tenant: Tenant,
    @Body() body: unknown,
  ): Promise<MenuItem> {
    return this.menu.createItem(tenant.id, createItemSchema.parse(body));
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission("menu.manage")
  @Patch("items/:id")
  updateItem(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<MenuItem> {
    return this.menu.updateItem(tenant.id, id, updateItemSchema.parse(body));
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission("menu.manage")
  @Delete("items/:id")
  async deleteItem(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
  ): Promise<{ ok: true }> {
    await this.menu.deleteItem(tenant.id, id);
    return { ok: true };
  }
}
