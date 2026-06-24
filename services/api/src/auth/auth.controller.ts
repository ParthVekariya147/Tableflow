import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import type { AuthUser, LoginResponse, LoginResult } from "@amber/domain";
import { AuthService } from "./auth.service.js";
import { LoginDto, SelectTenantDto } from "./auth.dto.js";
import { JwtAuthGuard } from "./jwt-auth.guard.js";
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
}
