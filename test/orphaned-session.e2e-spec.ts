import { NestExpressApplication } from '@nestjs/platform-express';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import { Repository } from 'typeorm';
import {
  createRedisSessionStore,
  RedisSessionStore,
} from '../src/common/session/redis-session-store';
import { User } from '../src/entities/user.entity';
import {
  createConfirmedUser,
  createTestApp,
  loginWithCsrf,
  TEST_PASSWORD,
  useCsrfToken,
} from './utils/test-app';

const SESSION_PREFIX = 'sn-test-e2e:sess:';

// "connect.sid=s%3A<sid>.<signature>" → Redis key of that session.
function redisKeyOf(sessionCookie: string): string {
  const sid = decodeURIComponent(sessionCookie.split(';')[0].split('=')[1])
    .slice(2)
    .split('.')[0];
  return `${SESSION_PREFIX}${sid}`;
}

// Redis keys of any new session cookies the response hands out.
function newSessionKeys(res: request.Response): string[] {
  return ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .filter((c) => /^connect\.sid=s%3A/.test(c))
    .map(redisKeyOf);
}

interface OrphanedSession {
  cookie: string; // "connect.sid=…; sn-test-csrf=…", replayed as-is
  csrfToken: string;
  redisKey: string;
}

describe('Session of a deleted user (e2e)', () => {
  let app: NestExpressApplication;
  let redis: RedisSessionStore;
  let users: Repository<User>;
  let postId: string;
  let counter = 0;

  const redisHas = async (key: string) =>
    (await redis.client.exists(key)) === 1;

  // Sessions from this suite live under their own prefix, so they can be
  // wiped without touching dev sessions (sn-test:sess:*).
  async function deleteTestSessions(): Promise<void> {
    for await (const keys of redis.client.scanIterator({
      MATCH: `${SESSION_PREFIX}*`,
    })) {
      if (keys.length > 0) {
        await redis.client.del(keys);
      }
    }
  }

  // Logs a fresh user in, then deletes that user straight through the
  // TypeORM repository: the API has no DELETE /users/:id, and this is what
  // an admin tool or manual cleanup would do while the session lives on.
  async function orphanedSession(): Promise<OrphanedSession> {
    const username = `orphan_${counter++}`;
    const userId = await createConfirmedUser(app, username);

    const agent: TestAgent = request.agent(app.getHttpServer());
    const login = await agent
      .post('/auth/login')
      .send({ username, password: TEST_PASSWORD })
      .expect(200);
    const csrfToken = await useCsrfToken(agent);

    const sessionCookie = ([] as string[])
      .concat(login.headers['set-cookie'])
      .find((c) => c.startsWith('connect.sid='))!
      .split(';')[0];
    const redisKey = redisKeyOf(sessionCookie);
    expect(await redisHas(redisKey)).toBe(true);

    await users.delete(userId);

    return {
      cookie: `${sessionCookie}; sn-test-csrf=${csrfToken}`,
      csrfToken,
      redisKey,
    };
  }

  beforeAll(async () => {
    redis = await createRedisSessionStore(SESSION_PREFIX);
    await deleteTestSessions();
    ({ app } = await createTestApp({ sessionStore: redis.store }));
    users = app.get(getRepositoryToken(User));

    await createConfirmedUser(app, 'post_owner');
    const owner = await loginWithCsrf(app, 'post_owner', TEST_PASSWORD);
    postId = (await owner.post('/posts').send({ text: 'liked?' }).expect(201))
      .body.id;
  });

  afterAll(async () => {
    await app.close();
    await deleteTestSessions();
    await redis.client.quit();
  });

  it('answers a protected request with 401 (not 500) and deletes the session from Redis', async () => {
    const orphan = await orphanedSession();

    const res = await request(app.getHttpServer())
      .post('/posts')
      .set('Cookie', orphan.cookie)
      .set('X-CSRF-Token', orphan.csrfToken)
      .send({ text: 'from a deleted user' });

    expect(res.status).toBe(401);
    expect(await redisHas(orphan.redisKey)).toBe(false);

    // Its CSRF token died with it. express-session hands out a new session
    // id, but nothing is stored under it: no empty session with a 7-day TTL.
    const cookies = ([] as string[]).concat(res.headers['set-cookie']);
    expect(cookies).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^sn-test-csrf=;.*Expires=Thu, 01 Jan 1970/),
      ]),
    );
    for (const key of newSessionKeys(res)) {
      expect(await redisHas(key)).toBe(false);
    }

    // Replaying the same dead cookie afterwards is simply anonymous.
    await request(app.getHttpServer())
      .get(`/posts/${postId}/likes`)
      .set('Cookie', orphan.cookie)
      .expect(200, { count: 0, likedByMe: false });
  });

  it('treats the request as anonymous on soft-auth routes and cleans up there too', async () => {
    const orphan = await orphanedSession();

    const res = await request(app.getHttpServer())
      .get(`/posts/${postId}/likes`)
      .set('Cookie', orphan.cookie)
      .expect(200, { count: 0, likedByMe: false });
    expect(await redisHas(orphan.redisKey)).toBe(false);
    for (const key of newSessionKeys(res)) {
      expect(await redisHas(key)).toBe(false);
    }
  });

  it('shows a profile to it as to a guest', async () => {
    const orphan = await orphanedSession();
    const owner = await request(app.getHttpServer())
      .get('/users/by-username/post_owner')
      .set('Cookie', orphan.cookie)
      .expect(200);

    expect(owner.body.isFollowedByMe).toBe(false);
    expect(await redisHas(orphan.redisKey)).toBe(false);
  });

  it('still lets the client get a fresh CSRF token in that same request', async () => {
    const orphan = await orphanedSession();

    const res = await request(app.getHttpServer())
      .get('/auth/csrf-token')
      .set('Cookie', orphan.cookie)
      .expect(200);

    expect(res.body.csrfToken).not.toBe(orphan.csrfToken);
    expect(await redisHas(orphan.redisKey)).toBe(false);

    // This request did put data in the new session, so it is stored.
    const [newKey] = newSessionKeys(res);
    expect(newKey).toBeDefined();
    expect(await redisHas(newKey)).toBe(true);
  });

  it('leaves live sessions alone', async () => {
    await createConfirmedUser(app, 'alive');
    const agent = await loginWithCsrf(app, 'alive', TEST_PASSWORD);

    await agent.get(`/posts/${postId}/likes`).expect(200);
    await agent.post(`/posts/${postId}/likes`).expect(201);
    await agent
      .get(`/posts/${postId}/likes`)
      .expect(200, { count: 1, likedByMe: true });
  });
});
