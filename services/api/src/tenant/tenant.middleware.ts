import {
  BadRequestException,
  Injectable,
  type NestMiddleware,
} from "@nestjs/common";
import type { Response, NextFunction } from "express";
import type { TenantRequest } from "./tenant-request.js";
import { TenantService } from "./tenant.service.js";

/**
 * Resolves the active tenant from the X-Tenant-Slug header and attaches it to
 * the request. Every tenant-scoped route depends on this; downstream services
 * scope all queries by tenant.id. Without it, requests are rejected.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenants: TenantService) {}

  async use(req: TenantRequest, _res: Response, next: NextFunction) {
    const slug = req.header("x-tenant-slug");
    if (!slug) {
      throw new BadRequestException("Missing X-Tenant-Slug header");
    }
    // getBySlug throws 404 for unknown/inactive tenants.
    req.tenant = await this.tenants.getBySlug(slug);
    next();
  }
}
