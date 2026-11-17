import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { ERROR_CODES } from "@smart-pos/shared";
import { Request, Response } from "express";

interface ErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let error: ErrorPayload = {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: "Internal server error",
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "string") {
        error = { code: this.defaultCodeForStatus(status), message: body };
      } else if (body && typeof body === "object") {
        const record = body as Record<string, unknown>;
        error = {
          code:
            typeof record.code === "string"
              ? record.code
              : this.defaultCodeForStatus(status),
          message:
            typeof record.message === "string"
              ? record.message
              : Array.isArray(record.message)
                ? record.message.join("; ")
                : exception.message,
          ...(record.details !== undefined ? { details: record.details } : {}),
        };
      }
    } else if (exception instanceof Error) {
      this.logger.error(
        `Unhandled ${exception.name} on ${request.method} ${request.url}`,
      );
    }

    response.status(status).json({
      error,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private defaultCodeForStatus(status: number): string {
    if (status === HttpStatus.BAD_REQUEST) return ERROR_CODES.VALIDATION_ERROR;
    if (status === HttpStatus.UNAUTHORIZED) return ERROR_CODES.AUTH_UNAUTHORIZED;
    if (status === HttpStatus.FORBIDDEN) return ERROR_CODES.AUTH_FORBIDDEN;
    if (status === HttpStatus.NOT_FOUND) return ERROR_CODES.RESOURCE_NOT_FOUND;
    return ERROR_CODES.INTERNAL_ERROR;
  }
}
