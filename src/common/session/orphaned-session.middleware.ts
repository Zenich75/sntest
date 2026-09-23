import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { Session } from 'express-session';
import { clearCsrfCookie } from '../csrf/csrf';

export const SESSION_COOKIE_NAME = 'connect.sid';

declare module 'express-session' {
  interface SessionData {
    passport?: { user?: string };
  }
}

const logger = new Logger('OrphanedSession');

// Runs right after passport.session(). When a session points at a user
// that no longer exists, SessionSerializer returns `false` and passport
// drops `passport.user` but keeps the empty `passport` object, so the
// request is already anonymous: protected routes answer 401 and soft-auth
// routes (likes, profile) treat it as a guest. Left alone, that dead
// session would be saved back to the store with a fresh 7-day TTL.
//
// regenerate() deletes the stored record and gives the request a new,
// empty session (unlike destroy(), req.session stays usable, e.g. for
// GET /auth/csrf-token or a login in the same request).
export function clearOrphanedSession(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const session = req.session;
  const isOrphaned =
    session?.passport !== undefined && session.passport.user === undefined;

  if (!isOrphaned) {
    next();
    return;
  }

  const orphanedId = session.id;
  session.regenerate((error: unknown) => {
    if (error) {
      // The request is anonymous either way; the record will expire.
      logger.warn(
        `Could not remove orphaned session ${orphanedId}: ${
          error instanceof Error ? error.message : JSON.stringify(error)
        }`,
      );
    }
    saveOnlyIfUsed(req.session);
    clearCsrfCookie(res);
    next();
  });
}

// express-session counts a regenerated session as modified (its id changed)
// and would store it even if nothing is ever put in it. Skip that save
// unless the request actually stores data (CSRF token, login, ...).
function saveOnlyIfUsed(session: Request['session']): void {
  const originalSave = session.save.bind(session) as Session['save'];

  const save: Session['save'] = (callback) => {
    const hasData = Object.keys(session).some((key) => key !== 'cookie');
    if (hasData) {
      return originalSave(callback);
    }
    callback?.(undefined);
    return session;
  };

  // Non-enumerable, like express-session's own method, so it is neither
  // stored nor mistaken for session data by the check above.
  Object.defineProperty(session, 'save', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: save,
  });
}
