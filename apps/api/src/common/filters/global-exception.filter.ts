import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { ERROR_CODES } from '@erp/config';
import type { ApiResponse } from '@erp/types';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorCode: string = ERROR_CODES.INTERNAL_ERROR;
    let message = 'Internal server error';
    let details: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exResponse = exception.getResponse() as Record<string, unknown>;
      // A thrown HttpException without its own errorCode still says what kind of failure it was:
      // a 404 is NOT_FOUND, never INTERNAL_ERROR (AR audit, Step 9).
      errorCode = (exResponse['errorCode'] as string) ?? codeForStatus(status);
      message = (exResponse['message'] as string) ?? exception.message;
      details = exResponse['details'] as Record<string, unknown> | undefined;
    } else {
      this.logger.error(`Unhandled exception on ${request.method} ${request.url}`, exception);
    }

    const body: ApiResponse = {
      success: false,
      error: { code: errorCode, message, details },
    };

    response.status(status).json(body);
  }
}

function codeForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return ERROR_CODES.VALIDATION_ERROR;
    case HttpStatus.UNAUTHORIZED:
      return ERROR_CODES.UNAUTHORIZED;
    case HttpStatus.FORBIDDEN:
      return ERROR_CODES.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ERROR_CODES.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ERROR_CODES.CONFLICT;
    default:
      return ERROR_CODES.INTERNAL_ERROR;
  }
}
