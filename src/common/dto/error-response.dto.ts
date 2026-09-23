import { ApiProperty } from '@nestjs/swagger';

// Swagger schema for the body AllExceptionsFilter sends on every error.
export class ErrorResponseDto {
  @ApiProperty({ example: 404 })
  statusCode: number;

  @ApiProperty({
    oneOf: [
      { type: 'string', example: 'Post not found' },
      { type: 'array', items: { type: 'string' } },
    ],
    description: 'A string, or a list of messages for validation errors',
  })
  message: string | string[];

  @ApiProperty({ example: 'Not Found' })
  error: string;

  @ApiProperty({ example: '2026-09-23T12:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: '/posts/3f2b8c1e-5a4d-4e8f-9b7a-1c2d3e4f5a6b' })
  path: string;
}
