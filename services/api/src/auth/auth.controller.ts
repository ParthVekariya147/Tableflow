import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import type { AuthUser, LoginResponse, Tenant } from "@amber/domain";
import { CurrentTenant } from "../tenant/current-tenant.decorator.js";
import { AuthService } from "./auth.service.js";
import { LoginDto } from "./auth.dto.js";
import { JwtAuthGuard } from "./jwt-auth.guard.js";
import { CurrentUser } from "./current-user.decorator.js";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Sign in to the active tenant (resolved from X-Tenant-Slug). Returns a bearer
   * token + the resolved current user (identity + role + permissions).
   */
  @Post("login")
  login(
    @CurrentTenant() tenant: Tenant,
    @Body() body: unknown,
  ): Promise<LoginResponse> {
    const { email, password } = LoginDto.parse(body);
    return this.auth.login(tenant.id, email, password);
  }

  /** The current user behind the bearer token (re-resolved fresh each call). */
  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
