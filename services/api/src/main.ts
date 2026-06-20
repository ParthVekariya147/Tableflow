import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
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
