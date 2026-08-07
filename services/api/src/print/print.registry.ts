import { Injectable, Logger } from "@nestjs/common";
import { Subject, type Observable } from "rxjs";
import {
  PRINT_JOB_TIMEOUT_MS,
  type ConnectedAgent,
  type PrintJob,
  type PrintJobResult,
  type RelayDownstreamEvent,
  type RelayRegistration,
} from "@amber/domain";

/**
 * Registry of print agents currently dialled in, plus the job round-trip.
 *
 * An agent holds one long-lived SSE connection per process; jobs are pushed
 * down it and answered by a POST that resolves the matching pending promise.
 * That inversion is what lets a phone on mobile data print to a printer behind
 * a restaurant's NAT without any inbound network configuration.
 *
 * ⚠️ This state is IN-PROCESS, exactly like OrdersEvents. With more than one
 * API instance an agent is only reachable from the instance it happens to be
 * connected to, so a job accepted elsewhere would report "offline". Moving to
 * multiple instances therefore requires routing jobs over shared pub/sub (the
 * same change OrdersEvents needs) — the interface here is deliberately narrow
 * so that swap stays contained.
 */

interface AgentConnection {
  connectionId: string;
  tenantId: string;
  registration: RelayRegistration;
  connectedAt: Date;
  channel: Subject<RelayDownstreamEvent>;
}

interface PendingJob {
  resolve: (result: PrintJobResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

@Injectable()
export class PrintRegistry {
  private readonly log = new Logger("PrintRegistry");
  /** tenantId → connectionId → connection */
  private readonly byTenant = new Map<string, Map<string, AgentConnection>>();
  /** jobId → waiter. Bounded by the timeout below; never grows unbounded. */
  private readonly pending = new Map<string, PendingJob>();

  /**
   * Open a channel for a newly connected agent. The caller pipes the returned
   * observable into its SSE response and calls the returned `close` when the
   * request ends — a dropped connection must not leave a phantom agent that
   * the router keeps handing jobs to.
   */
  connect(
    tenantId: string,
    connectionId: string,
    registration: RelayRegistration,
  ): { events: Observable<RelayDownstreamEvent>; close: () => void } {
    const channel = new Subject<RelayDownstreamEvent>();
    const connection: AgentConnection = {
      connectionId,
      tenantId,
      registration,
      connectedAt: new Date(),
      channel,
    };
    let tenantAgents = this.byTenant.get(tenantId);
    if (!tenantAgents) {
      tenantAgents = new Map();
      this.byTenant.set(tenantId, tenantAgents);
    }
    // A reconnect from the same agentId replaces the stale connection rather
    // than accumulating one entry per network blip.
    for (const [id, existing] of tenantAgents) {
      if (existing.registration.agentId === registration.agentId) {
        existing.channel.complete();
        tenantAgents.delete(id);
      }
    }
    tenantAgents.set(connectionId, connection);
    this.log.log(
      `agent connected: ${registration.agentName} (${registration.agentId}) tenant=${tenantId} printers=${registration.printers.length}`,
    );

    return {
      events: channel.asObservable(),
      close: () => {
        const agents = this.byTenant.get(tenantId);
        if (agents?.get(connectionId) === connection) {
          agents.delete(connectionId);
          if (agents.size === 0) this.byTenant.delete(tenantId);
        }
        channel.complete();
        this.log.log(
          `agent disconnected: ${registration.agentName} tenant=${tenantId}`,
        );
      },
    };
  }

  /** Agents currently connected for a tenant (staff-facing status). */
  list(tenantId: string): ConnectedAgent[] {
    return [...(this.byTenant.get(tenantId)?.values() ?? [])].map((c) => ({
      agentId: c.registration.agentId,
      agentName: c.registration.agentName,
      version: c.registration.version,
      platform: c.registration.platform,
      printers: c.registration.printers,
      connectedAt: c.connectedAt.toISOString(),
    }));
  }

  isOnline(tenantId: string): boolean {
    return (this.byTenant.get(tenantId)?.size ?? 0) > 0;
  }

  /**
   * Push a job to one of the tenant's agents and wait for its answer.
   * Always resolves — a caller settling a bill must never hang on a printer.
   */
  async dispatch(
    tenantId: string,
    job: PrintJob,
    agentId?: string,
  ): Promise<PrintJobResult> {
    const agents = [...(this.byTenant.get(tenantId)?.values() ?? [])];
    const target = agentId
      ? agents.find((a) => a.registration.agentId === agentId)
      : agents[0];

    if (!target) {
      return {
        jobId: job.jobId,
        ok: false,
        reason: "offline",
        error: agentId
          ? "That print agent is not connected."
          : "No print agent is connected for this restaurant.",
      };
    }

    const answer = new Promise<PrintJobResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(job.jobId);
        resolve({
          jobId: job.jobId,
          ok: false,
          reason: "timeout",
          error: "The print agent did not respond in time.",
        });
      }, PRINT_JOB_TIMEOUT_MS);
      this.pending.set(job.jobId, { resolve, timer });
    });

    target.channel.next({ type: "job", job });
    return answer;
  }

  /** Called when an agent POSTs a job result. Unknown/late job ids are ignored
   *  (the waiter already timed out) rather than throwing. */
  settle(result: PrintJobResult): boolean {
    const waiter = this.pending.get(result.jobId);
    if (!waiter) return false;
    clearTimeout(waiter.timer);
    this.pending.delete(result.jobId);
    waiter.resolve(result);
    return true;
  }

  /** Heartbeat to every connected agent — keeps proxies from idling out the
   *  stream and lets an agent notice a half-open socket. */
  pingAll(): void {
    for (const agents of this.byTenant.values()) {
      for (const agent of agents.values()) agent.channel.next({ type: "ping" });
    }
  }
}
