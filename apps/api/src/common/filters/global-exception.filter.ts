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
      errorCode = (exResponse['errorCode'] as string) ?? ERROR_CODES.INTERNAL_ERROR;
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
