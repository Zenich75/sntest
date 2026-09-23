import { config } from 'dotenv';

// Points the app at a dedicated database so e2e runs never touch the dev
// data in sn_test. Values set here win over .env (dotenv doesn't override
// existing variables); override them with E2E_DB_* when needed, e.g. in CI.
export function applyE2eEnv(): void {
  process.env.NODE_ENV = 'test';
  process.env.DB_HOST = process.env.E2E_DB_HOST ?? 'localhost';
  process.env.DB_PORT = process.env.E2E_DB_PORT ?? '5432';
  process.env.DB_NAME = process.env.E2E_DB_NAME ?? 'sn_test_e2e';
  // Only orphaned-session.e2e-spec.ts talks to Redis; the rest use MemoryStore.
  process.env.REDIS_HOST = process.env.E2E_REDIS_HOST ?? 'localhost';
  process.env.REDIS_PORT = process.env.E2E_REDIS_PORT ?? '6379';
  process.env.STORAGE_DRIVER = 'local';
  // Empty MAIL_HOST makes MailService log emails instead of sending them.
  process.env.MAIL_HOST = '';

  config({ quiet: true });

  process.env.DB_USERNAME ??= 'postgres';
  process.env.DB_PASSWORD ??= 'postgres';
  process.env.SESSION_SECRET ??= 'e2e-session-secret';
}

applyE2eEnv();
