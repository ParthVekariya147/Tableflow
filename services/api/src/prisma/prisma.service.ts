import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Dev-only measurement aid: every query's duration is appended here so
// per-endpoint round-trip counts can be read without scraping the terminal.
// (Latency work needs "how many queries and how long each" per request —
// see the perf doc.) Inert outside NODE_ENV=development.
const QUERY_LOG_FILE = join(tmpdir(), "amber-prisma-query.log");

/** Thin wrapper exposing the generated Prisma client as an injectable. */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const logQueries = process.env.NODE_ENV === "development";
    super(logQueries ? { log: [{ emit: "event", level: "query" }] } : undefined);
    if (logQueries) {
      (this.$on as (event: "query", cb: (e: Prisma.QueryEvent) => void) => void)(
        "query",
        (e) => {
          try {
            appendFileSync(
              QUERY_LOG_FILE,
              `${new Date().toISOString()} ${e.duration}ms ${e.query.replace(/\s+/g, " ").slice(0, 160)}\n`,
            );
          } catch {
            // best-effort: never let the measurement aid break a request
          }
        },
      );
    }
  }

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
