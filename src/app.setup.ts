import { Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import passport from 'passport';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import {
  clearOrphanedSession,
  SESSION_COOKIE_NAME,
} from './common/session/orphaned-session.middleware';

const SESSION_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface SetupAppOptions {
  // Omitted in e2e tests, which fall back to express-session's MemoryStore
  // so they don't need Redis.
  sessionStore?: session.Store;
}

// Global app wiring shared by main.ts and the e2e tests, so tests exercise
// the same pipes/serializer/filter/session setup as the real server.
export function setupApp(
  app: NestExpressApplication,
  { sessionStore }: SetupAppOptions = {},
): void {
  // Behind a reverse proxy (nginx/ALB) the socket address is the proxy's:
  // trusting one hop makes req.ip/req.ips come from X-Forwarded-For, which
  // the throttler tracks by and which secure cookies need to see HTTPS.
  // Leave off when clients connect directly, or they could spoof the header.
  if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableCors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  });

  // Populates req.cookies, used by CsrfGuard to read the CSRF cookie.
  app.use(cookieParser());

  app.use(
    session({
      store: sessionStore,
      name: SESSION_COOKIE_NAME,
      secret: process.env.SESSION_SECRET!,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        maxAge: SESSION_COOKIE_MAX_AGE_MS,
        secure: process.env.NODE_ENV === 'production',
      },
    }),
  );

  app.use(passport.initialize());
  app.use(passport.session());
  app.use(clearOrphanedSession);
}
