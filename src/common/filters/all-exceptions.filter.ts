import { STATUS_CODES } from 'http';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorResponseDto } from '../dto/error-response.dto';

const GENERIC_SERVER_ERROR_MESSAGE = 'Internal server error';

// Normalizes every error into { statusCode, message, error, timestamp, path }.
// Unexpected (non-HttpException) errors are logged with their stack, but the
// stack never reaches the response, and in production the message is
// replaced with a generic one so internals (SQL, driver errors) don't leak.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const { statusCode, message, error } =
      exception instanceof HttpException
        ? this.fromHttpException(exception)
        : this.fromUnknown(exception);

    if (statusCode >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.logger.error(
        `${request.method} ${request.originalUrl}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorResponseDto = {
      statusCode,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    };

    response.status(statusCode).json(body);
  }

  private fromHttpException(
    exception: HttpException,
  ): Pick<ErrorResponseDto, 'statusCode' | 'message' | 'error'> {
    const statusCode = exception.getStatus();
    const payload = exception.getResponse();
    const defaultError = STATUS_CODES[statusCode] ?? 'Error';

    if (typeof payload === 'string') {
      return { statusCode, message: payload, error: defaultError };
    }

    const { message, error } = payload as {
      message?: string | string[];
      error?: string;
    };

    return {
      statusCode,
      message: message ?? exception.message,
      error: error ?? defaultError,
    };
  }

  private fromUnknown(
    exception: unknown,
  ): Pick<ErrorResponseDto, 'statusCode' | 'message' | 'error'> {
    const statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    const isProduction = process.env.NODE_ENV === 'production';

    return {
      statusCode,
      message:
        !isProduction && exception instanceof Error
          ? exception.message
          : GENERIC_SERVER_ERROR_MESSAGE,
      error: STATUS_CODES[statusCode]!,
    };
  }
}
