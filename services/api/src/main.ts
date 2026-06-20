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
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`@amber/api listening on http://localhost:${port}`);
}

void bootstrap();
