import { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import {
  createConfirmedUser,
  createTestApp,
  expectTooManyRequests,
  loginWithCsrf,
  TEST_PASSWORD,
} from './utils/test-app';

// All requests come from one IP, so counters are cleared before each test
// to give every scenario the full budget of its route.
describe('Rate limiting (e2e)', () => {
  let app: NestExpressApplication;
  let agent: TestAgent;
  let postId: string;
  const username = 'limit_user';

  const login = (password: string) =>
    request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password });

  beforeAll(async () => {
    ({ app } = await createTestApp({ throttling: true }));
    await createConfirmedUser(app, username);
    agent = await loginWithCsrf(app, username, TEST_PASSWORD);
    postId = (await agent.post('/posts').send({ text: 'like me' }).expect(201))
      .body.id;
  });

  beforeEach(() => {
    // The default in-memory ThrottlerStorageService exposes its Map.
    const storage = app.get<{ storage: Map<string, unknown> }>(
      ThrottlerStorage,
    );
    storage.storage.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /auth/login: allows a normal login, answers the 6th attempt in a minute with 429', async () => {
    expect((await login(TEST_PASSWORD)).status).toBe(200);
    for (let i = 0; i < 4; i++) {
      expect((await login('wrong-password')).status).toBe(401);
    }

    expectTooManyRequests(await login('wrong-password'));
    // Even the right password is refused until the window passes.
    expectTooManyRequests(await login(TEST_PASSWORD));
  });

  it('ignores X-Forwarded-For while TRUST_PROXY is off', async () => {
    for (let i = 0; i < 5; i++) {
      await login('wrong-password');
    }

    const spoofed = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '203.0.113.7')
      .send({ username, password: TEST_PASSWORD });
    expectTooManyRequests(spoofed);
  });

  it('POST /auth/register: answers the 4th registration in a minute with 429', async () => {
    const register = (i: number) =>
      request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: `reg_limit_${i}`,
          email: `reg_limit_${i}@example.com`,
          password: TEST_PASSWORD,
        });

    for (let i = 0; i < 3; i++) {
      expect((await register(i)).status).toBe(201);
    }
    expectTooManyRequests(await register(3));
  });

  it('GET /auth/confirm-email: answers the 11th attempt in a minute with 429', async () => {
    const confirm = () =>
      request(app.getHttpServer())
        .get('/auth/confirm-email')
        .query({ token: 'guess' });

    for (let i = 0; i < 10; i++) {
      expect((await confirm()).status).toBe(400);
    }
    expectTooManyRequests(await confirm());
  });

  it('POST /posts/:postId/likes: answers the 21st like in 10 seconds with 429', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await agent.post(`/posts/${postId}/likes`)).status).toBe(201);
    }
    expectTooManyRequests(await agent.post(`/posts/${postId}/likes`));
  });

  it('DELETE /posts/:postId/likes: has its own 20 per 10 seconds budget', async () => {
    await agent.post(`/posts/${postId}/likes`).expect(201);
    expect((await agent.delete(`/posts/${postId}/likes`)).status).toBe(204);
    for (let i = 0; i < 19; i++) {
      expect((await agent.delete(`/posts/${postId}/likes`)).status).toBe(404);
    }
    expectTooManyRequests(await agent.delete(`/posts/${postId}/likes`));
  });

  it('applies the global 60 per minute default to other routes', async () => {
    for (let i = 0; i < 60; i++) {
      expect((await request(app.getHttpServer()).get('/')).status).toBe(200);
    }
    expectTooManyRequests(await request(app.getHttpServer()).get('/'));
  });
});
