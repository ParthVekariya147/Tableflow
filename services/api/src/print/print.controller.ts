import {
  Body,
  Controller,
  Get,
  Headers,
  type MessageEvent,
  Post,
  Req,
  Sse,
  UseGuards,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { SkipThrottle } from "@nestjs/throttler";
import { map, merge, of, type Observable } from "rxjs";
import type { Request } from "express";
import {
  connectedAgentSchema,
  printJobBaseSchema,
  printJobResultSchema,
  printJobSchema,
  relayRegistrationSchema,
  type ConnectedAgent,
  type PrintJobResult,
  type Tenant,
} from "@amber/domain";
import { z } from "zod";
import { CurrentTenant } from "../tenant/current-tenant.decorator.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import {
  PermissionsGuard,
  RequirePermission,
} from "../auth/permissions.guard.js";
import { PrintAgentGuard } from "./print-agent.guard.js";
import { PrintRegistry } from "./print.registry.js";

/** Body a client sends to print — everything but the job id, which the server
 *  mints so a client can't collide or replay another restaurant's job. */
const submitJobSchema = printJobBaseSchema
  .omit({ jobId: true })
  .extend({ agentId: z.string().max(64).optional() });

@Controller("print")
export class PrintController {
  constructor(private readonly registry: PrintRegistry) {}

  // ── Agent side (authenticated by the tenant's printer security key) ──────

  /**
   * The agent's long-lived downstream. It dials THIS, so nothing needs to be
   * reachable on the restaurant's network — the whole reason the relay exists.
   * Registration rides in the `X-Agent-Registration` header (JSON) so the
   * stream is established and registered in one round trip.
   *
   * @SkipThrottle — one persistent connection, not a burst.
   */
  @SkipThrottle()
  @UseGuards(PrintAgentGuard)
  @Sse("agent/stream")
  agentStream(
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ): Observable<MessageEvent> {
    const raw = req.headers["x-agent-registration"];
    const registration = relayRegistrationSchema.parse(
      JSON.parse(typeof raw === "string" ? raw : "{}"),
    );
    const connectionId = randomUUID();
    const { events, close } = this.registry.connect(
      tenant.id,
      connectionId,
      registration,
    );
    req.on("close", close);

    return merge(
      of({ type: "ready" as const, connectionId }),
      events,
    ).pipe(map((data): MessageEvent => ({ data })));
  }

  /** The agent's answer for a dispatched job. */
  @UseGuards(PrintAgentGuard)
  @Post("agent/result")
  result(@Body() body: unknown): { accepted: boolean } {
    const parsed = printJobResultSchema.parse(body);
    return { accepted: this.registry.settle(parsed) };
  }

  // ── Staff side (normal JWT auth, ordinary HTTPS from any device) ─────────

  /**
   * Submit a print job. This is what every browser calls — desktop, Android
   * Chrome, iOS Safari, installed PWA — because it is a same-origin HTTPS
   * request like any other. No LAN address is ever touched by the client.
   */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission("tables.manage")
  @Post("jobs")
  async submit(
    @CurrentTenant() tenant: Tenant,
    @Body() body: unknown,
  ): Promise<PrintJobResult> {
    const input = submitJobSchema.parse(body);
    const { agentId, ...job } = input;
    return this.registry.dispatch(
      tenant.id,
      printJobSchema.parse({ ...job, jobId: randomUUID() }),
      agentId,
    );
  }

  /** Which agents are dialled in right now (Settings → Printer status). */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission("tables.manage")
  @Get("agents")
  agents(@CurrentTenant() tenant: Tenant): ConnectedAgent[] {
    return z.array(connectedAgentSchema).parse(this.registry.list(tenant.id));
  }

  /** Cheap reachability probe used by the client to pick a transport. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission("tables.manage")
  @Get("status")
  status(@CurrentTenant() tenant: Tenant): {
    online: boolean;
    agents: number;
  } {
    const agents = this.registry.list(tenant.id);
    return { online: agents.length > 0, agents: agents.length };
  }

  /** Unused header hint kept explicit for readers of the agent protocol. */
  @Get("protocol")
  protocol(@Headers("x-agent-registration") _hint?: string): {
    version: number;
  } {
    return { version: 1 };
  }
}
