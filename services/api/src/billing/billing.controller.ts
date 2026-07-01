import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import type { Plan, SubscriptionWithPlan, Tenant } from "@amber/domain";
import { CurrentTenant } from "../tenant/current-tenant.decorator.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { SupabaseAuthGuard } from "../auth/auth.guard.js";
import { SuperAdminGuard } from "../auth/super-admin.guard.js";
import { BillingService } from "./billing.service.js";
import {
  createPlanSchema,
  setSubscriptionSchema,
  updatePlanSchema,
  updateSubscriptionStatusSchema,
  type CreatePlanDto,
  type SetSubscriptionDto,
  type UpdatePlanDto,
  type UpdateSubscriptionStatusDto,
} from "./billing.dto.js";

/**
 * Plan catalog + per-tenant subscription management. `/admin/*` routes require
 * an established super-admin account (same guard pairing as admin.controller).
 * `/billing/me` requires a tenant-scoped token.
 */
@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @UseGuards(SupabaseAuthGuard, SuperAdminGuard)
  @Get("admin/plans")
  listPlans(): Promise<Plan[]> {
    return this.billing.listPlans();
  }

  @UseGuards(SupabaseAuthGuard, SuperAdminGuard)
  @Post("admin/plans")
  createPlan(@Body() body: unknown): Promise<Plan> {
    const dto: CreatePlanDto = createPlanSchema.parse(body);
    return this.billing.createPlan(dto);
  }

  @UseGuards(SupabaseAuthGuard, SuperAdminGuard)
  @Patch("admin/plans/:id")
  updatePlan(@Param("id") id: string, @Body() body: unknown): Promise<Plan> {
    const dto: UpdatePlanDto = updatePlanSchema.parse(body);
    return this.billing.updatePlan(id, dto);
  }

  @UseGuards(SupabaseAuthGuard, SuperAdminGuard)
  @Post("admin/tenants/:id/subscription")
  setSubscription(
    @Param("id") tenantId: string,
    @Body() body: unknown,
  ): Promise<SubscriptionWithPlan> {
    const dto: SetSubscriptionDto = setSubscriptionSchema.parse(body);
    return this.billing.setSubscription(tenantId, dto);
  }

  @UseGuards(SupabaseAuthGuard, SuperAdminGuard)
  @Get("admin/tenants/:id/subscription")
  getSubscription(
    @Param("id") tenantId: string,
  ): Promise<SubscriptionWithPlan | null> {
    return this.billing.getSubscriptionForTenant(tenantId);
  }

  @UseGuards(SupabaseAuthGuard, SuperAdminGuard)
  @Patch("admin/tenants/:id/subscription")
  updateSubscriptionStatus(
    @Param("id") tenantId: string,
    @Body() body: unknown,
  ): Promise<SubscriptionWithPlan> {
    const dto: UpdateSubscriptionStatusDto =
      updateSubscriptionStatusSchema.parse(body);
    return this.billing.updateSubscriptionStatus(tenantId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get("billing/me")
  getMine(
    @CurrentTenant() tenant: Tenant,
  ): Promise<SubscriptionWithPlan | null> {
    return this.billing.getSubscriptionForTenant(tenant.id);
  }
}
