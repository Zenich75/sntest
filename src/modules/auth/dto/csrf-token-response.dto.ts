import { ApiProperty } from '@nestjs/swagger';

export class CsrfTokenResponseDto {
  @ApiProperty({
    example: '5f0c…e41a',
    description: 'Send as the X-CSRF-Token header on state-changing requests',
  })
  csrfToken: string;
}
