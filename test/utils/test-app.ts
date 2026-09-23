import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Store } from 'express-session';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { setupApp } from '../../src/app.setup';
import { CSRF_HEADER_NAME } from '../../src/common/csrf/csrf';
import { User } from '../../src/entities/user.entity';
import { FilesService } from '../../src/modules/files/files.service';

export interface TestApp {
  app: NestExpressApplication;
  // Uploads never reach S3/disk: the validation pipe still runs for real,
  // only the storage step is mocked.
  filesServiceMock: {
    uploadManyPublicFiles: jest.Mock;
    deletePublicFile: jest.Mock;
  };
}

export interface CreateTestAppOptions {
  // Off by default: the suites send far more requests per minute from one
  // IP than the real limits allow. rate-limit/trust-proxy specs turn it on.
  throttling?: boolean;
  // Defaults to express-session's MemoryStore; pass a Redis store to test
  // what ends up in Redis.
  sessionStore?: Store;
}

// Boots the real AppModule with the same global setup as main.ts (minus
// Redis and Swagger) against an emptied e2e database. CSRF protection is
// always on.
//
// Create one app per test file: passport keeps session (de)serializers in a
// global list and always uses the first one registered, so a second app in
// the same file would deserialize sessions through the first, closed app.
export async function createTestApp({
  throttling = false,
  sessionStore,
}: CreateTestAppOptions = {}): Promise<TestApp> {
  const filesServiceMock = {
    uploadManyPublicFiles: jest.fn().mockResolvedValue([]),
    deletePublicFile: jest.fn().mockResolvedValue(undefined),
  };

  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(FilesService)
    .useValue(filesServiceMock);

  if (!throttling) {
    builder = builder
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true });
  }

  const moduleFixture = await builder.compile();

  const app = moduleFixture.createNestApplication<NestExpressApplication>({
    logger: ['error'],
  });
  setupApp(app, { sessionStore });
  await app.init();

  await app
    .get(DataSource)
    .query(
      'TRUNCATE "user", "profile", "post", "public_file", "comment", "like", "follow" CASCADE',
    );

  return { app, filesServiceMock };
}

// Fetches the session's CSRF token and makes the agent send it as
// X-CSRF-Token on every following request, like an SPA would. Call it
// after login: logging in regenerates the session and rotates the token.
export async function useCsrfToken(agent: TestAgent): Promise<string> {
  const res = await agent.get('/auth/csrf-token').expect(200);
  const token: string = res.body.csrfToken;
  agent.set(CSRF_HEADER_NAME, token);
  return token;
}

export async function loginWithCsrf(
  app: NestExpressApplication,
  username: string,
  password: string,
): Promise<TestAgent> {
  const agent = request.agent(app.getHttpServer());
  await agent.post('/auth/login').send({ username, password }).expect(200);
  await useCsrfToken(agent);
  return agent;
}

export const TEST_PASSWORD = 'password123';

// Registers a user through the API and marks the email as confirmed
// (the confirmation flow itself is covered by user-flow.e2e-spec.ts).
export async function createConfirmedUser(
  app: NestExpressApplication,
  username: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({
      username,
      email: `${username}@example.com`,
      password: TEST_PASSWORD,
    })
    .expect(201);

  const id: string = res.body.id;
  const users: Repository<User> = app.get(getRepositoryToken(User));
  await users.update(id, { isEmailConfirmed: true });
  return id;
}

export function expectErrorBody(
  res: request.Response,
  statusCode: number,
  message: string,
): void {
  expect(res.status).toBe(statusCode);
  expect(res.body).toMatchObject({
    statusCode,
    message,
    error: expect.any(String),
    timestamp: expect.any(String),
    path: expect.any(String),
  });
}

export function expectTooManyRequests(res: request.Response): void {
  expectErrorBody(res, 429, 'Забагато запитів, спробуйте пізніше');
  expect(res.body.error).toBe('Too Many Requests');
  expect(res.headers['retry-after']).toBeDefined();
}
