import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { AppEnv } from "./config/env";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<AppEnv, true>);

  app.setGlobalPrefix("api/v1");
  app.use(helmet());
  app.useGlobalFilters(new AllExceptionsFilter());

  const corsOrigins = configService
    .get("CORS_ORIGIN", { infer: true })
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  if (configService.get("SWAGGER_ENABLED", { infer: true })) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("Smart-POS API")
      .setDescription(
        "Multi-tenant SaaS POS & Inventory Management API (NestJS + PostgreSQL RLS + Redis)",
      )
      .setVersion("0.1.0")
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup("api/docs", app, document);
  }

  app.enableShutdownHooks();

  const port = configService.get("API_PORT", { infer: true });
  await app.listen(port);
}

void bootstrap();
