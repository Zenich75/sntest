import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  createConfirmedUser,
  createTestApp,
  expectErrorBody,
  loginWithCsrf,
  TEST_PASSWORD,
  useCsrfToken,
} from './utils/test-app';

function cookieFrom(res: request.Response, name: string): string {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = cookies.find((c) => c.startsWith(`${name}=`));
  if (!cookie) {
    throw new Error(`No ${name} cookie in response`);
  }
  return cookie.split(';')[0];
}

describe('CSRF protection (e2e)', () => {
  let app: NestExpressApplication;
  const alice = 'csrf_alice';
  const bob = 'csrf_bob';

  const login = (username: string) =>
    request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: TEST_PASSWORD })
      .expect(200);

  // A logged-in agent that has NOT fetched a CSRF token.
  const loggedInAgent = async (username: string) => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/auth/login')
      .send({ username, password: TEST_PASSWORD })
      .expect(200);
    return agent;
  };

  beforeAll(async () => {
    ({ app } = await createTestApp());
    await createConfirmedUser(app, alice);
    await createConfirmedUser(app, bob);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /auth/csrf-token sets a readable cookie with the same token and keeps it stable', async () => {
    const agent = request.agent(app.getHttpServer());

    const first = await agent.get('/auth/csrf-token').expect(200);
    const token: string = first.body.csrfToken;
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const cookies = ([] as string[]).concat(first.headers['set-cookie']);
    const csrfCookie = cookies.find((c) => c.startsWith('sn-test-csrf='));
    expect(csrfCookie).toContain(`sn-test-csrf=${token}`);
    expect(csrfCookie).not.toMatch(/HttpOnly/i);

    const second = await agent.get('/auth/csrf-token').expect(200);
    expect(second.body.csrfToken).toBe(token);
  });

  it('rejects an authenticated POST /posts without X-CSRF-Token with 403', async () => {
    const agent = await loggedInAgent(alice);

    const res = await agent.post('/posts').send({ text: 'no token' });
    expectErrorBody(res, 403, 'Invalid CSRF token');
  });

  it('accepts the same request with the token (201)', async () => {
    const agent = await loginWithCsrf(app, alice, TEST_PASSWORD);

    await agent.post('/posts').send({ text: 'with token' }).expect(201);
  });

  it('rejects a wrong token', async () => {
    const agent = await loginWithCsrf(app, alice, TEST_PASSWORD);

    const res = await agent
      .post('/posts')
      .set('X-CSRF-Token', 'f'.repeat(64))
      .send({ text: 'x' });
    expectErrorBody(res, 403, 'Invalid CSRF token');
  });

  it("rejects another session's token, even with a matching planted cookie", async () => {
    const aliceAgent = await loginWithCsrf(app, alice, TEST_PASSWORD);
    const aliceToken: string = (await aliceAgent.get('/auth/csrf-token')).body
      .csrfToken;
    const bobSession = cookieFrom(await login(bob), 'connect.sid');

    // Header and cookie agree, but not with the token in Bob's session.
    const res = await request(app.getHttpServer())
      .post('/posts')
      .set('Cookie', `${bobSession}; sn-test-csrf=${aliceToken}`)
      .set('X-CSRF-Token', aliceToken)
      .send({ text: 'forged' });
    expectErrorBody(res, 403, 'Invalid CSRF token');
  });

  it('rejects a header that matches the session token when the cookie is missing', async () => {
    const res = await login(alice);
    const session = cookieFrom(res, 'connect.sid');
    const token = cookieFrom(res, 'sn-test-csrf').split('=')[1];

    const forged = await request(app.getHttpServer())
      .post('/posts')
      .set('Cookie', session)
      .set('X-CSRF-Token', token)
      .send({ text: 'x' });
    expectErrorBody(forged, 403, 'Invalid CSRF token');
  });

  it('rotates the token on login', async () => {
    const agent = request.agent(app.getHttpServer());
    const before = await useCsrfToken(agent);

    await agent
      .post('/auth/login')
      .send({ username: alice, password: TEST_PASSWORD })
      .expect(200);

    // The agent still sends the pre-login token.
    const stale = await agent.post('/posts').send({ text: 'stale token' });
    expectErrorBody(stale, 403, 'Invalid CSRF token');

    const after = await useCsrfToken(agent);
    expect(after).not.toBe(before);
    await agent.post('/posts').send({ text: 'fresh token' }).expect(201);
  });

  it('protects every state-changing endpoint behind the session', async () => {
    const owner = await loginWithCsrf(app, alice, TEST_PASSWORD);
    const post = await owner
      .post('/posts')
      .send({ text: 'target' })
      .expect(201);
    const postId: string = post.body.id;
    const comment = await owner
      .post(`/posts/${postId}/comments`)
      .send({ text: 'c' })
      .expect(201);
    const bobId: string = (
      await request(app.getHttpServer())
        .get(`/users/by-username/${bob}`)
        .expect(200)
    ).body.id;

    const noToken = await loggedInAgent(alice);
    // Built lazily: supertest requests on the same server must not overlap.
    const attempts = [
      () => noToken.post('/posts').send({ text: 'x' }),
      () => noToken.delete(`/posts/${postId}`),
      () => noToken.post(`/posts/${postId}/comments`).send({ text: 'x' }),
      () => noToken.delete(`/comments/${comment.body.id}`),
      () => noToken.post(`/posts/${postId}/likes`),
      () => noToken.delete(`/posts/${postId}/likes`),
      () => noToken.post(`/users/${bobId}/follow`),
      () => noToken.delete(`/users/${bobId}/follow`),
      () => noToken.post('/auth/logout'),
    ];
    for (const attempt of attempts) {
      expectErrorBody(await attempt(), 403, 'Invalid CSRF token');
    }
  });

  it('does not require the token for GET requests', async () => {
    const agent = await loggedInAgent(alice);

    const [latest] = (await agent.get('/posts').expect(200)).body;
    await agent.get(`/posts/${latest.id}`).expect(200);
    await agent.get(`/posts/${latest.id}/likes`).expect(200);
    await agent.get(`/users/by-username/${alice}`).expect(200);
  });

  it('does not block public POSTs made without a session', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        username: 'csrf_public',
        email: 'csrf_public@example.com',
        password: TEST_PASSWORD,
      })
      .expect(201);

    await login(alice);
  });

  it('answers 401 (not 403) to a protected POST without a session', async () => {
    await request(app.getHttpServer())
      .post('/posts')
      .send({ text: 'anonymous' })
      .expect(401);
  });

  it('lets logout through once the token is sent', async () => {
    const agent = await loginWithCsrf(app, alice, TEST_PASSWORD);

    await agent.post('/auth/logout').expect(200);
    // Logged out: the old token no longer matters, protected routes say 401.
    await agent.post('/posts').send({ text: 'x' }).expect(401);
  });
});
