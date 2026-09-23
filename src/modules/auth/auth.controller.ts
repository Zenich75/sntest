import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  SerializeOptions,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { clearCsrfCookie, issueCsrfToken } from '../../common/csrf/csrf';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SESSION_COOKIE_NAME } from '../../common/session/orphaned-session.middleware';
import { OWN_ACCOUNT_GROUP } from '../../common/serialization/groups';
import { MessageResponseDto } from '../../common/dto/message-response.dto';
import { ApiCsrfProtected } from '../../common/swagger/api-csrf-protected.decorator';
import { ApiErrorResponses } from '../../common/swagger/api-error-responses.decorator';
import { THROTTLE_LIMITS } from '../../common/throttling/throttle-limits';
import { User } from '../../entities/user.entity';
import { AuthService } from './auth.service';
import { CsrfTokenResponseDto } from './dto/csrf-token-response.dto';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { RegisterDto } from './dto/register.dto';
import { LocalAuthGuard } from './strategies/local-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle({ default: THROTTLE_LIMITS.register })
  @ApiOperation({
    summary: 'Register a new user',
    description:
      'Sends an email with a confirmation link; login is blocked until it is confirmed.',
  })
  @ApiCreatedResponse({ type: User })
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.CONFLICT,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  @SerializeOptions({ groups: [OWN_ACCOUNT_GROUP] })
  register(@Body() dto: RegisterDto): Promise<User> {
    return this.authService.register(dto);
  }

  @Get('confirm-email')
  @Throttle({ default: THROTTLE_LIMITS.confirmEmail })
  @ApiOperation({ summary: 'Confirm email address by token' })
  @ApiQuery({ name: 'token', description: 'Token from the confirmation email' })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.TOO_MANY_REQUESTS)
  async confirmEmail(
    @Query('token') token: string,
  ): Promise<{ message: string }> {
    await this.authService.confirmEmail(token);
    return { message: 'Email confirmed successfully' };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: THROTTLE_LIMITS.login })
  @UseGuards(LocalAuthGuard)
  @ApiOperation({
    summary: 'Log in with username and password',
    description:
      'Sets the httpOnly `connect.sid` session cookie and a fresh `sn-test-csrf` cookie ' +
      '(the session is regenerated on login, so earlier CSRF tokens stop working). ' +
      'Counts failed attempts towards the rate limit too.',
  })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.TOO_MANY_REQUESTS)
  login(
    @CurrentUser() user: User,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): { id: string; username: string } {
    issueCsrfToken(req, res);
    return { id: user.id, username: user.username };
  }

  @Get('csrf-token')
  @ApiOperation({
    summary: 'Get the CSRF token for the current session',
    description:
      'Creates the token on first call, sets the readable `sn-test-csrf` cookie and ' +
      'returns the same value. Send it as the X-CSRF-Token header on every ' +
      'POST/PUT/PATCH/DELETE made while logged in.',
  })
  @ApiOkResponse({ type: CsrfTokenResponseDto })
  getCsrfToken(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): CsrfTokenResponseDto {
    return { csrfToken: issueCsrfToken(req, res) };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log out and destroy the session',
    description: 'Needs X-CSRF-Token while logged in.',
  })
  @ApiCsrfProtected()
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiErrorResponses(HttpStatus.FORBIDDEN)
  logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    return new Promise((resolve, reject) => {
      req.logout((err) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        res.clearCookie(SESSION_COOKIE_NAME);
        clearCsrfCookie(res);
        resolve({ message: 'Logged out successfully' });
      });
    });
  }
}
