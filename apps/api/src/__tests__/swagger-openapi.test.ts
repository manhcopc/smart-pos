import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { ModulesContainer } from "@nestjs/core";
import type { OpenAPIObject } from "@nestjs/swagger";
import {
  cashierPinLoginSchema,
  createInvoiceSchema,
  ownerLoginSchema,
  posCatalogSyncQuerySchema,
  registerTenantSchema,
} from "@smart-pos/shared";
import { describe, expect, it } from "vitest";
import { AuthController } from "../auth/auth.controller";
import { BillingController } from "../billing/billing.controller";
import { ProductsController } from "../catalog/products.controller";
import {
  enrichOpenApiWithZodPipes,
  zodToOpenApiSchema,
} from "../common/swagger/zod-openapi.helper";
import { IntegrationsController } from "../integrations/integrations.controller";
import { PublicIntegrationsController } from "../integrations/public-integrations.controller";
import { PosController } from "../pos/pos.controller";

describe("Swagger OpenAPI Zod Schema Enrichment", () => {
  it("converts ZodObject, nested arrays, unions, enums, and refinements into OpenAPI SchemaObjects", () => {
    const loginOpenApi = zodToOpenApiSchema(ownerLoginSchema);
    expect(loginOpenApi.type).toBe("object");
    expect(loginOpenApi.required).toEqual(["email", "password"]);
    expect(loginOpenApi.properties?.email).toMatchObject({
      type: "string",
      format: "email",
    });
    expect(loginOpenApi.properties?.password).toMatchObject({
      type: "string",
      minLength: 1,
    });
    expect(loginOpenApi.properties?.tenantSlug).toMatchObject({
      type: "string",
    });

    const pinOpenApi = zodToOpenApiSchema(cashierPinLoginSchema);
    expect(pinOpenApi.required).toEqual(["tenantSlug", "employeeCode", "pin"]);
    expect(pinOpenApi.properties?.pin).toMatchObject({
      type: "string",
      pattern: "^\\d{4,8}$",
    });

    const regOpenApi = zodToOpenApiSchema(registerTenantSchema);
    expect(regOpenApi.required).toContain("shopName");
    expect(regOpenApi.required).toContain("email");
    expect(regOpenApi.properties?.businessType).toMatchObject({
      type: "string",
      enum: ["RETAIL", "FASHION", "GROCERY", "PHARMACY", "ELECTRONICS", "OTHER"],
      default: "RETAIL",
    });

    const invoiceOpenApi = zodToOpenApiSchema(createInvoiceSchema);
    expect(invoiceOpenApi.required).toContain("items");
    expect(invoiceOpenApi.required).toContain("payments");
    expect(invoiceOpenApi.properties?.items).toMatchObject({
      type: "array",
      minItems: 1,
    });

    const catalogSyncQuery = zodToOpenApiSchema(posCatalogSyncQuerySchema);
    expect(catalogSyncQuery.properties?.branchId).toMatchObject({
      type: "string",
      format: "uuid",
    });
  });

  it("enriches OpenAPI document paths from real controller ZodValidationPipe metadata", () => {
    const mockModulesContainer = new Map([
      [
        "test-module",
        {
          controllers: new Map([
            ["AuthController", { metatype: AuthController }],
            ["PosController", { metatype: PosController }],
            ["BillingController", { metatype: BillingController }],
            ["ProductsController", { metatype: ProductsController }],
            ["IntegrationsController", { metatype: IntegrationsController }],
            [
              "PublicIntegrationsController",
              { metatype: PublicIntegrationsController },
            ],
          ]),
        },
      ],
    ]) as unknown as ModulesContainer;

    const mockApp = {
      get: (token: unknown) =>
        token === ModulesContainer ? mockModulesContainer : undefined,
    } as unknown as INestApplication;

    const document: OpenAPIObject = {
      openapi: "3.0.0",
      info: { title: "Smart-POS API", version: "0.1.0" },
      paths: {
        "/api/v1/auth/login": { post: { responses: { "200": { description: "" } } } },
        "/api/v1/auth/cashier-pin": { post: { responses: { "200": { description: "" } } } },
        "/api/v1/auth/register-tenant": { post: { responses: { "201": { description: "" } } } },
        "/api/v1/pos/catalog-sync": { get: { responses: { "200": { description: "" } } } },
        "/api/v1/pos/invoices": { post: { responses: { "201": { description: "" } } } },
        "/api/v1/billing/subscribe": { post: { responses: { "200": { description: "" } } } },
        "/api/v1/products/import": { post: { responses: { "201": { description: "" } } } },
        "/api/v1/integrations/public/orders": {
          post: { responses: { "200": { description: "" } } },
        },
      },
    };

    const enriched = enrichOpenApiWithZodPipes(mockApp, document);

    const loginBody = enriched.paths["/api/v1/auth/login"]?.post?.requestBody;
    expect(loginBody).toBeDefined();
    expect("content" in loginBody!).toBe(true);
    if (loginBody && "content" in loginBody) {
      const schema = loginBody.content["application/json"]?.schema;
      expect(schema && "properties" in schema ? Object.keys(schema.properties ?? {}) : []).toEqual([
        "email",
        "password",
        "tenantSlug",
      ]);
    }

    const pinBody = enriched.paths["/api/v1/auth/cashier-pin"]?.post?.requestBody;
    expect(pinBody && "content" in pinBody).toBe(true);
    if (pinBody && "content" in pinBody) {
      const schema = pinBody.content["application/json"]?.schema;
      expect(schema && "properties" in schema ? Object.keys(schema.properties ?? {}) : []).toEqual([
        "tenantSlug",
        "employeeCode",
        "pin",
      ]);
    }

    const catalogParams = enriched.paths["/api/v1/pos/catalog-sync"]?.get?.parameters ?? [];
    expect(
      catalogParams.map((p) => ("name" in p ? p.name : "")),
    ).toEqual(["branchId", "since"]);

    const subscribeBody = enriched.paths["/api/v1/billing/subscribe"]?.post?.requestBody;
    expect(subscribeBody && "content" in subscribeBody).toBe(true);

    const publicOrderBody =
      enriched.paths["/api/v1/integrations/public/orders"]?.post?.requestBody;
    expect(publicOrderBody && "content" in publicOrderBody).toBe(true);

    const importBody = enriched.paths["/api/v1/products/import"]?.post?.requestBody;
    expect(
      importBody && "content" in importBody
        ? Boolean(importBody.content["multipart/form-data"])
        : false,
    ).toBe(true);
  });
});
