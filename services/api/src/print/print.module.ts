import { Module, type OnModuleDestroy } from "@nestjs/common";
import { PrintController } from "./print.controller.js";
import { PrintRegistry } from "./print.registry.js";
import { AuthModule } from "../auth/auth.module.js";

/**
 * Print relay — see @amber/domain's print-relay.ts for the architecture note.
 * Agents dial in and hold a stream; browsers submit jobs over ordinary HTTPS.
 */
@Module({
  // JwtAuthGuard on the staff-facing routes needs JwtService + AuthService.
  imports: [AuthModule],
  controllers: [PrintController],
  providers: [PrintRegistry],
  exports: [PrintRegistry],
})
export class PrintModule implements OnModuleDestroy {
  private readonly heartbeat: ReturnType<typeof setInterval>;

  constructor(private readonly registry: PrintRegistry) {
    // Idle SSE connections get closed by proxies/load balancers; a periodic
    // frame keeps them alive and lets an agent detect a half-open socket.
    // unref() so this never holds the process open on shutdown.
    this.heartbeat = setInterval(() => this.registry.pingAll(), 25_000);
    this.heartbeat.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.heartbeat);
  }
}
