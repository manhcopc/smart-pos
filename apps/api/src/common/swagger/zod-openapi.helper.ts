import { type INestApplication, RequestMethod } from "@nestjs/common";
import {
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from "@nestjs/common/constants";
import { RouteParamtypes } from "@nestjs/common/enums/route-paramtypes.enum";
import { ModulesContainer } from "@nestjs/core";
import type { OpenAPIObject } from "@nestjs/swagger";
import type {
  OperationObject,
  ParameterObject,
  ReferenceObject,
  SchemaObject,
} from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import { ZodFirstPartyTypeKind, type ZodTypeAny } from "zod";
import { ZodValidationPipe } from "../pipes/zod-validation.pipe";

type HttpOperationKey = "get" | "post" | "put" | "delete" | "patch" | "options" | "head";

const REQUEST_METHOD_MAP: Partial<Record<RequestMethod, HttpOperationKey>> = {
  [RequestMethod.GET]: "get",
  [RequestMethod.POST]: "post",
  [RequestMethod.PUT]: "put",
  [RequestMethod.DELETE]: "delete",
  [RequestMethod.PATCH]: "patch",
  [RequestMethod.OPTIONS]: "options",
  [RequestMethod.HEAD]: "head",
};

interface RouteArgMetadataEntry {
  index: number;
  data?: unknown;
  pipes?: unknown[];
}

function unwrapZodMeta(schema: ZodTypeAny): {
  inner: ZodTypeAny;
  isOptional: boolean;
  isNullable: boolean;
  hasDefault: boolean;
  defaultValue: unknown;
  description?: string;
} {
  let current: ZodTypeAny = schema;
  let isOptional = false;
  let isNullable = false;
  let hasDefault = false;
  let defaultValue: unknown = undefined;
  let description = current.description;

  for (let depth = 0; depth < 12; depth += 1) {
    const def = current._def as {
      typeName?: string;
      innerType?: ZodTypeAny;
      schema?: ZodTypeAny;
      type?: ZodTypeAny;
      defaultValue?: () => unknown;
    };
    if (!description && current.description) {
      description = current.description;
    }

    switch (def.typeName) {
      case ZodFirstPartyTypeKind.ZodOptional:
        isOptional = true;
        current = def.innerType!;
        break;
      case ZodFirstPartyTypeKind.ZodNullable:
        isNullable = true;
        current = def.innerType!;
        break;
      case ZodFirstPartyTypeKind.ZodDefault:
        isOptional = true;
        hasDefault = true;
        defaultValue = def.defaultValue ? def.defaultValue() : undefined;
        current = def.innerType!;
        break;
      case ZodFirstPartyTypeKind.ZodEffects:
        current = def.schema!;
        break;
      case ZodFirstPartyTypeKind.ZodCatch:
        isOptional = true;
        current = def.innerType!;
        break;
      case ZodFirstPartyTypeKind.ZodPipeline:
        current = def.type ?? current;
        break;
      default:
        return {
          inner: current,
          isOptional,
          isNullable,
          hasDefault,
          defaultValue,
          description,
        };
    }
  }

  return {
    inner: current,
    isOptional,
    isNullable,
    hasDefault,
    defaultValue,
    description,
  };
}

function exampleForString(
  propName: string | undefined,
  format: string | undefined,
): string | undefined {
  if (format === "email") return "owner@shop.vn";
  if (format === "uuid") return "00000000-0000-4000-8000-000000000000";
  if (format === "uri") return "https://example.com";
  if (format === "date-time") return "2026-11-17T12:00:00.000Z";
  const lower = (propName ?? "").toLowerCase();
  if (lower.includes("password")) return "Password123!";
  if (lower === "pin") return "1234";
  if (lower.includes("slug")) return "cafe-lan";
  if (lower.includes("phone")) return "0909123456";
  if (lower.includes("employeecode")) return "TN01";
  return undefined;
}

export function zodToOpenApiSchema(
  schema: ZodTypeAny,
  propName?: string,
): SchemaObject {
  const meta = unwrapZodMeta(schema);
  const def = meta.inner._def as {
    typeName?: string;
    checks?: Array<{ kind: string; value?: unknown; regex?: RegExp }>;
    values?: readonly string[];
    value?: unknown;
    shape?: () => Record<string, ZodTypeAny>;
    type?: ZodTypeAny;
    minLength?: { value: number } | null;
    maxLength?: { value: number } | null;
    exactLength?: { value: number } | null;
    options?: readonly ZodTypeAny[];
    valueType?: ZodTypeAny;
  };

  let out: SchemaObject;

  switch (def.typeName) {
    case ZodFirstPartyTypeKind.ZodString: {
      out = { type: "string" };
      for (const check of def.checks ?? []) {
        if (check.kind === "email") out.format = "email";
        else if (check.kind === "uuid") out.format = "uuid";
        else if (check.kind === "url") out.format = "uri";
        else if (check.kind === "datetime") out.format = "date-time";
        else if (check.kind === "min" && typeof check.value === "number") {
          out.minLength = check.value;
        } else if (check.kind === "max" && typeof check.value === "number") {
          out.maxLength = check.value;
        } else if (check.kind === "regex" && check.regex instanceof RegExp) {
          out.pattern = check.regex.source;
        }
      }
      const ex = exampleForString(propName, out.format);
      if (ex !== undefined) out.example = ex;
      break;
    }
    case ZodFirstPartyTypeKind.ZodNumber: {
      const isInt = (def.checks ?? []).some((c) => c.kind === "int");
      out = { type: isInt ? "integer" : "number" };
      for (const check of def.checks ?? []) {
        if (check.kind === "min" && typeof check.value === "number") {
          out.minimum = check.value;
        } else if (check.kind === "max" && typeof check.value === "number") {
          out.maximum = check.value;
        }
      }
      break;
    }
    case ZodFirstPartyTypeKind.ZodBoolean:
      out = { type: "boolean" };
      break;
    case ZodFirstPartyTypeKind.ZodEnum:
      out = {
        type: "string",
        enum: [...(def.values ?? [])],
        ...(def.values?.[0] !== undefined ? { example: def.values[0] } : {}),
      };
      break;
    case ZodFirstPartyTypeKind.ZodNativeEnum: {
      const enumValues = Object.values(
        (def.values as Record<string, string | number> | undefined) ?? {},
      ).filter((v) => typeof v === "string" || typeof v === "number");
      out = {
        type: typeof enumValues[0] === "number" ? "number" : "string",
        enum: enumValues as string[],
      };
      break;
    }
    case ZodFirstPartyTypeKind.ZodLiteral:
      out = {
        type:
          typeof def.value === "number"
            ? "number"
            : typeof def.value === "boolean"
              ? "boolean"
              : "string",
        enum: [def.value],
        example: def.value,
      };
      break;
    case ZodFirstPartyTypeKind.ZodArray: {
      out = {
        type: "array",
        items: def.type ? zodToOpenApiSchema(def.type, propName) : {},
      };
      if (def.minLength) out.minItems = def.minLength.value;
      if (def.maxLength) out.maxItems = def.maxLength.value;
      if (def.exactLength) {
        out.minItems = def.exactLength.value;
        out.maxItems = def.exactLength.value;
      }
      break;
    }
    case ZodFirstPartyTypeKind.ZodObject: {
      const shape = def.shape ? def.shape() : {};
      const properties: Record<string, SchemaObject | ReferenceObject> = {};
      const required: string[] = [];

      for (const [key, fieldSchema] of Object.entries(shape)) {
        const fieldMeta = unwrapZodMeta(fieldSchema);
        properties[key] = zodToOpenApiSchema(fieldSchema, key);
        if (!fieldMeta.isOptional) {
          required.push(key);
        }
      }

      out = {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
      };
      break;
    }
    case ZodFirstPartyTypeKind.ZodUnion:
    case ZodFirstPartyTypeKind.ZodDiscriminatedUnion: {
      const unionOpts = (def.options ?? []).map((opt) =>
        zodToOpenApiSchema(opt, propName),
      );
      const isMoneyOrQtyUnion =
        unionOpts.length === 2 &&
        unionOpts.some((o) => o.type === "string") &&
        unionOpts.some((o) => o.type === "number");
      out = isMoneyOrQtyUnion
        ? {
            type: "string",
            example:
              propName?.toLowerCase().includes("qty") ||
              propName?.toLowerCase().includes("quantity")
                ? "1.000"
                : "10000.00",
          }
        : { oneOf: unionOpts };
      break;
    }
    case ZodFirstPartyTypeKind.ZodRecord:
      out = {
        type: "object",
        additionalProperties: def.valueType
          ? zodToOpenApiSchema(def.valueType)
          : true,
      };
      break;
    case ZodFirstPartyTypeKind.ZodDate:
      out = { type: "string", format: "date-time" };
      break;
    default:
      out = { type: "string" };
  }

  if (meta.isNullable) out.nullable = true;
  if (meta.hasDefault && meta.defaultValue !== undefined) {
    out.default = meta.defaultValue;
  }
  if (meta.description) out.description = meta.description;
  return out;
}

function normalizePathSegments(segments: string[]): string {
  const joined = segments
    .map((s) => s.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/")
    .replace(/:([A-Za-z0-9_]+)/g, "{$1}");
  return `/${joined}`;
}

function extractPipeSchema(entry: RouteArgMetadataEntry): ZodTypeAny | null {
  for (const pipe of entry.pipes ?? []) {
    if (pipe instanceof ZodValidationPipe) {
      return pipe.getSchema();
    }
  }
  return null;
}

function upsertParameter(
  params: (ParameterObject | ReferenceObject)[],
  nextParam: ParameterObject,
): void {
  const idx = params.findIndex(
    (p) => !("$ref" in p) && p.name === nextParam.name && p.in === nextParam.in,
  );
  if (idx >= 0) {
    params[idx] = { ...(params[idx] as ParameterObject), ...nextParam };
  } else {
    params.push(nextParam);
  }
}

function applyRouteZodSchemas(
  operation: OperationObject,
  routeArgs: Record<string, RouteArgMetadataEntry>,
): void {
  for (const [key, entry] of Object.entries(routeArgs)) {
    const paramType = Number(key.split(":")[0]);

    if (paramType === RouteParamtypes.FILE) {
      const fieldName =
        typeof entry.data === "string" && entry.data.length > 0
          ? entry.data
          : "file";
      operation.requestBody = {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              required: [fieldName],
              properties: {
                [fieldName]: { type: "string", format: "binary" },
              },
            },
          },
        },
      };
      continue;
    }

    const pipeSchema = extractPipeSchema(entry);
    if (!pipeSchema) continue;

    if (paramType === RouteParamtypes.BODY) {
      const bodySchema = zodToOpenApiSchema(pipeSchema);
      const bodyMeta = unwrapZodMeta(pipeSchema);
      operation.requestBody = {
        required: !bodyMeta.isOptional,
        content: {
          "application/json": {
            schema: bodySchema,
          },
        },
      };
      continue;
    }

    if (paramType === RouteParamtypes.QUERY) {
      operation.parameters = operation.parameters ?? [];
      const queryMeta = unwrapZodMeta(pipeSchema);
      const querySchema = zodToOpenApiSchema(pipeSchema);

      if (typeof entry.data === "string" && entry.data.length > 0) {
        upsertParameter(operation.parameters, {
          name: entry.data,
          in: "query",
          required: !queryMeta.isOptional,
          schema: querySchema,
        });
      } else if (querySchema.type === "object" && querySchema.properties) {
        const requiredSet = new Set(querySchema.required ?? []);
        for (const [fieldName, propSchema] of Object.entries(
          querySchema.properties,
        )) {
          if ("$ref" in propSchema) continue;
          upsertParameter(operation.parameters, {
            name: fieldName,
            in: "query",
            required: requiredSet.has(fieldName),
            schema: propSchema,
          });
        }
      }
      continue;
    }

    if (
      paramType === RouteParamtypes.PARAM &&
      typeof entry.data === "string" &&
      entry.data.length > 0
    ) {
      operation.parameters = operation.parameters ?? [];
      upsertParameter(operation.parameters, {
        name: entry.data,
        in: "path",
        required: true,
        schema: zodToOpenApiSchema(pipeSchema, entry.data),
      });
    }
  }
}

/**
 * Enriches the NestJS-generated OpenAPI document with RequestBody and Query/Param
 * schemas extracted automatically from controller `ZodValidationPipe` decorators.
 */
export function enrichOpenApiWithZodPipes(
  app: INestApplication,
  document: OpenAPIObject,
  globalPrefix = "api/v1",
): OpenAPIObject {
  const modulesContainer = app.get(ModulesContainer);

  for (const moduleRef of modulesContainer.values()) {
    for (const controllerWrapper of moduleRef.controllers.values()) {
      const controllerClass = controllerWrapper.metatype;
      if (!controllerClass || typeof controllerClass !== "function") continue;

      const rawControllerPath = Reflect.getMetadata(
        PATH_METADATA,
        controllerClass,
      ) as string | string[] | undefined;
      if (rawControllerPath === undefined) continue;

      const controllerPaths = Array.isArray(rawControllerPath)
        ? rawControllerPath
        : [rawControllerPath];

      const prototype = controllerClass.prototype as Record<string, unknown>;
      for (const methodName of Object.getOwnPropertyNames(prototype)) {
        if (methodName === "constructor") continue;
        const handler = prototype[methodName];
        if (typeof handler !== "function") continue;

        const requestMethod = Reflect.getMetadata(
          METHOD_METADATA,
          handler,
        ) as RequestMethod | undefined;
        const httpKey =
          requestMethod !== undefined
            ? REQUEST_METHOD_MAP[requestMethod]
            : undefined;
        if (!httpKey) continue;

        const rawRoutePath = (Reflect.getMetadata(PATH_METADATA, handler) ??
          "/") as string | string[];
        const routePaths = Array.isArray(rawRoutePath)
          ? rawRoutePath
          : [rawRoutePath];

        const routeArgs = Reflect.getMetadata(
          ROUTE_ARGS_METADATA,
          controllerClass,
          methodName,
        ) as Record<string, RouteArgMetadataEntry> | undefined;
        if (!routeArgs) continue;

        for (const ctrlPath of controllerPaths) {
          for (const methodPath of routePaths) {
            const fullPath = normalizePathSegments([
              globalPrefix,
              ctrlPath,
              methodPath,
            ]);
            const operation = document.paths?.[fullPath]?.[httpKey];
            if (operation) {
              applyRouteZodSchemas(operation, routeArgs);
            }
          }
        }
      }
    }
  }

  return document;
}
