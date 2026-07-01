import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodError } from "zod";

interface RequestContext {
  tenant?: { slug?: string };
  authUser?: { id?: string; tenantId?: string };
  user?: { id?: string };
}

/**
 * Registered as a global `APP_FILTER` (app.module.ts) so an unhandled error
 * anywhere in the app doesn't fall through to Nest's bare default handler —
 * which returns an opaque, uncorrelated 500 with nothing in the logs tying it
 * back to which tenant/request caused it. Also translates a stray unwrapped
 * `ZodError` (a DTO validated by direct `schema.parse()` rather than a Nest
 * pipe) into a clean 400 instead of a 500.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("UnhandledException");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & RequestContext>();

    const { status, body } = this.resolve(exception);

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} [tenant=${req.tenant?.slug ?? "-"} user=${
          req.authUser?.id ?? req.user?.id ?? "-"
        }] → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(status).json(body);
  }

  private resolve(exception: unknown): { status: number; body: Record<string, unknown> } {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const body =
        typeof response === "string" ? { message: response } : (response as Record<string, unknown>);
      return { status: exception.getStatus(), body };
    }
    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: { message: "Validation failed", issues: exception.issues },
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { message: "Internal server error" },
    };
  }
}
