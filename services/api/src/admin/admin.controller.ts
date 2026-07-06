import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import type { Tenant, TenantWithSubscription } from "@amber/domain";
import { AuthService } from "../auth/auth.service.js";
import { SupabaseAuthGuard } from "../auth/auth.guard.js";
import { SuperAdminGuard } from "../auth/super-admin.guard.js";
import { BillingService } from "../billing/billing.service.js";
import { AdminService } from "./admin.service.js";
import { timingSafeEqualStr } from "../common/timing-safe-equal.js";
import type {
  AuditLogEntry,
  TenantCredential,
  TenantPayment,
  LoyaltyAccountSummary,
  LoyaltyAccountDetail,
} from "./admin.service.js";
import type { PlatformAnalytics } from "./admin.types.js";
import {
  createTenantSchema,
  updateTenantSchema,
  resetOwnerPasswordSchema,
  type CreateTenantDto,
  type UpdateTenantDto,
  type ResetOwnerPasswordDto,
} from "./admin.dto.js";

const impersonateSchema = z.object({
  tenantSlug: z.string().min(1),
  masterPassword: z.string().min(1),
});

/**
 * Super-admin, cross-tenant operations. Excluded from TenantMiddleware.
 * Bearer = Supabase access token; every route requires an established
 * super-admin account (SupabaseAuthGuard resolves req.user, SuperAdminGuard
 * requires req.user.isSuperAdmin — see auth/auth.guard.ts + super-admin.guard.ts).
 */
@Controller("admin")
@UseGuards(SupabaseAuthGuard, SuperAdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly billing: BillingService,
    private readonly auth: AuthService,
  ) {}

  @Get("tenants")
  list(): Promise<TenantWithSubscription[]> {
    return this.billing.listTenantsWithSubscriptions();
  }

  @Post("tenants")
  create(@Body() body: unknown): Promise<Tenant> {
    const dto: CreateTenantDto = createTenantSchema.parse(body);
    return this.admin.createTenant(dto);
  }

  @Get("tenants/:id")
  async getOne(@Param("id") id: string): Promise<TenantWithSubscription> {
    return this.billing.getTenantWithSubscription(id);
  }

  @Patch("tenants/:id")
  async update(@Param("id") id: string, @Body() body: unknown): Promise<TenantWithSubscription> {
    const dto: UpdateTenantDto = updateTenantSchema.parse(body);
    await this.admin.updateTenant(id, dto);
    return this.billing.getTenantWithSubscription(id);
  }

  @Get("tenants/:id/payments")
  getTenantPayments(@Param("id") id: string): Promise<TenantPayment[]> {
    return this.admin.getTenantPayments(id);
  }

  /** List all tenants with their Admin member's email + password status. */
  @Get("credentials")
  getCredentials(): Promise<TenantCredential[]> {
    return this.admin.getCredentials();
  }

  /** Reset the password for a tenant's Admin member. */
  @Post("tenants/:id/reset-owner-password")
  async resetOwnerPassword(
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const dto: ResetOwnerPasswordDto = resetOwnerPasswordSchema.parse(body);
    await this.admin.resetOwnerPassword(id, dto.userId, dto.newPassword);
    return { ok: true };
  }

  /**
   * Issue a 30-minute impersonation token for a tenant. The caller must supply
   * the PLATFORM_MASTER_PASSWORD (an env var on this server — it's never in
   * the DB or client code). The token is logged to the audit log and then
   * handed to the super-admin UI, which opens restaurant-admin in a new tab.
   */
  @Post("impersonate")
  async impersonate(@Body() body: unknown): Promise<{ token: string }> {
    const { tenantSlug, masterPassword } = impersonateSchema.parse(body);
    const expected = process.env.PLATFORM_MASTER_PASSWORD;
    if (!expected || !timingSafeEqualStr(masterPassword, expected)) {
      throw new ForbiddenException("Invalid master password");
    }
    const tenant = await this.billing
      .listTenantsWithSubscriptions()
      .then((all) => all.find((t) => t.slug === tenantSlug));
    if (!tenant) throw new NotFoundException(`Unknown tenant slug: ${tenantSlug}`);

    const token = await this.auth.createImpersonationToken(tenant.id, tenant.slug);

    // Fire-and-forget audit log entry.
    this.admin.writeImpersonationLog(tenant.id, { tenantSlug }).catch(() => {});

    return { token };
  }

  /** Cross-tenant platform analytics for the super-admin dashboard. */
  @Get("analytics")
  analytics(): Promise<PlatformAnalytics> {
    return this.admin.getPlatformAnalytics();
  }

  @Get("audit-log")
  getAuditLog(
    @Query("type") type?: string,
    @Query("tenantId") tenantId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limitStr?: string,
    @Query("offset") offsetStr?: string,
  ): Promise<{ entries: AuditLogEntry[]; total: number }> {
    return this.admin.getAuditLog({
      type,
      tenantId,
      from,
      to,
      limit: limitStr ? parseInt(limitStr, 10) : undefined,
      offset: offsetStr ? parseInt(offsetStr, 10) : undefined,
    });
  }

  /** Cross-tenant customer lookup (platform support). Read-only — see
   *  admin.service.ts's listLoyaltyAccounts for why adjustments stay tenant-side. */
  @Get("loyalty/accounts")
  listLoyaltyAccounts(
    @Query("search") search?: string,
    @Query("tenantId") tenantId?: string,
  ): Promise<LoyaltyAccountSummary[]> {
    return this.admin.listLoyaltyAccounts({ search, tenantId });
  }

  @Get("loyalty/accounts/:id")
  getLoyaltyAccount(@Param("id") id: string): Promise<LoyaltyAccountDetail> {
    return this.admin.getLoyaltyAccount(id);
  }
}
