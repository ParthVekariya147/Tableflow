import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import compression from "compression";
import express from "express";
import { AppModule } from "./app.module.js";

function assertProductionSecrets(): void {
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && !process.env.JWT_SECRET) {
    // Without this, every deployed instance falls back to the same hardcoded
    // string (see auth.module.ts) — anyone could forge a JWT, including an
    // impersonation token, granting full access to any tenant.
    throw new Error(
      "JWT_SECRET must be set in production — refusing to boot with the insecure dev fallback",
    );
  }
}

async function bootstrap() {
  assertProductionSecrets();
  const app = await NestFactory.create(AppModule);

  // On SIGTERM/SIGINT (container restart, rolling deploy) let Nest drain
  // in-flight requests and run each module's onModuleDestroy (see
  // PrismaService) instead of the process just dying mid-query — otherwise
  // pooled DB connections are left dangling against pgBouncer's 15-client
  // session-mode cap, starving the next instance's warm-up.
  app.enableShutdownHooks();

  // Security headers: X-Frame-Options, X-Content-Type-Options, HSTS, etc.
  // CSP is disabled in non-production so the SSE stream works locally.
  app.use(
    helmet({
      contentSecurityPolicy: process.env.NODE_ENV === "production",
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Gzip all JSON/text responses — cuts wire size ~70% for analytics payloads.
  app.use(compression());

  // Cap JSON request bodies at 1 MB — stops oversized payload attacks.
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  // Production: restrict to CORS_ORIGINS (comma-separated list in .env).
  // Development: open to all origins so LAN testing (phone + admin at a LAN IP)
  // works without having to hardcode the dev machine's IP. Auth guards already
  // protect every sensitive route.
  const isProd = process.env.NODE_ENV === "production";
  const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: isProd ? (allowedOrigins.length ? allowedOrigins : false) : true,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });

  app.setGlobalPrefix("");
  // DTO validation is handled per-route with Zod (`schema.parse(body)`), so no
  // global class-validator ValidationPipe is needed.
  const port = Number(process.env.PORT ?? 3001);
  // Bind to 0.0.0.0 so the API is reachable from other devices on the LAN
  // (e.g. a phone hitting http://<dev-machine-lan-ip>:3001), not just localhost.
  await app.listen(port, "0.0.0.0");
  // eslint-disable-next-line no-console
  console.log(`@amber/api listening on http://0.0.0.0:${port}`);
}

void bootstrap();
