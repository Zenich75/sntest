import { NestExpressApplication } from '@nestjs/platform-express';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import { Repository } from 'typeorm';
import { User } from '../src/entities/user.entity';
import { createTestApp, TestApp, useCsrfToken } from './utils/test-app';

const SENSITIVE_FIELDS = ['password', 'emailConfirmationToken'];
// Visible only in the user's own account response (POST /auth/register).
const OWN_ACCOUNT_FIELDS = ['email', 'isEmailConfirmed'];

// Walks the whole response body (nested authors, likes, follows, ...) so a
// missing @Exclude()/@Expose group anywhere in a relation graph fails the test.
function expectNoSensitiveFields(
  value: unknown,
  { ownAccount = false } = {},
): void {
  const forbidden = ownAccount
    ? SENSITIVE_FIELDS
    : [...SENSITIVE_FIELDS, ...OWN_ACCOUNT_FIELDS];

  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, nested] of Object.entries(node)) {
        if (forbidden.includes(key)) {
          throw new Error(`Sensitive field leaked at ${path}.${key}`);
        }
        walk(nested, `${path}.${key}`);
      }
    }
  };

  walk(value, 'body');
}

function expectErrorShape(
  body: unknown,
  statusCode: number,
  path: string,
): void {
  expect(body).toEqual({
    statusCode,
    message: expect.anything(),
    error: expect.any(String),
    timestamp: expect.any(String),
    path,
  });
}

interface Credentials {
  username: string;
  email: string;
  password: string;
}

describe('User flow (e2e)', () => {
  let app: NestExpressApplication;
  let userRepository: Repository<User>;
  let aliceAgent: TestAgent;
  let bobAgent: TestAgent;

  const suffix = Date.now().toString(36);
  const alice: Credentials = {
    username: `alice_${suffix}`,
    email: `alice_${suffix}@example.com`,
    password: 'password123',
  };
  const bob: Credentials = {
    username: `bob_${suffix}`,
    email: `bob_${suffix}@example.com`,
    password: 'password123',
  };

  let aliceId: string;
  let bobId: string;
  let postId: string;
  let commentId: string;

  let filesServiceMock: TestApp['filesServiceMock'];

  async function register(credentials: Credentials): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send(credentials)
      .expect(201);

    expectNoSensitiveFields(res.body, { ownAccount: true });
    expect(res.body).toMatchObject({
      username: credentials.username,
      email: credentials.email,
      isEmailConfirmed: false,
    });
    return res.body.id;
  }

  // The confirmation email isn't really sent, so the token is read straight
  // from the database.
  async function confirmEmail(userId: string): Promise<void> {
    const user = await userRepository.findOneByOrFail({ id: userId });
    expect(user.emailConfirmationToken).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token: user.emailConfirmationToken })
      .expect(200, { message: 'Email confirmed successfully' });
  }

  // Logs in and, like an SPA, fetches the CSRF token so every following
  // state-changing request on this agent carries X-CSRF-Token.
  async function login(agent: TestAgent, credentials: Credentials) {
    const res = await agent
      .post('/auth/login')
      .send({ username: credentials.username, password: credentials.password })
      .expect(200);
    await useCsrfToken(agent);
    return res;
  }

  beforeAll(async () => {
    ({ app, filesServiceMock } = await createTestApp());

    userRepository = app.get(getRepositoryToken(User));
    aliceAgent = request.agent(app.getHttpServer());
    bobAgent = request.agent(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a user, returning own email but no password/token', async () => {
    aliceId = await register(alice);
  });

  it('rejects login before the email is confirmed', async () => {
    const res = await aliceAgent
      .post('/auth/login')
      .send({ username: alice.username, password: alice.password })
      .expect(401);

    expectErrorShape(res.body, 401, '/auth/login');
    expect(res.body.message).toBe('Email is not confirmed');
  });

  it('confirms the email with the token from the database', async () => {
    await confirmEmail(aliceId);

    const user = await userRepository.findOneByOrFail({ id: aliceId });
    expect(user.isEmailConfirmed).toBe(true);
    expect(user.emailConfirmationToken).toBeNull();
  });

  it('logs in and sets an httpOnly session cookie', async () => {
    const res = await login(aliceAgent, alice);

    expect(res.body).toEqual({ id: aliceId, username: alice.username });
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const sessionCookie = cookies.find((c) => c.startsWith('connect.sid='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toMatch(/HttpOnly/i);

    // The CSRF cookie must stay readable by the frontend.
    const csrfCookie = cookies.find((c) => c.startsWith('sn-test-csrf='));
    expect(csrfCookie).toBeDefined();
    expect(csrfCookie).not.toMatch(/HttpOnly/i);
  });

  it('rejects creating a post without a session', async () => {
    const res = await request(app.getHttpServer())
      .post('/posts')
      .send({ text: 'anonymous' })
      .expect(401);

    expectErrorShape(res.body, 401, '/posts');
  });

  it('creates a text-only post', async () => {
    const res = await aliceAgent
      .post('/posts')
      .send({ text: 'Hello from e2e' })
      .expect(201);

    expectNoSensitiveFields(res.body);
    expect(res.body).toMatchObject({
      text: 'Hello from e2e',
      author: { id: aliceId },
      files: [],
    });
    expect(filesServiceMock.uploadManyPublicFiles).toHaveBeenCalled();
    postId = res.body.id;
  });

  it('gets the post by id', async () => {
    const res = await request(app.getHttpServer())
      .get(`/posts/${postId}`)
      .expect(200);

    expectNoSensitiveFields(res.body);
    expect(res.body).toMatchObject({
      id: postId,
      text: 'Hello from e2e',
      author: { id: aliceId, username: alice.username },
    });
  });

  it('returns 400 in the unified format for a malformed post id', async () => {
    const res = await request(app.getHttpServer())
      .get('/posts/not-a-uuid')
      .expect(400);

    expectErrorShape(res.body, 400, '/posts/not-a-uuid');
  });

  it('likes the post and reports likedByMe', async () => {
    const likeRes = await aliceAgent.post(`/posts/${postId}/likes`).expect(201);
    expectNoSensitiveFields(likeRes.body);

    await aliceAgent
      .get(`/posts/${postId}/likes`)
      .expect(200, { count: 1, likedByMe: true });

    await request(app.getHttpServer())
      .get(`/posts/${postId}/likes`)
      .expect(200, { count: 1, likedByMe: false });
  });

  it('comments on the post and lists the comment', async () => {
    const createRes = await aliceAgent
      .post(`/posts/${postId}/comments`)
      .send({ text: 'First!' })
      .expect(201);
    expectNoSensitiveFields(createRes.body);
    commentId = createRes.body.id;

    const listRes = await request(app.getHttpServer())
      .get(`/posts/${postId}/comments`)
      .expect(200);

    expectNoSensitiveFields(listRes.body);
    expect(listRes.body.total).toBe(1);
    expect(listRes.body.items[0]).toMatchObject({
      id: commentId,
      text: 'First!',
      author: { id: aliceId },
    });
  });

  it('registers a second user who follows the first', async () => {
    bobId = await register(bob);
    await confirmEmail(bobId);
    await login(bobAgent, bob);

    const res = await bobAgent.post(`/users/${aliceId}/follow`).expect(201);
    expectNoSensitiveFields(res.body);

    const followers = await request(app.getHttpServer())
      .get(`/users/${aliceId}/followers`)
      .expect(200);
    expectNoSensitiveFields(followers.body);
    expect(followers.body.map((u: User) => u.id)).toEqual([bobId]);
  });

  it("shows isFollowedByMe on the first user's profile for the follower", async () => {
    const res = await bobAgent.get(`/users/${aliceId}`).expect(200);

    expectNoSensitiveFields(res.body);
    expect(res.body).toMatchObject({
      id: aliceId,
      username: alice.username,
      followersCount: 1,
      followingCount: 0,
      isFollowedByMe: true,
    });

    const anonymous = await request(app.getHttpServer())
      .get(`/users/${aliceId}`)
      .expect(200);
    expect(anonymous.body.isFollowedByMe).toBe(false);
  });

  it('finds the first user by part of the username', async () => {
    const res = await request(app.getHttpServer())
      .get('/search/users')
      .query({ query: alice.username.slice(1, -1).toUpperCase() })
      .expect(200);

    expectNoSensitiveFields(res.body);
    expect(res.body.items.map((u: User) => u.id)).toContain(aliceId);
  });

  it("forbids deleting someone else's comment", async () => {
    const res = await bobAgent.delete(`/comments/${commentId}`).expect(403);

    expectErrorShape(res.body, 403, `/comments/${commentId}`);
  });

  it('deletes own post, after which it is gone', async () => {
    await aliceAgent.delete(`/posts/${postId}`).expect(204);

    const res = await request(app.getHttpServer())
      .get(`/posts/${postId}`)
      .expect(404);
    expectErrorShape(res.body, 404, `/posts/${postId}`);
    expect(res.body.message).toBe('Post not found');
  });
});
