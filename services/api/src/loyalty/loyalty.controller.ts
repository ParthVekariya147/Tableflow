import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { LoyaltyAccount, LoyaltyTransaction, Tenant } from "@amber/domain";
import { isLoyaltyEnabled } from "@amber/domain";
import { LoyaltyService, type LoyaltyOrderSummary } from "./loyalty.service.js";
import { CurrentTenant } from "../tenant/current-tenant.decorator.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { PermissionsGuard, RequirePermission } from "../auth/permissions.guard.js";
import { adjustLoyaltyAccountSchema } from "./loyalty.dto.js";

/**
 * Staff-only customer loyalty directory — no public/guest routes at all (the
 * guest phone never talks to this controller; account creation + earn/redeem
 * happen server-side from OrdersService).
 *
 * **Module gating is asymmetric here, on purpose.** The reads stay open when a
 * tenant switches the loyalty module off: the balances are the guests' record,
 * a report or a support question may still need them, and 403-ing a GET would
 * turn a switched-off module into errors in any tab that happens to be open
 * rather than a clean disappearance (the admin UI simply stops linking here).
 * The WRITE is refused — nothing may move a points balance for a restaurant
 * that no longer runs a program.
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
    if (!isLoyaltyEnabled(tenant.loyalty))
      throw new BadRequestException(
        "The loyalty program is turned off for this restaurant.",
      );
    return this.loyalty.adjust(tenant.id, id, adjustLoyaltyAccountSchema.parse(body));
  }
}
