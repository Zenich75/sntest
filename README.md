# sn-test — social network REST API

[![CI](https://github.com/Zenich75/sntest/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Zenich75/sntest/actions/workflows/ci.yml)

A social network backend built with NestJS: sign-up with email confirmation, session-based auth,
posts with photos/videos, comments, likes, follows, user search and public profiles.

**Stack:** NestJS 11 · TypeORM + PostgreSQL 15 · Redis (sessions) · Passport (local) + express-session ·
AWS S3 + CloudFront (or local storage) · Swagger · Jest + supertest.

## Quick start

Requires Node.js ≥ 22.12 (see "ESM dependencies" below). The Docker image is built on `node:22-alpine`.

```bash
cp .env.example .env          # fill in the values (see below)
npm install
docker compose up -d          # app (3000) + postgres (5432) + redis (6379) + mailpit UI (8026)

# migrations run from the host, so DB_HOST is overridden to localhost
DB_HOST=localhost npm run migration:run
```

- API: http://localhost:3000
- Swagger UI: http://localhost:3000/api/docs (OpenAPI JSON: `/api/docs-json`)

To run the app locally without Docker: start only `postgres` and `redis` with
`docker compose up -d postgres redis`, set `DB_HOST=localhost` and `REDIS_HOST=localhost` in `.env`,
then run `npm run start:dev`.

### Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | HTTP server port (default 3000) |
| `NODE_ENV` | `production` enables `secure` cookies and hides the text of 500 errors |
| `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` | PostgreSQL |
| `REDIS_HOST`, `REDIS_PORT` | Redis, the session store |
| `SESSION_SECRET` | Secret used to sign the session cookie |
| `STORAGE_DRIVER` | `s3` (default) or `local`: files are saved to `./uploads` and served at `/uploads` |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`, `CLOUDFRONT_DOMAIN` | S3/CloudFront (only for `STORAGE_DRIVER=s3`) |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM` | SMTP. In dev, use the `mailpit` service: `MAIL_HOST=mailpit`, `MAIL_PORT=1025`, empty `MAIL_USER`, and read the emails at http://localhost:8026. If `MAIL_HOST` is empty or `changeme`, emails are written to the app log instead |
| `CLIENT_URL` | Frontend origin, used for CORS and the email confirmation link |
| `TRUST_PROXY` | `true` only when the app runs behind exactly one reverse proxy (nginx/ALB). Defaults to `false`, see "Rate limiting" |

S3/CloudFront setup is described in [FILES.md](FILES.md), curl examples for auth are in [AUTH.md](AUTH.md).

## Authentication

Auth is session-based: `POST /auth/login` sets the httpOnly `connect.sid` cookie, and the session is
stored in Redis. Protected endpoints answer `401` without a session. Login works only after the email
is confirmed: the link is sent by email (in dev it lands in Mailpit, http://localhost:8026, or in the
app log, `docker compose logs app`, when `MAIL_HOST` is not set).

**Using Swagger UI:** run `POST /auth/login` right on the `/api/docs` page. The browser keeps the
cookie, and every following "Try it out" request is made as that user. State-changing requests also
need a CSRF token: call `GET /auth/csrf-token`, click "Authorize" and paste the token into the `csrf`
field. Leave the `cookie` field empty: the browser won't let the page set an httpOnly cookie itself,
but it sends the cookie automatically.

**Session of a deleted user.** If a user is deleted while their session is still alive,
`SessionSerializer` returns `false` and the request is handled as anonymous: protected endpoints
answer `401`, while `GET /posts/:postId/likes` and `GET /users/:id` show the guest view. The
`clearOrphanedSession` middleware (`src/common/session`) removes such a session from Redis and clears
the CSRF cookie. Otherwise passport would save it back with a fresh 7-day TTL.

### CSRF

Auth is cookie-based, so any website can make the user's browser send a request to the API along
with the session cookie. The protection is a "double submit cookie" scheme bound to the session
(`src/common/csrf/csrf.ts`, `src/common/guards/csrf.guard.ts`):

1. On login and on `GET /auth/csrf-token`, a random token (32 bytes) is generated. It is stored in
   the session and sent in the non-httpOnly `sn-test-csrf` cookie (`GET /auth/csrf-token` also
   returns it in the response body).
2. The global `CsrfGuard` lets a `POST/PUT/PATCH/DELETE` through for a logged-in session only if the
   `X-CSRF-Token` header matches both the cookie and the token in the session. Otherwise the response
   is `403 "Invalid CSRF token"`. The session check covers the case where an attacker can plant their
   own cookie (for example, from a sibling subdomain).
3. `GET/HEAD/OPTIONS` requests and requests without a logged-in session are not checked: there is no
   session cookie for an attacker to ride on. Protected endpoints answer such requests with `401`
   anyway.
4. The session is regenerated on login, so the token changes too.

A full curl example is in [AUTH.md](AUTH.md).

### Rate limiting

`@nestjs/throttler` with a global `ThrottlerGuard` counts requests per client IP
(limits are defined in `src/common/throttling/throttle-limits.ts`). Over the limit the response is
`429 "Забагато запитів, спробуйте пізніше"` ("Too many requests, try again later") in the common error
format, with a `Retry-After` header.

| Endpoint | Limit |
|---|---|
| everything else | 60 requests / 60 s |
| `POST /auth/login` (failed attempts included) | 5 / 60 s |
| `POST /auth/register` | 3 / 60 s |
| `GET /auth/confirm-email` | 10 / 60 s |
| `POST /posts/:postId/likes`, `DELETE /posts/:postId/likes` | 20 / 10 s, a separate counter per method |

A per-endpoint limit replaces the global one rather than adding to it. So likes are limited only by
20 / 10 s: bursts are capped harder than by the global limit, but up to 120 requests per minute are
possible. Counters live in process memory, so with several instances each one counts on its own.
A shared counter needs a Redis storage for the throttler.

**Behind a reverse proxy** (nginx, ALB) all requests come from the proxy's IP, and without extra setup
all clients would share one limit. `TRUST_PROXY=true` enables `app.set('trust proxy', 1)`
(`src/app.setup.ts`). The client IP is then taken from `X-Forwarded-For`, namely the address added by
the last proxy (`req.ips[0]`, see `getClientTracker`). This is also needed for `secure` cookies behind
a TLS-terminating proxy. Do not enable the flag without a proxy: any client could then send its own
`X-Forwarded-For` and bypass the limits. With more than one proxy, change the number of trusted hops
in `app.set('trust proxy', …)`.

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | | Sign up, sends the confirmation email |
| GET | `/auth/confirm-email?token=` | | Confirm the email |
| POST | `/auth/login` | | Log in, sets the session cookie |
| POST | `/auth/logout` | | Log out |
| POST | `/posts` | ✔ | Create a post: `text` and/or up to 10 files (`multipart/form-data`, field `files`) |
| GET | `/posts?limit=&offset=` | | Global feed, newest first |
| GET | `/posts/:id` | | A post with its author, files, comments and likes |
| GET | `/posts/user/:userId` | | A user's posts (paginated) |
| DELETE | `/posts/:id` | ✔ | Delete your own post (`204`), along with its files, comments and likes |
| POST | `/posts/:postId/comments` | ✔ | Add a comment |
| GET | `/posts/:postId/comments` | | A post's comments, oldest first |
| DELETE | `/comments/:id` | ✔ | Delete your own comment (`204`; someone else's: `403`) |
| POST / DELETE | `/posts/:postId/likes` | ✔ | Like / unlike |
| GET | `/posts/:postId/likes` | | `{ count, likedByMe }` |
| POST / DELETE | `/users/:id/follow` | ✔ | Follow / unfollow |
| GET | `/users/:id/followers`, `/users/:id/following` | | Followers / following |
| GET | `/users/:id` | | Profile: `bio`, `avatar`, `followersCount`, `followingCount`, `isFollowedByMe` |
| GET | `/users/by-username/:username` | | The same profile, looked up by username (exact match) |
| GET | `/users/:id/posts` | | A user's posts |
| GET | `/search/users?query=&limit=&offset=` | | Case-insensitive substring search in username / first name / last name. `%`, `_` and `\` are matched literally, results are sorted by username |

File limits: at most 10 per post, images (jpeg/png/webp) up to 2 MB, videos (mp4/mov/webm) up to
16 MB. The real type is detected from the file contents (magic bytes) and must match the declared
`Content-Type`. Any violation gives `400`, details in [FILES.md](FILES.md).
A successful `DELETE` always answers `204` with no body.
Paginated lists return `{ items, total, limit, offset }`.

### Error format

Every error, including validation errors, unknown routes and malformed JSON, is returned in one shape:

```json
{
  "statusCode": 404,
  "message": "Post not found",
  "error": "Not Found",
  "timestamp": "2026-09-23T10:20:30.445Z",
  "path": "/posts/3f2b8c1e-5a4d-4e8f-9b7a-1c2d3e4f5a6b"
}
```

For validation errors `message` is an array of strings. An invalid UUID in the path gives `400`.
Unexpected errors (`500`) are logged with their stack trace. The stack trace never reaches the
response, and with `NODE_ENV=production` the error text is replaced with `"Internal server error"`.

`password` and `emailConfirmationToken` are excluded from every response, including nested
`author`/`user`/`follower` objects: the entity marks them with `@Exclude()`, and
`ClassSerializerInterceptor` is enabled globally. `email` and `isEmailConfirmed` are visible only to
the account owner: they belong to the `ownAccount` group (`@Expose({ groups })`), which only
`POST /auth/register` enables via `@SerializeOptions`. No public response contains these fields.

## Tests

```bash
npm test            # unit tests
npm run test:e2e    # e2e: needs PostgreSQL and Redis (no S3)
npm run lint:check  # eslint without --fix (as in CI)
```

`test/hardening.e2e-spec.ts` covers search with special characters and pagination stability, file
limits and spoofed file types, `DELETE` status codes, clearing the avatar when its file is deleted,
and the profile lookup by username.

The e2e test `test/user-flow.e2e-spec.ts` walks through the full scenario: sign-up → email
confirmation → login → post → like → comment → a second user follows the first → profile with
`isFollowedByMe` → search → `403` when deleting someone else's comment → deleting your own post.
`test/csrf.e2e-spec.ts`, `test/rate-limit.e2e-spec.ts` and `test/trust-proxy.e2e-spec.ts` cover CSRF
and rate limits. In the other e2e tests throttling is disabled (otherwise hundreds of requests from
one IP would hit the limits), while CSRF is always on: the `loginWithCsrf` helper fetches the token
after login and adds it to every request the agent makes.

Along the way, every response is checked for leaked `password`/`emailConfirmationToken`, and public
responses also for `email`/`isEmailConfirmed`.

- The tests use a separate `sn_test_e2e` database. `test/global-setup.ts` creates and migrates it,
  and the tables are emptied before each run. The `sn_test` dev database is never touched.
- Connection settings can be overridden with `E2E_DB_HOST`, `E2E_DB_PORT`, `E2E_DB_NAME`
  (default `localhost:5432/sn_test_e2e`; user and password come from `.env`).
- Sessions are kept in memory (MemoryStore), except in `orphaned-session.e2e-spec.ts`: that test
  checks Redis records under the `sn-test-e2e:sess:` prefix and cleans them up itself (address set by
  `E2E_REDIS_HOST`/`E2E_REDIS_PORT`, default `localhost:6379`). `FilesService` is mocked.

### Against the running stack

Two more checks run against the live `docker compose` stack and the dev `sn_test` database, with
nothing mocked. Real JPEG/PNG/WebP files from `scripts/fixtures` go through `FilesService` into
`./uploads`, and confirmation emails are read from Mailpit (see "Environment variables"). Registration
is limited to 3 requests per minute, so wait a minute between runs of either one.

```bash
docker compose up -d
scripts/smoke-flow.sh   # bash + curl + jq, 71 checks, deletes its two users on exit
npm run test:postman    # Postman collection via newman, see postman/README.md
```

- `scripts/smoke-flow.sh` checks uploaded files on disk, in `public_file` and via their URLs, then
  goes through comments, likes, follows and deletion with cascades. It needs `STORAGE_DRIVER=local`.
- `postman/sn-test.postman_collection.json` covers all 25 operations (81 requests, 200+ assertions)
  and also runs in the Postman app. Its `pm_*` users stay in the database, see
  [postman/README.md](postman/README.md).

## ESM dependencies

The project compiles to CommonJS, but some dependencies ship as ES modules only:
`file-type` v22 and its dependencies (`strtok3`, `token-types`, `@tokenizer/inflate`,
`uint8array-extras`, `@borewit/text-codec`), `@nestjs/config`, `@nestjs/typeorm`, `@nestjs/passport` v12
and `uuid` v14. Neither dynamic `import()` nor a downgrade to older CJS versions is used.

- **The app.** Imports are plain (`import { fileTypeFromBuffer } from 'file-type'`), and TypeScript
  turns them into `require()`. Node can load an ES module through `require()` natively, without flags,
  starting with 20.19 / 22.12. Hence `engines.node: ">=22.12"` in `package.json` and `node:22-alpine`
  in the `Dockerfile`. On an older Node the app crashes at startup with `ERR_REQUIRE_ESM`.
- **Jest (e2e).** Jest implements `require` itself and can load ES modules only on Node ≥ 24.9.
  So `test/jest-e2e.json` runs these packages through ts-jest with `module: commonjs`
  (`test/tsconfig.e2e.json`), and the packages are listed in `transformIgnorePatterns`.
  `test/esm-to-cjs.transformer.js` also strips the single `createRequire(import.meta.url)` construct
  in `@nestjs/typeorm`.
- **If after a dependency update e2e fails with `Must use import to load ES Module: …/node_modules/<pkg>`**,
  a new ESM-only dependency has appeared: add `<pkg>` to `transformIgnorePatterns`.
  This can't break silently: `file-type` runs in the upload e2e tests, and without the transform those
  tests fail. Once the project moves to Node ≥ 24.9, this whole workaround can be removed.

## CI/CD

GitHub Actions, file `.github/workflows/ci.yml`. Runs on push and pull request to `main`/`master`.

| Job | Depends on | What it does |
|---|---|---|
| `lint-and-build` | | `npm ci`, `npm run lint:check`, `npm run build` |
| `unit-tests` | lint-and-build | `npm test` |
| `e2e-tests` | lint-and-build | `postgres:15-alpine` + `redis:7-alpine` services with health checks, `npm run migration:run`, `npm run test:e2e` |
| `docker-build` | lint-and-build | `docker build . -t sn-test:ci`, nothing is published |

- Node 22, `npm ci` and the npm cache (`actions/setup-node`, `cache: npm`) keyed on `package-lock.json`.
- CI uses `lint:check` rather than `lint`: `npm run lint` runs with `--fix`, so in CI it would
  silently fix the errors and pass.
- CI needs no secrets. All variables in the e2e job are test values set directly in the workflow.
  AWS and SMTP are never called in the tests: `test/e2e-env.ts` switches to local storage and turns
  off email sending, and `FilesService` is replaced with a mock.
- `.dockerignore` keeps `.env`, `node_modules` and `dist` from the build machine out of the image.

**Groundwork for deployment (not implemented yet).** The template is in `.github/workflows/cd.yml.example`.
GitHub doesn't run it because the extension isn't `.yml`. The template builds an image on a `v*` tag,
publishes it to GHCR and contains a placeholder AWS deploy. To enable it, rename the file to `cd.yml`
and add the following under Settings → Secrets and variables → Actions:

| Name | Type | Used for |
|---|---|---|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | secret | deploying to AWS (ECS/EC2) |
| `AWS_REGION` | variable | deploy region |
| `DOCKER_REGISTRY_USER`, `DOCKER_REGISTRY_TOKEN` | secret | only for a registry other than GHCR (Docker Hub, ECR…) |
| `DOCKER_REGISTRY` | variable | address of that registry |
| `SESSION_SECRET`, `DB_*`, `REDIS_*`, `MAIL_*`, `AWS_S3_BUCKET`, `CLOUDFRONT_DOMAIN` | secret | production environment, if the pipeline sets it rather than the platform |

The built-in `GITHUB_TOKEN` is enough for GHCR. For the `production` environment, turn on required
reviewers in the repository settings.

**Recommended branch protection** (Settings → Branches → rule for `main`). The rule is not
configured automatically:
- block direct pushes and allow merging only through pull requests;
- enable "Require status checks to pass" with the `lint-and-build`, `unit-tests` and `e2e-tests`
  checks (and optionally `docker-build`);
- enable "Require branches to be up to date before merging".

## Migrations

The schema changes only through migrations (`synchronize: false`):

```bash
DB_HOST=localhost npm run migration:generate -- src/migrations/<Name>
DB_HOST=localhost npm run migration:run
DB_HOST=localhost npm run migration:revert
```

Database diagram: [dbdiagram.io](https://dbdiagram.io/d/sn-test-6ab4e70e586942561280b3f8)
(source: [`docs/schema.dbml`](docs/schema.dbml); update it together with new migrations).

## Structure

```
src/
├── main.ts, app.setup.ts     # bootstrap; shared pipes/serializer/filter/session setup
├── common/                   # guards, decorators, pipes, filters, interceptors, swagger helpers
├── entities/                 # TypeORM entities
├── migrations/
└── modules/                  # auth, mail, files, posts, comments, likes, follow, search, profile
test/                         # e2e tests and their environment
```
