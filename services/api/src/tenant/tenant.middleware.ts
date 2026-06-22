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
    // Header is the norm; the `?tenant=` query param is the fallback for SSE
    // (EventSource can't set custom headers — see GET /orders/stream).
    const queryTenant = req.query?.tenant;
    const slug =
      req.header("x-tenant-slug") ??
      (typeof queryTenant === "string" ? queryTenant : undefined);
    if (!slug) {
      throw new BadRequestException("Missing X-Tenant-Slug header");
    }
    // getBySlug throws 404 for unknown/inactive tenants.
    req.tenant = await this.tenants.getBySlug(slug);
    next();
  }
}
