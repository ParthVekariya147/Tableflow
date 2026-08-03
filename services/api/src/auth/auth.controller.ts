import { Body, Controller, Get, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { AuthUser, LoginResponse, LoginResult } from "@amber/domain";
import { AuthService } from "./auth.service.js";
import {
  ChangePasswordDto,
  LoginDto,
  SelectTenantDto,
  UpdateLastPaymentMethodDto,
} from "./auth.dto.js";
import { JwtAuthGuard } from "./jwt-auth.guard.js";
import { SupabaseAuthGuard } from "./auth.guard.js";
import { CurrentUser } from "./current-user.decorator.js";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Email-first sign in (no X-Tenant-Slug needed). Returns either a token + user
   * (single restaurant) or a ticket + tenant list to pick from (several). See
   * `select` for step two.
   */
  @Post("login")
  login(@Body() body: unknown): Promise<LoginResult> {
    const { email, password } = LoginDto.parse(body);
    return this.auth.login(email, password);
  }

  /** Step two of a multi-tenant login: redeem the ticket for the chosen tenant. */
  @Post("select-tenant")
  select(@Body() body: unknown): Promise<LoginResponse> {
    const { ticket, tenantId } = SelectTenantDto.parse(body);
    return this.auth.selectTenant(ticket, tenantId);
  }

  /** The current user behind the bearer token (re-resolved fresh each call). */
  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  /**
   * Self-service password change — required before a member can do anything
   * else while `AuthUser.mustChangePassword` is true (still a default
   * `changeme123` password), but usable any time.
   */
  @Post("change-password")
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const { currentPassword, newPassword } = ChangePasswordDto.parse(body);
    await this.auth.changePassword(user.tenantId, user.id, currentPassword, newPassword);
    return { ok: true };
  }

  /**
   * Remember which payment method this staff member last used at checkout
   * (BillingPage), so it defaults to it next time instead of a hardcoded
   * method. A personal preference — any authenticated staff member may set
   * their own, no permission gate beyond being signed in.
   */
  @Patch("me/last-payment-method")
  @UseGuards(JwtAuthGuard)
  async updateLastPaymentMethod(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const { method } = UpdateLastPaymentMethodDto.parse(body);
    await this.auth.updateLastPaymentMethod(user.tenantId, user.id, method);
    return { ok: true };
  }

  /**
   * Super-admin first-login bootstrap. The super-admin app calls this once after
   * Supabase sign-in to ensure a matching Prisma User row exists (isSuperAdmin=true).
   * Bearer = Supabase access token (verified server-side via Supabase Admin API).
   */
  @Post("sync-profile")
  @UseGuards(SupabaseAuthGuard)
  syncProfile(@Req() req: Request): Promise<AuthUser> {
    const token = req.header("authorization")!.slice(7).trim();
    return this.auth.syncProfile(token);
  }
}
