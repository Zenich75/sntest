import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  createConfirmedUser,
  createTestApp,
  expectTooManyRequests,
} from './utils/test-app';

describe('Rate limiting behind a proxy, TRUST_PROXY=true (e2e)', () => {
  let app: NestExpressApplication;
  const username = 'proxy_user';

  beforeAll(async () => {
    // setupApp() reads it; jest gives each test file its own process.env.
    process.env.TRUST_PROXY = 'true';
    ({ app } = await createTestApp({ throttling: true }));
    await createConfirmedUser(app, username);
  });

  afterAll(async () => {
    await app.close();
  });

  it('counts each client IP from X-Forwarded-For separately', async () => {
    const loginFrom = (ip: string) =>
      request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ username, password: 'wrong-password' });

    for (let i = 0; i < 5; i++) {
      expect((await loginFrom('198.51.100.1')).status).toBe(401);
    }
    expectTooManyRequests(await loginFrom('198.51.100.1'));

    // Another client behind the same proxy has its own budget.
    expect((await loginFrom('198.51.100.2')).status).toBe(401);
  });

  it('uses the address the proxy saw, not one the client prepended', async () => {
    // With one trusted hop only the last X-Forwarded-For entry (appended by
    // the proxy) counts; a spoofed first entry does not buy a new budget.
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '192.0.2.99, 198.51.100.1')
      .send({ username, password: 'wrong-password' });
    expectTooManyRequests(res);
  });
});
