import { ApiSecurity } from '@nestjs/swagger';

export const COOKIE_SECURITY_NAME = 'cookie';
export const CSRF_SECURITY_NAME = 'csrf';

// For state-changing endpoints behind SessionAuthGuard: one security
// requirement listing both schemes (set up in main.ts) means session cookie
// AND X-CSRF-Token header — separate decorators would mean either/or.
export function ApiCsrfProtected() {
  return ApiSecurity({
    [COOKIE_SECURITY_NAME]: [],
    [CSRF_SECURITY_NAME]: [],
  });
}
