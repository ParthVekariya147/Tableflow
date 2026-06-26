import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AuthUser } from "@amber/domain";
import type { AuthRequest } from "./auth.types.js";

/**
 * Injects the current user resolved by JwtAuthGuard:
 *   me(@CurrentUser() user: AuthUser) { ... }
 * Sibling to @CurrentTenant(); requires JwtAuthGuard on the route.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    return req.authUser;
  },
);
