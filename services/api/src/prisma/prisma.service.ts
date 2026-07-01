import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/** Thin wrapper exposing the generated Prisma client as an injectable. */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  // Requires app.enableShutdownHooks() in main.ts to actually run on
  // SIGTERM/SIGINT — without it, a container restart/rolling deploy can cut
  // in-flight queries mid-transaction and leave pooled connections dangling
  // against pgBouncer's 15-client session-mode cap, starving the next
  // instance's warm-up.
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
