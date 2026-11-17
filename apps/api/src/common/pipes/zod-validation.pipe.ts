import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";
import { ERROR_CODES } from "@smart-pos/shared";
import { ZodType, type ZodTypeDef } from "zod";

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  getSchema(): ZodType<T, ZodTypeDef, unknown> {
    return this.schema;
  }

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Request validation failed",
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    return parsed.data;
  }
}
