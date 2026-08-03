import type { Request, Response, NextFunction } from "express";
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWithTiming, currentTiming } from "./request-timing.js";

// Dev-only measurement aid (sibling to PrismaService's per-query log): one
// line per request with wall-clock total vs. time actually spent in Prisma,
// so "why is this endpoint slow" is read from a log instead of guessed from
// code shape. Registered as the very first `app.use()` in main.ts so it
// wraps TenantMiddleware + guards + the handler, not just the controller.
const REQUEST_LOG_FILE = join(tmpdir(), "amber-request-timing.log");
const ENABLED = process.env.NODE_ENV === "development";

export function requestTimingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!ENABLED) {
    next();
    return;
  }
  const start = Date.now();
  runWithTiming(() => {
    res.on("finish", () => {
      const t = currentTiming();
      const totalMs = Date.now() - start;
      try {
        appendFileSync(
          REQUEST_LOG_FILE,
          `${new Date().toISOString()} ${req.method} ${req.originalUrl} ` +
            `total=${totalMs}ms prisma=${t?.prismaMs ?? 0}ms queries=${t?.queries ?? 0} status=${res.statusCode}\n`,
        );
      } catch {
        // best-effort: never let the measurement aid break a request
      }
    });
    next();
  });
}
