import { Controller, Get } from "@nestjs/common";

/**
 * Unauthenticated liveness probe (container orchestrator / uptime monitor).
 * Excluded from TenantMiddleware — see app.module.ts — since it must respond
 * with no tenant context at all.
 */
@Controller()
export class HealthController {
  @Get("health")
  check(): { ok: true } {
    return { ok: true };
  }
}
