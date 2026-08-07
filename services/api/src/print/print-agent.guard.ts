import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import type { TenantRequest } from "../tenant/tenant-request.js";

/**
 * Authenticates a print agent dialling in to the relay.
 *
 * Deliberately reuses the credential the restaurant ALREADY configures — the
 * agent secret from Settings → Printer, which is also set as `AGENT_SECRET` on
 * the agent. That keeps the promise of minimal setup: connecting a till to the
 * relay needs no new key, account or certificate.
 *
 * Unlike the local LAN agent, a blank secret is NOT accepted here. On the LAN,
 * "no secret" means "same machine, trusted"; on the relay the credential is
 * what proves which restaurant an agent belongs to, so a tenant with no secret
 * simply cannot use the relay (local printing keeps working untouched).
 */
@Injectable()
export class PrintAgentGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<TenantRequest>();
    const tenant = req.tenant;

    const header = req.headers["x-agent-secret"];
    const provided = typeof header === "string" ? header.trim() : "";

    // Either printer profile's secret is accepted — a restaurant may run one
    // agent for receipts and another next to the kitchen printer.
    const candidates = [
      tenant.printer?.agentSecret,
      tenant.kitchenPrinter?.agentSecret,
    ]
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter((s) => s.length > 0);

    if (candidates.length === 0) {
      throw new UnauthorizedException(
        "This restaurant has no printer security key set. Add one in Settings → Printer to connect an agent.",
      );
    }
    if (!provided || !candidates.some((c) => safeEqual(c, provided))) {
      throw new UnauthorizedException("Invalid printer security key");
    }
    return true;
  }
}

/** Constant-time compare so the secret can't be recovered byte-by-byte by
 *  timing repeated connection attempts. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
