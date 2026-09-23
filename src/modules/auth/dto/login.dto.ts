import { ApiProperty } from '@nestjs/swagger';

// Swagger-only: the body is read by LocalStrategy (passport-local), which
// runs in LocalAuthGuard before any pipe could validate it.
export class LoginDto {
  @ApiProperty({ example: 'johndoe' })
  username: string;

  @ApiProperty({ example: 'password123' })
  password: string;
}
