import { NestExpressApplication } from '@nestjs/platform-express';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import { Repository } from 'typeorm';
import { Profile } from '../src/entities/profile.entity';
import { PublicFile } from '../src/entities/public-file.entity';
import { User } from '../src/entities/user.entity';
import { createTestApp, loginWithCsrf, TestApp } from './utils/test-app';

const MB = 1024 * 1024;

// Smallest buffers file-type recognizes, padded to the requested size.
function fixture(signature: number[], size = 64): Buffer {
  const buffer = Buffer.alloc(Math.max(size, signature.length));
  Buffer.from(signature).copy(buffer);
  return buffer;
}
const jpeg = (size?: number) =>
  fixture([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46], size);
const png = () =>
  fixture([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const mp4 = (size?: number) =>
  fixture([0, 0, 0, 0x18, ...Buffer.from('ftypisom'), 0, 0, 2, 0], size);
const windowsExe = () => fixture([0x4d, 0x5a, 0x90, 0x00]);

function expectBadRequest(res: request.Response, message: string): void {
  expect(res.status).toBe(400);
  expect(res.body).toEqual({
    statusCode: 400,
    message,
    error: 'Bad Request',
    timestamp: expect.any(String),
    path: '/posts',
  });
}

describe('Audit fixes (e2e)', () => {
  let app: NestExpressApplication;
  let filesServiceMock: TestApp['filesServiceMock'];
  let userRepository: Repository<User>;
  let profileRepository: Repository<Profile>;
  let publicFileRepository: Repository<PublicFile>;

  const suffix = Date.now().toString(36);
  let ownerAgent: TestAgent;
  let otherAgent: TestAgent;
  let ownerId: string;
  let otherId: string;

  async function register(username: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        username,
        email: `${suffix}.${Buffer.from(username).toString('hex')}@example.com`,
        password: 'password123',
      })
      .expect(201);
    return res.body.id;
  }

  // Email confirmation itself is covered by user-flow.e2e-spec.ts.
  async function registerAndLogin(
    username: string,
  ): Promise<[string, TestAgent]> {
    const id = await register(username);
    await userRepository.update(id, { isEmailConfirmed: true });

    return [id, await loginWithCsrf(app, username, 'password123')];
  }

  beforeAll(async () => {
    ({ app, filesServiceMock } = await createTestApp());
    userRepository = app.get(getRepositoryToken(User));
    profileRepository = app.get(getRepositoryToken(Profile));
    publicFileRepository = app.get(getRepositoryToken(PublicFile));

    [ownerId, ownerAgent] = await registerAndLogin(`owner_${suffix}`);
    [otherId, otherAgent] = await registerAndLogin(`other_${suffix}`);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('search', () => {
    const search = (query: string, limit = 100, offset = 0) =>
      request(app.getHttpServer())
        .get('/search/users')
        .query({ query, limit, offset })
        .expect(200);

    const usernames = (res: request.Response): string[] =>
      res.body.items.map((u: User) => u.username);

    beforeAll(async () => {
      for (const username of [
        `pct50%a${suffix}`,
        `pct50ba${suffix}`,
        `us_a_b${suffix}`,
        `us_axb${suffix}`,
        `bs_k\\s${suffix}`,
        `bs_ks${suffix}`,
      ]) {
        await register(username);
      }
    });

    it('treats "%" literally', async () => {
      expect(usernames(await search('50%'))).toEqual([`pct50%a${suffix}`]);
    });

    it('treats "_" literally', async () => {
      expect(usernames(await search('a_b'))).toEqual([`us_a_b${suffix}`]);
    });

    it('treats "\\" literally', async () => {
      expect(usernames(await search('k\\s'))).toEqual([`bs_k\\s${suffix}`]);
    });

    it('pages through a stable order without duplicates or gaps', async () => {
      const all = await search(suffix);
      const total: number = all.body.total;
      expect(total).toBe(8);

      const collectPages = async (): Promise<string[]> => {
        const pages: string[] = [];
        for (let offset = 0; offset < total; offset++) {
          pages.push(...usernames(await search(suffix, 1, offset)));
        }
        return pages;
      };

      const firstRun = await collectPages();
      const secondRun = await collectPages();

      expect(firstRun).toEqual(usernames(all));
      expect(secondRun).toEqual(firstRun);
      expect(new Set(firstRun).size).toBe(total);
    });
  });

  describe('uploads (POST /posts multipart)', () => {
    const createPost = () =>
      ownerAgent.post('/posts').field('text', 'with files');

    beforeEach(() => filesServiceMock.uploadManyPublicFiles.mockClear());

    it('accepts real images and videos within limits', async () => {
      await createPost()
        .attach('files', jpeg(), {
          filename: 'a.jpg',
          contentType: 'image/jpeg',
        })
        .attach('files', mp4(), { filename: 'b.mp4', contentType: 'video/mp4' })
        .expect(201);

      const [files] = filesServiceMock.uploadManyPublicFiles.mock.calls[0];
      expect(files).toHaveLength(2);
    });

    it.each([11, 12])('rejects %i files with a clean 400', async (count) => {
      let req = createPost();
      for (let i = 0; i < count; i++) {
        req = req.attach('files', jpeg(), {
          filename: `${i}.jpg`,
          contentType: 'image/jpeg',
        });
      }

      expectBadRequest(await req, 'Максимум 10 файлів на пост');
      expect(filesServiceMock.uploadManyPublicFiles).not.toHaveBeenCalled();
    });

    it('rejects an image over 2 MB', async () => {
      const res = await createPost().attach('files', jpeg(2 * MB + 1), {
        filename: 'big.jpg',
        contentType: 'image/jpeg',
      });
      expectBadRequest(
        res,
        'Файл "big.jpg" перевищує ліміт 2 МБ для зображень',
      );
    });

    it('rejects a 17 MB video with 400, not 413', async () => {
      const res = await createPost().attach('files', mp4(17 * MB), {
        filename: 'big.mp4',
        contentType: 'video/mp4',
      });
      expectBadRequest(res, 'Файл "big.mp4" перевищує ліміт 16 МБ для відео');
    });

    it("rejects a file over multer's hard ceiling with the same 400 format", async () => {
      const res = await createPost().attach('files', mp4(21 * MB), {
        filename: 'huge.mp4',
        contentType: 'video/mp4',
      });
      expectBadRequest(
        res,
        'Файл перевищує ліміт: 2 МБ для зображень, 16 МБ для відео',
      );
    });

    it('rejects an .exe disguised as image/jpeg', async () => {
      const res = await createPost().attach('files', windowsExe(), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      });
      expectBadRequest(res, 'Файл "photo.jpg" не відповідає заявленому типу');
    });

    it('rejects content of a different allowed type than declared', async () => {
      const res = await createPost().attach('files', png(), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      });
      expectBadRequest(res, 'Файл "photo.jpg" не відповідає заявленому типу');
    });

    it('rejects an unsupported declared type', async () => {
      const res = await createPost().attach('files', windowsExe(), {
        filename: 'setup.exe',
        contentType: 'application/x-msdownload',
      });
      expectBadRequest(res, 'Непідтримуваний тип файлу');
    });

    it('rejects files sent under the wrong form field', async () => {
      const res = await createPost().attach('attachments', jpeg(), {
        filename: 'a.jpg',
        contentType: 'image/jpeg',
      });
      expectBadRequest(res, 'Файли потрібно передавати в полі "files"');
    });
  });

  describe('DELETE endpoints', () => {
    it('all answer 204 with an empty body', async () => {
      const post = await ownerAgent
        .post('/posts')
        .send({ text: 'to be deleted' })
        .expect(201);
      const postId: string = post.body.id;
      const comment = await ownerAgent
        .post(`/posts/${postId}/comments`)
        .send({ text: 'bye' })
        .expect(201);
      await ownerAgent.post(`/posts/${postId}/likes`).expect(201);
      await otherAgent.post(`/users/${ownerId}/follow`).expect(201);

      const responses = [
        await ownerAgent.delete(`/comments/${comment.body.id}`),
        await ownerAgent.delete(`/posts/${postId}/likes`),
        await otherAgent.delete(`/users/${ownerId}/follow`),
        await ownerAgent.delete(`/posts/${postId}`),
      ];

      for (const res of responses) {
        expect(res.status).toBe(204);
        expect(res.text).toBe('');
      }
    });
  });

  describe('profile', () => {
    it('returns bio and avatar, and clears the avatar when its file is deleted', async () => {
      const avatar = await publicFileRepository.save({
        key: 'avatar.jpg',
        url: 'http://localhost/uploads/avatar.jpg',
        mimeType: 'image/jpeg',
        size: 64,
      });
      // There is no profile-edit endpoint yet, so bio/avatar are set directly.
      await profileRepository.update(
        { user: { id: ownerId } },
        { bio: 'Hello, I am the owner', avatar },
      );

      const before = await request(app.getHttpServer())
        .get(`/users/${ownerId}`)
        .expect(200);
      expect(before.body.profile).toMatchObject({
        bio: 'Hello, I am the owner',
        avatar: { id: avatar.id, url: avatar.url },
      });

      // ON DELETE SET NULL: removing the file must not fail on the FK.
      await publicFileRepository.delete(avatar.id);

      const after = await request(app.getHttpServer())
        .get(`/users/${ownerId}`)
        .expect(200);
      expect(after.body.profile.avatar).toBeNull();
      expect(after.body.profile.bio).toBe('Hello, I am the owner');
    });

    it('is available by username', async () => {
      const res = await otherAgent
        .get(`/users/by-username/owner_${suffix}`)
        .expect(200);

      expect(res.body).toMatchObject({
        id: ownerId,
        username: `owner_${suffix}`,
        profile: { bio: 'Hello, I am the owner' },
      });
      expect(res.body).not.toHaveProperty('email');
    });

    it('returns 404 for an unknown username', async () => {
      await request(app.getHttpServer())
        .get('/users/by-username/nobody_here')
        .expect(404);
    });

    it.each(['followers', 'following', 'posts'])(
      'resolves a user literally named "%s" (no clash with /users/:id/* routes)',
      async (username) => {
        const id = await register(username);

        const res = await request(app.getHttpServer())
          .get(`/users/by-username/${username}`)
          .expect(200);
        expect(res.body.id).toBe(id);
      },
    );

    it('keeps GET /users/:id working alongside', async () => {
      const res = await request(app.getHttpServer())
        .get(`/users/${otherId}`)
        .expect(200);
      expect(res.body.username).toBe(`other_${suffix}`);
    });

    it('keeps GET /users/:id/followers and /following working, even for a user named "followers"', async () => {
      const followersUser = await request(app.getHttpServer())
        .get('/users/by-username/followers')
        .expect(200);
      const followersUserId: string = followersUser.body.id;

      await otherAgent.post(`/users/${followersUserId}/follow`).expect(201);

      const followers = await request(app.getHttpServer())
        .get(`/users/${followersUserId}/followers`)
        .expect(200);
      expect(followers.body.map((u: User) => u.id)).toEqual([otherId]);

      const following = await request(app.getHttpServer())
        .get(`/users/${otherId}/following`)
        .expect(200);
      expect(following.body.map((u: User) => u.username)).toEqual([
        'followers',
      ]);
    });
  });

  it('no longer exposes POST /files/upload', async () => {
    await ownerAgent
      .post('/files/upload')
      .attach('files', jpeg(), { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(404);
  });
});
