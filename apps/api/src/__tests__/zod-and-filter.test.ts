import { ArgumentsHost, BadRequestException, HttpStatus } from "@nestjs/common";
import { ERROR_CODES, ownerLoginSchema } from "@smart-pos/shared";
import { describe, expect, it, vi } from "vitest";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";

describe("ZodValidationPipe & AllExceptionsFilter", () => {
  it("validates valid payload and normalizes email", () => {
    const pipe = new ZodValidationPipe(ownerLoginSchema);
    const result = pipe.transform({
      email: "  Admin@SmartPos.VN ",
      password: "secret",
    });

    expect(result).toEqual({
      email: "admin@smartpos.vn",
      password: "secret",
    });
  });

  it("throws BadRequestException with standardized VALIDATION_ERROR code", () => {
    const pipe = new ZodValidationPipe(ownerLoginSchema);
    try {
      pipe.transform({ email: "invalid-email", password: "" });
      expect.unreachable("Should have thrown BadRequestException");
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse() as {
        code: string;
        details: unknown[];
      };
      expect(body.code).toBe(ERROR_CODES.VALIDATION_ERROR);
      expect(body.details.length).toBeGreaterThan(0);
    }
  });

  it("masks unexpected errors as generic 500 without leaking internals", () => {
    const filter = new AllExceptionsFilter();
    const jsonMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ json: jsonMock });

    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status: statusMock }),
        getRequest: () => ({ method: "POST", url: "/api/v1/pos/invoices" }),
      }),
    } as unknown as ArgumentsHost;

    filter.catch(new Error("Connection string password=secret"), host);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        path: "/api/v1/pos/invoices",
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: "Internal server error",
        },
      }),
    );
  });
});
