import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error-response.dto';

const ERROR_DESCRIPTIONS: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Validation failed or malformed id',
  [HttpStatus.UNAUTHORIZED]: 'Not logged in (no valid session cookie)',
  [HttpStatus.FORBIDDEN]:
    'Missing/invalid X-CSRF-Token, or not the owner of the resource (delete post/comment)',
  [HttpStatus.NOT_FOUND]: 'Resource not found',
  [HttpStatus.CONFLICT]: 'Resource already exists',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Rate limit exceeded for this IP',
};

// Documents the listed error statuses with the unified error body shape.
export function ApiErrorResponses(...statuses: HttpStatus[]) {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: ERROR_DESCRIPTIONS[status],
        type: ErrorResponseDto,
      }),
    ),
  );
}
