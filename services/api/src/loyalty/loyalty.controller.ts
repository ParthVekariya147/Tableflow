import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import type { LoyaltyAccount, LoyaltyTransaction, Tenant } from "@amber/domain";
import { LoyaltyService, type LoyaltyOrderSummary } from "./loyalty.service.js";
import { CurrentTenant } from "../tenant/current-tenant.decorator.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { PermissionsGuard, RequirePermission } from "../auth/permissions.guard.js";
import { adjustLoyaltyAccountSchema } from "./loyalty.dto.js";

/**
 * Staff-only customer loyalty directory — no public/guest routes at all (the
 * guest phone never talks to this controller; account creation + earn/redeem
 * happen server-side from OrdersService).
 */
@Controller("loyalty")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission("loyalty.manage")
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get("accounts")
  list(
    @CurrentTenant() tenant: Tenant,
    @Query("search") search?: string,
  ): Promise<LoyaltyAccount[]> {
    return this.loyalty.list(tenant.id, search);
  }

  @Get("accounts/:id")
  get(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
  ): Promise<{
    account: LoyaltyAccount;
    transactions: LoyaltyTransaction[];
    orders: LoyaltyOrderSummary[];
  }> {
    return this.loyalty.get(tenant.id, id);
  }

  @Patch("accounts/:id/adjust")
  adjust(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<LoyaltyAccount> {
    return this.loyalty.adjust(tenant.id, id, adjustLoyaltyAccountSchema.parse(body));
  }
}
