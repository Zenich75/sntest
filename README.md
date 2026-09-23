# sn-test — REST API социальной сети

[![CI](https://github.com/Zenich75/sntest/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Zenich75/sntest/actions/workflows/ci.yml)

Бэкенд социальной сети на NestJS: регистрация с подтверждением email, сессионная авторизация,
посты с фото/видео, комментарии, лайки, подписки, поиск пользователей и публичные профили.

**Стек:** NestJS 11 · TypeORM + PostgreSQL 15 · Redis (сессии) · Passport (local) + express-session ·
AWS S3 + CloudFront (или локальное хранилище) · Swagger · Jest + supertest.

## Быстрый старт

Требуется Node.js ≥ 22.12 (см. «ESM-зависимости» ниже). Docker-образ собирается на `node:22-alpine`.

```bash
cp .env.example .env          # заполнить значения (см. ниже)
npm install
docker compose up -d          # app (порт 3000) + postgres (5432) + redis (6379)

# миграции запускаются с хоста, поэтому DB_HOST переопределяется на localhost
DB_HOST=localhost npm run migration:run
```

- API: http://localhost:3000
- Swagger UI: http://localhost:3000/api/docs (OpenAPI JSON: `/api/docs-json`)

Локально без Docker для приложения: поднять только `postgres` и `redis` через
`docker compose up -d postgres redis`, в `.env` выставить `DB_HOST=localhost`, `REDIS_HOST=localhost`,
затем `npm run start:dev`.

### Переменные окружения

| Переменная | Назначение |
|---|---|
| `PORT` | Порт HTTP-сервера (по умолчанию 3000) |
| `NODE_ENV` | `production` включает `secure`-куку и скрывает текст 500-ошибок |
| `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` | PostgreSQL |
| `REDIS_HOST`, `REDIS_PORT` | Redis — хранилище сессий |
| `SESSION_SECRET` | Секрет подписи сессионной куки |
| `STORAGE_DRIVER` | `s3` (по умолчанию) или `local` — файлы в `./uploads`, отдаются по `/uploads` |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`, `CLOUDFRONT_DOMAIN` | S3/CloudFront (только для `STORAGE_DRIVER=s3`) |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM` | SMTP. Если `MAIL_HOST` пуст или `changeme`, письма пишутся в лог приложения |
| `CLIENT_URL` | Origin фронтенда для CORS и ссылки подтверждения email |
| `TRUST_PROXY` | `true` только если приложение стоит за одним reverse-proxy (nginx/ALB). По умолчанию `false`, см. «Rate limiting» |

Настройка S3/CloudFront описана в [FILES.md](FILES.md), примеры curl для авторизации — в [AUTH.md](AUTH.md).

## Авторизация

Авторизация сессионная: `POST /auth/login` ставит httpOnly-куку `connect.sid`, сессия хранится в Redis.
Защищённые эндпоинты без сессии отвечают `401`. Войти можно только после подтверждения email:
ссылка приходит письмом (в dev-режиме её видно в логе, `docker compose logs app`).

**Работа из Swagger UI:** выполните `POST /auth/login` прямо на странице `/api/docs`. Браузер
сохранит куку, и все следующие запросы «Try it out» пойдут уже от имени этого пользователя.
Для мутирующих запросов нужен ещё CSRF-токен: вызовите `GET /auth/csrf-token`, нажмите
«Authorize» и вставьте токен в поле `csrf`. Поле `cookie` заполнять не нужно: браузер не даёт
странице самой выставить httpOnly-куку, но отправляет её автоматически.

**Сессия удалённого пользователя.** Если пользователя удалили, пока его сессия жива,
`SessionSerializer` возвращает `false`, и запрос обрабатывается как анонимный: защищённые
эндпоинты отвечают `401`, а `GET /posts/:postId/likes` и `GET /users/:id` показывают гостевой вид.
Middleware `clearOrphanedSession` (`src/common/session`) удаляет такую сессию из Redis и сбрасывает
CSRF-куку. Иначе passport сохранил бы её обратно с новым TTL на 7 дней.

### CSRF

Авторизация на cookie, поэтому любой сайт может заставить браузер пользователя отправить запрос
к API вместе с сессионной кукой. Защита построена по схеме «double submit cookie» с привязкой к
сессии (`src/common/csrf/csrf.ts`, `src/common/guards/csrf.guard.ts`):

1. При логине и при вызове `GET /auth/csrf-token` генерируется случайный токен (32 байта). Он
   сохраняется в сессии и отдаётся в не-httpOnly куке `sn-test-csrf` (`GET /auth/csrf-token`
   возвращает его ещё и в теле ответа).
2. Глобальный `CsrfGuard` пропускает `POST/PUT/PATCH/DELETE` при залогиненной сессии, только если
   заголовок `X-CSRF-Token` совпадает и с кукой, и с токеном в сессии. Иначе ответ
   `403 "Invalid CSRF token"`. Сравнение с сессией нужно на случай, когда атакующий может подложить
   свою куку (например, с соседнего поддомена).
3. Не проверяются `GET/HEAD/OPTIONS` и запросы без залогиненной сессии: у них нет сессионной куки,
   которой мог бы воспользоваться атакующий. Защищённые эндпоинты на такие запросы и так отвечают `401`.
4. При логине сессия пересоздаётся, поэтому токен тоже меняется.

Полный пример с curl есть в [AUTH.md](AUTH.md).

### Rate limiting

`@nestjs/throttler` с глобальным `ThrottlerGuard` считает запросы по IP клиента
(лимиты заданы в `src/common/throttling/throttle-limits.ts`). При превышении ответ
`429 "Забагато запитів, спробуйте пізніше"` в общем формате ошибок, с заголовком `Retry-After`.

| Эндпоинт | Лимит |
|---|---|
| все остальные | 60 запросов / 60 с |
| `POST /auth/login` (включая неудачные попытки) | 5 / 60 с |
| `POST /auth/register` | 3 / 60 с |
| `GET /auth/confirm-email` | 10 / 60 с |
| `POST /posts/:postId/likes`, `DELETE /posts/:postId/likes` | 20 / 10 с, у каждого метода свой счётчик |

Лимит на эндпоинте заменяет глобальный, а не добавляется к нему. Поэтому для лайков действует
только 20 / 10 с: всплески ограничены сильнее глобального лимита, а за минуту можно сделать до 120
запросов. Счётчики хранятся в памяти процесса, так что при нескольких инстансах каждый считает
отдельно. Для общего счётчика нужно подключить Redis-хранилище для throttler.

**За reverse-proxy** (nginx, ALB) все запросы приходят с IP прокси, и без дополнительной настройки
лимит был бы один на всех клиентов. `TRUST_PROXY=true` включает `app.set('trust proxy', 1)`
(`src/app.setup.ts`). Тогда IP клиента берётся из `X-Forwarded-For`, а именно из адреса, который
добавил последний прокси (`req.ips[0]`, см. `getClientTracker`). Это же нужно для `secure`-кук за
прокси, который терминирует TLS. Без прокси флаг включать нельзя: тогда любой клиент сможет
подставить свой `X-Forwarded-For` и обойти лимиты. Если прокси больше одного, число доверенных
хопов в `app.set('trust proxy', …)` нужно поменять.

## API

| Метод | Путь | Auth | Описание |
|---|---|---|---|
| POST | `/auth/register` | | Регистрация, отправка письма подтверждения |
| GET | `/auth/confirm-email?token=` | | Подтверждение email |
| POST | `/auth/login` | | Вход, ставит сессионную куку |
| POST | `/auth/logout` | | Выход |
| POST | `/posts` | ✔ | Создать пост: `text` и/или до 10 файлов (`multipart/form-data`, поле `files`) |
| GET | `/posts?limit=&offset=` | | Общая лента, новые сверху |
| GET | `/posts/:id` | | Пост с автором, файлами, комментариями и лайками |
| GET | `/posts/user/:userId` | | Посты пользователя (с пагинацией) |
| DELETE | `/posts/:id` | ✔ | Удалить свой пост (`204`), вместе с файлами, комментариями и лайками |
| POST | `/posts/:postId/comments` | ✔ | Добавить комментарий |
| GET | `/posts/:postId/comments` | | Комментарии поста, старые сверху |
| DELETE | `/comments/:id` | ✔ | Удалить свой комментарий (`204`, чужой: `403`) |
| POST / DELETE | `/posts/:postId/likes` | ✔ | Поставить / снять лайк |
| GET | `/posts/:postId/likes` | | `{ count, likedByMe }` |
| POST / DELETE | `/users/:id/follow` | ✔ | Подписаться / отписаться |
| GET | `/users/:id/followers`, `/users/:id/following` | | Подписчики / подписки |
| GET | `/users/:id` | | Профиль: `bio`, `avatar`, `followersCount`, `followingCount`, `isFollowedByMe` |
| GET | `/users/by-username/:username` | | Тот же профиль, поиск по username (точное совпадение) |
| GET | `/users/:id/posts` | | Посты пользователя |
| GET | `/search/users?query=&limit=&offset=` | | Поиск подстроки в username / имени / фамилии без учёта регистра. `%`, `_` и `\` ищутся буквально, сортировка по username |

Ограничения на файлы: не больше 10 на пост, изображения (jpeg/png/webp) до 2 МБ, видео
(mp4/mov/webm) до 16 МБ. Реальный тип определяется по содержимому файла (magic bytes) и должен
совпадать с заявленным `Content-Type`. Любое нарушение даёт `400`, подробности в [FILES.md](FILES.md).
Успешный `DELETE` везде отвечает `204` без тела.
Списки с пагинацией возвращают `{ items, total, limit, offset }`.

### Формат ошибок

Любая ошибка, включая ошибки валидации, неизвестные маршруты и битый JSON, возвращается в едином виде:

```json
{
  "statusCode": 404,
  "message": "Post not found",
  "error": "Not Found",
  "timestamp": "2026-09-23T10:20:30.445Z",
  "path": "/posts/3f2b8c1e-5a4d-4e8f-9b7a-1c2d3e4f5a6b"
}
```

При ошибках валидации `message` приходит массивом строк. Невалидный UUID в пути даёт `400`.
Неожиданные ошибки (`500`) пишутся в лог со стектрейсом. В ответ стектрейс не попадает никогда,
а при `NODE_ENV=production` вместо текста ошибки отдаётся `"Internal server error"`.

`password` и `emailConfirmationToken` исключаются из всех ответов, в том числе из вложенных
`author`/`user`/`follower`: на сущности стоит `@Exclude()`, а `ClassSerializerInterceptor`
подключён глобально. `email` и `isEmailConfirmed` видит только сам владелец аккаунта: они
помечены группой `ownAccount` (`@Expose({ groups })`), и включает её только `POST /auth/register`
через `@SerializeOptions`. Во всех публичных ответах этих полей нет.

## Тесты

```bash
npm test            # unit-тесты
npm run test:e2e    # e2e: нужны PostgreSQL и Redis (S3 не нужен)
npm run lint:check  # eslint без --fix (как в CI)
```

`test/hardening.e2e-spec.ts` проверяет поиск со спецсимволами и стабильность пагинации,
лимиты и подделку типа файлов, коды `DELETE`, обнуление аватара при удалении файла и профиль
по username.

e2e-тест `test/user-flow.e2e-spec.ts` проходит полный сценарий: регистрация → подтверждение
email → вход → пост → лайк → комментарий → подписка второго пользователя → профиль с
`isFollowedByMe` → поиск → `403` на удаление чужого комментария → удаление своего поста.
`test/csrf.e2e-spec.ts`, `test/rate-limit.e2e-spec.ts` и `test/trust-proxy.e2e-spec.ts` проверяют
CSRF и лимиты. В остальных e2e-тестах троттлинг отключён (иначе сотни запросов с одного IP упёрлись бы
в лимиты), а CSRF работает всегда: хелпер `loginWithCsrf` после логина получает токен и
подставляет его во все запросы агента.

Попутно каждый ответ проверяется на утечку `password`/`emailConfirmationToken`, а публичные ответы
ещё и на `email`/`isEmailConfirmed`.

- Тесты работают с отдельной базой `sn_test_e2e`. Её создаёт и мигрирует `test/global-setup.ts`,
  перед прогоном таблицы очищаются. Dev-база `sn_test` не затрагивается.
- Параметры подключения можно переопределить: `E2E_DB_HOST`, `E2E_DB_PORT`, `E2E_DB_NAME`
  (по умолчанию `localhost:5432/sn_test_e2e`, логин и пароль берутся из `.env`).
- Сессии хранятся в памяти (MemoryStore), кроме `orphaned-session.e2e-spec.ts`: этот тест
  проверяет записи в Redis под префиксом `sn-test-e2e:sess:` и подчищает их сам (адрес задают
  `E2E_REDIS_HOST`/`E2E_REDIS_PORT`, по умолчанию `localhost:6379`). `FilesService` замокан.

## ESM-зависимости

Проект компилируется в CommonJS, но часть зависимостей распространяется только как ES-модули:
`file-type` v22 и его зависимости (`strtok3`, `token-types`, `@tokenizer/inflate`,
`uint8array-extras`, `@borewit/text-codec`), `@nestjs/config`, `@nestjs/typeorm`, `@nestjs/passport` v12
и `uuid` v14. Динамический `import()` и откат на старые CJS-версии не используются.

- **Приложение.** Импорты обычные (`import { fileTypeFromBuffer } from 'file-type'`), TypeScript
  превращает их в `require()`. Загрузить ES-модуль через `require()` Node умеет сам, без флагов,
  начиная с 20.19 / 22.12. Отсюда `engines.node: ">=22.12"` в `package.json` и `node:22-alpine`
  в `Dockerfile`. На более старом Node приложение упадёт при старте с `ERR_REQUIRE_ESM`.
- **Jest (e2e).** Jest реализует `require` сам и умеет грузить ES-модули только на Node ≥ 24.9.
  Поэтому `test/jest-e2e.json` прогоняет эти пакеты через ts-jest с `module: commonjs`
  (`test/tsconfig.e2e.json`), а список пакетов перечислен в `transformIgnorePatterns`.
  `test/esm-to-cjs.transformer.js` дополнительно вырезает единственную конструкцию
  `createRequire(import.meta.url)` в `@nestjs/typeorm`.
- **Если после обновления зависимостей e2e падает с `Must use import to load ES Module: …/node_modules/<pkg>`**,
  значит, появилась новая ESM-only зависимость: добавьте `<pkg>` в `transformIgnorePatterns`.
  Незаметно это не сломается: `file-type` выполняется в e2e-тестах загрузки, и без трансформации
  такие тесты падают. После перехода на Node ≥ 24.9 весь этот обход можно удалить.

## CI/CD

GitHub Actions, файл `.github/workflows/ci.yml`. Запускается на push и pull request в `main`/`master`.

| Job | Зависит от | Что делает |
|---|---|---|
| `lint-and-build` | | `npm ci`, `npm run lint:check`, `npm run build` |
| `unit-tests` | lint-and-build | `npm test` |
| `e2e-tests` | lint-and-build | сервисы `postgres:15-alpine` + `redis:7-alpine` с healthcheck, `npm run migration:run`, `npm run test:e2e` |
| `docker-build` | lint-and-build | `docker build . -t sn-test:ci`, без публикации |

- Node 22, `npm ci` и кэш npm (`actions/setup-node`, `cache: npm`) по `package-lock.json`.
- В CI используется `lint:check`, а не `lint`: `npm run lint` запускается с `--fix`, так что в CI он
  молча исправил бы ошибки и прошёл.
- Секреты для CI не нужны. Все переменные в e2e-job тестовые и заданы прямо в workflow. AWS и SMTP
  в тестах не вызываются: `test/e2e-env.ts` включает локальное хранилище и отключает отправку
  писем, а `FilesService` подменён моком.
- `.dockerignore` не даёт попасть в образ `.env`, `node_modules` и `dist` с машины, где идёт сборка.

**Задел под деплой (пока не реализован).** Шаблон лежит в `.github/workflows/cd.yml.example`.
GitHub его не запускает, потому что расширение не `.yml`. Шаблон собирает образ по тегу `v*`,
публикует его в GHCR и содержит заглушку деплоя в AWS. Чтобы включить, переименуйте файл в `cd.yml`
и добавьте в Settings → Secrets and variables → Actions:

| Имя | Тип | Для чего |
|---|---|---|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | secret | деплой в AWS (ECS/EC2) |
| `AWS_REGION` | variable | регион деплоя |
| `DOCKER_REGISTRY_USER`, `DOCKER_REGISTRY_TOKEN` | secret | только для реестра не на GHCR (Docker Hub, ECR…) |
| `DOCKER_REGISTRY` | variable | адрес такого реестра |
| `SESSION_SECRET`, `DB_*`, `REDIS_*`, `MAIL_*`, `AWS_S3_BUCKET`, `CLOUDFRONT_DOMAIN` | secret | окружение продакшена, если его задаёт pipeline, а не платформа |

Для GHCR хватает встроенного `GITHUB_TOKEN`. Для environment `production` в настройках репозитория
стоит включить обязательное одобрение.

**Рекомендуемая защита ветки** (Settings → Branches → rule для `main`). В этой задаче правило не
настраивалось:
- запретить прямые push и разрешить merge только через pull request;
- включить «Require status checks to pass» с проверками `lint-and-build`, `unit-tests`,
  `e2e-tests` (и по желанию `docker-build`);
- включить «Require branches to be up to date before merging».

## Миграции

Схема меняется только миграциями (`synchronize: false`):

```bash
DB_HOST=localhost npm run migration:generate -- src/migrations/<Name>
DB_HOST=localhost npm run migration:run
DB_HOST=localhost npm run migration:revert
```

## Структура

```
src/
├── main.ts, app.setup.ts     # бутстрап; общая настройка pipes/serializer/filter/session
├── common/                   # guards, decorators, pipes, filters, interceptors, swagger-хелперы
├── entities/                 # TypeORM-сущности
├── migrations/
└── modules/                  # auth, mail, files, posts, comments, likes, follow, search, profile
test/                         # e2e-тесты и их окружение
```
