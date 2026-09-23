import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { hasValidCsrfToken } from '../csrf/csrf';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Global guard: every state-changing request made with a logged-in session
// must carry a valid X-CSRF-Token (see GET /auth/csrf-token). Requests
// without an authenticated session are let through: there is no session
// cookie for a forged request to ride on, and protected routes reject them
// with 401 in SessionAuthGuard anyway.
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (SAFE_METHODS.has(request.method) || !request.isAuthenticated()) {
      return true;
    }

    if (!hasValidCsrfToken(request)) {
      throw new ForbiddenException('Invalid CSRF token');
    }

    return true;
  }
}
