import { randomBytes, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';

export const CSRF_COOKIE_NAME = 'sn-test-csrf';
export const CSRF_HEADER_NAME = 'X-CSRF-Token';

declare module 'express-session' {
  interface SessionData {
    csrfToken?: string;
  }
}

// Returns the session's CSRF token, creating one on first use, and (re)sets
// the readable cookie that carries it to the client. The token lives in the
// session, so it is bound to the session id and rotates with it on login.
export function issueCsrfToken(req: Request, res: Response): string {
  const token = req.session.csrfToken ?? randomBytes(32).toString('hex');
  req.session.csrfToken = token;

  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false, // the SPA reads it and echoes it in X-CSRF-Token
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });

  return token;
}

export function clearCsrfCookie(res: Response): void {
  res.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
}

// Double submit cookie, checked against the session copy too: the header
// must equal the cookie, and both must equal the token stored server-side.
// The session check means an attacker who can plant a cookie (e.g. from a
// sibling subdomain) still can't pick a matching header value.
export function hasValidCsrfToken(req: Request): boolean {
  const expected = req.session?.csrfToken;
  const header = req.get(CSRF_HEADER_NAME);
  const cookie = (req.cookies as Record<string, string> | undefined)?.[
    CSRF_COOKIE_NAME
  ];

  return (
    expected !== undefined &&
    safeEqual(header, expected) &&
    safeEqual(cookie, expected)
  );
}

function safeEqual(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) {
    return false;
  }
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
