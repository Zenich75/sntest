# Готово

**Дерево проекта:**
```
.
├── Dockerfile
├── docker-compose.yml
├── .env / .env.example
├── .gitignore
├── nest-cli.json, package.json, tsconfig*.json, eslint.config.mjs, .prettierrc
├── src/
│   ├── main.ts                    (ValidationPipe, CORS, Swagger /api/docs)
│   ├── app.module.ts              (ConfigModule global, TypeOrmModule)
│   ├── app.controller.ts / app.service.ts / *.spec.ts
│   ├── config/typeorm.config.ts
│   ├── common/{guards,decorators,pipes}/   (пустые, .gitkeep)
│   ├── entities/                  (пустая, .gitkeep)
│   └── modules/{auth,users,profile,posts,comments,likes,follow,search,files,mail}/  (пустые, .gitkeep)
└── test/app.e2e-spec.ts, jest-e2e.json
```

**Что сделано:**
1. Инициализирован Nest-проект (`sn-test` в `package.json`) через Nest CLI, npm.
2. Установлены все запрошенные зависимости и dev-зависимости.
3. Создана структура папок по ТЗ.
4. `.env.example` (пустой шаблон) и `.env` (postgres/redis хосты для docker-compose, AWS/Mail — `changeme`).
5. `ConfigModule.forRoot({ isGlobal: true })` в `app.module.ts`.
6. `src/config/typeorm.config.ts` — читает env через `process.env`, `autoLoadEntities: true`, `synchronize: true`.
7. `docker-compose.yml` — app + postgres:15-alpine + redis:7-alpine, volumes, порты 3000/5432/6379, `depends_on`.
8. `Dockerfile` — node:20-alpine, build + `start:prod`.
9. `main.ts` — ValidationPipe (whitelist, transform), CORS с credentials, Swagger на `/api/docs`, порт из `PORT` (по умолчанию 3000).
10. `.gitignore` (node_modules, dist, .env, *.log, IDE-файлы).
11. `npm run build` прошёл успешно; локальный запуск `dist/main.js` подтвердил корректный бутстрап (падает только на DNS `postgres`, что ожидаемо вне docker-compose).

**Важное отклонение от буквального запроса:** `npx @nestjs/cli@latest` сейчас указывает на Nest 12 с ESM + Vitest + oxlint по умолчанию — это плохо сочетается с express-session/passport-local/connect-redis (CommonJS-ориентированный стек). Я закрепил Nest CLI на v11, что дало привычный CommonJS + Jest + ESLint скелет, совместимый с остальным стеком. Также `@nestjs/swagger` установлен как `^11` (а не `latest`/`^12`), поскольку `^12` требует `@nestjs/core@^12`, что конфликтовало бы с Nest 11.

Docker-compose не поднимал, как и просили — только подготовил файлы.

---

# Этап 2: схема БД (entities + миграции)

**Созданные файлы миграций:**
```
src/migrations/1790083340831-InitSchema.ts
```

**Что сделано:**
1. Созданы 7 entities в `src/entities/` (uuid PK везде): `user.entity.ts`, `profile.entity.ts`,
   `public-file.entity.ts`, `post.entity.ts`, `comment.entity.ts`, `like.entity.ts`, `follow.entity.ts`
   — со всеми связями, `@Exclude()` на `password`/`emailConfirmationToken`, `@Unique(['user','post'])`
   на Like и `@Unique(['follower','following'])` на Follow, ровно как в ТЗ.
2. `src/config/data-source.ts` — отдельный `DataSource` для CLI-миграций (glob-пути к entities/migrations,
   `synchronize: false`), плюс `dotenv` добавлен как явная dev-зависимость (раньше был только транзитивным
   через `@nestjs/config`).
3. В `package.json` добавлены скрипты `typeorm`, `migration:generate`, `migration:run`, `migration:revert`.
4. `src/config/typeorm.config.ts` (рантайм): `synchronize: false`, `migrationsRun: false`,
   `autoLoadEntities: true` оставлен для удобства разработки; добавлен комментарий, что источник
   истины для схемы в проде — миграции.
5. Миграция `InitSchema` сгенерирована и прогнана (`migration:run`), затем проверена через
   `migration:revert` (чистый откат) и повторно применена — БД оставлена в состоянии "миграция применена".
6. `npm run build` — без ошибок.

**Итоговая схема (проверено через `\d` в psql):**
- `user` (id, username UNIQUE, email UNIQUE, password, isEmailConfirmed, emailConfirmationToken,
  createdAt, updatedAt)
- `profile` (id, firstName, lastName, bio, userId UNIQUE FK→user ON DELETE CASCADE,
  avatarId FK→public_file)
- `public_file` (id, key, url, mimeType, size, postId FK→post ON DELETE CASCADE)
- `post` (id, text, createdAt, updatedAt, authorId FK→user ON DELETE CASCADE)
- `comment` (id, text, createdAt, authorId FK→user ON DELETE CASCADE, postId FK→post ON DELETE CASCADE)
- `like` (id, createdAt, userId FK→user ON DELETE CASCADE, postId FK→post ON DELETE CASCADE,
  UNIQUE(userId, postId))
- `follow` (id, createdAt, followerId FK→user ON DELETE CASCADE, followingId FK→user ON DELETE CASCADE,
  UNIQUE(followerId, followingId))
- `migrations` (служебная таблица TypeORM)

**Отклонения / важные детали:**
- На хосте уже заняты порты 5432 и 6379 другим проектом (`brovafarmatest_postgres`/`redis`), поэтому
  `docker-compose.yml` поднять как есть не удалось. Вместо правки committed-файла поднял отдельный
  одноразовый контейнер `postgres:15-alpine` (`docker run`, порт 5433→5432, без изменений в репозитории)
  только для генерации/прогона миграции, затем удалил его. `docker-compose.yml` не менялся.
- `typeorm` в `package.json` резолвится в `1.1.1` (актуальный `latest` на момент сессии, а не привычный
  `0.3.x`) — официально поддерживается `@nestjs/typeorm@12` (`peerDependencies: typeorm ^0.3.0 || ^1.0.0-dev`),
  API decorators (`DataSource`, `Entity`, `Column`, отношения) не изменился, миграции сгенерировались
  и прогнались штатно.
- В `profile.entity.ts` и `user.entity.ts` пришлось добавить явный `type: 'varchar'` на nullable-колонки
  с типом `string | null` — TypeORM не может вывести тип из union через reflect-metadata (иначе падает
  с `DataTypeNotSupportedError: Object`).
- UUID PK используют `uuid_generate_v4()` — расширение `uuid-ossp` TypeORM ставит автоматически при
  подключении (`CREATE EXTENSION IF NOT EXISTS`), подтверждено в логах миграции.

---

# Этап 3: модуль авторизации (session + Passport local)

**Эндпоинты auth-модуля:**
- `POST /auth/register` — регистрация, создаёт User + вложенный Profile (cascade), шлёт письмо подтверждения
- `GET /auth/confirm-email?token=...` — подтверждение email по токену
- `POST /auth/login` — Passport `local` strategy, устанавливает сессионную куку `connect.sid`
- `POST /auth/logout` — уничтожает сессию, очищает куку

**Что сделано:**
1. `main.ts`: redis-клиент (`redis` пакет) подключается асинхронно до `app.listen`, оборачивается в
   `connect-redis` `RedisStore` с `prefix: 'sn-test:sess:'`; `express-session` с `resave:false,
   saveUninitialized:false`, cookie `httpOnly`, `maxAge` 7 дней, `secure` по `NODE_ENV`;
   `passport.initialize()`/`passport.session()` после session-мидлвара; `ClassSerializerInterceptor`
   подключён глобально (гарантирует, что `@Exclude()` на `password`/`emailConfirmationToken` в User
   реально работает в ответах); Swagger `DocumentBuilder.addCookieAuth('connect.sid')`.
2. `src/modules/mail/`: `MailService` — nodemailer-транспорт из `MAIL_HOST/PORT/USER/PASSWORD`; если
   `MAIL_HOST` пуст или равен `changeme` (dev-плейсхолдер), транспорт не создаётся и письмо просто
   логируется в консоль (`sendConfirmationEmail` не падает).
3. `src/modules/auth/`: `RegisterDto` (class-validator), `AuthService` (`register` — проверка
   username/email на дубликат → `ConflictException`, bcrypt-хэш пароля (10 раундов),
   `emailConfirmationToken` через `crypto.randomBytes(32).toString('hex')`, cascade-создание Profile;
   `confirmEmail` — `BadRequestException` при неверном токене; `validateUser` — bcrypt.compare),
   `LocalStrategy` (`usernameField: 'username'`, бросает `UnauthorizedException` если юзера нет или
   email не подтверждён), `SessionSerializer` (`serializeUser` → `user.id`, `deserializeUser` → поиск
   по репозиторию), `AuthController`, `AuthModule` (`TypeOrmModule.forFeature([User, Profile])`,
   `PassportModule.register({ session: true })`, `MailModule`).
4. `src/common/guards/session-auth.guard.ts` — `CanActivate` на `request.isAuthenticated()`, иначе
   `UnauthorizedException` (задел на след. этапы, ни один эндпоинт этого этапа его ещё не использует).
5. `src/common/decorators/current-user.decorator.ts` — `@CurrentUser()` достаёт `req.user`.
6. `AuthModule`/`MailModule` подключены в `app.module.ts`.
7. `.env`/`.env.example` — все нужные переменные (`SESSION_SECRET`, `CLIENT_URL`, `MAIL_*`) уже были
   с этапа 1, менять не пришлось.
8. `AUTH.md` — curl-примеры: регистрация, подтверждение email, логин (`curl -c cookies.txt`), логаут,
   пример запроса с курой (`curl -b cookies.txt`).
9. Полный ручной прогон через поднятый `docker-compose` (postgres+redis+app, миграции уже применены
   с этапа 2): `register` → токен подтверждения выловлен из консоли (`MAIL_HOST=changeme` → dev-fallback)
   → `confirm-email` (проверено в БД: `isEmailConfirmed=true`, `emailConfirmationToken=NULL`) → `login`
   (получен `Set-Cookie: connect.sid=...`, сессия с `passport.user=<id>` подтверждена в Redis по ключу
   `sn-test:sess:<sid>`) → `logout` (кука инвалидирована, старый ключ сессии в Redis удалён).
10. `npm run build` — без ошибок.

**Отклонения / найденные и исправленные баги:**
- `TypeOrmModuleOptions.autoLoadEntities` подхватывает только сущности, зарегистрированные через
  `TypeOrmModule.forFeature()` хоть в каком-то модуле. Пока модули posts/files/comments/likes/follow не
  реализованы, `PublicFile`/`Post`/`Comment`/`Like`/`Follow` нигде не регистрируются — приложение падало
  при старте (`Entity metadata for Profile#avatar was not found`). Исправлено явным glob-путём
  `entities: [join(__dirname, '../entities/*.entity{.ts,.js}')]` в `typeorm.config.ts` в дополнение к
  `autoLoadEntities: true`.
- `@nestjs/passport`'s `AuthGuard('local')` **не вызывает `req.logIn()` сам** — он только резолвит
  `req.user` через стратегию. Использованный "в лоб" `@UseGuards(AuthGuard('local'))` на `/auth/login`
  аутентифицировал пользователя, но не устанавливал сессию/куку (проверено: `Set-Cookie` отсутствовал в
  ответе). Исправлено добавлением `LocalAuthGuard extends AuthGuard('local')`
  (`src/modules/auth/strategies/local-auth.guard.ts`), который после `super.canActivate()` явно вызывает
  `super.logIn(request)` — стандартный паттерн для session-based Passport в NestJS.
- Логаут: `req.logout()` у passport 0.7 внутри регенерирует session id (защита от session fixation),
  поэтому в ответе на `/auth/logout` приходит два `Set-Cookie` — просроченный (от нашего явного
  `res.clearCookie`) и новый анонимный (от `express-session`, для уже пересозданной пустой сессии).
  Это штатное поведение passport/express-session, не баг: старая аутентифицированная сессия удаляется
  из Redis (подтверждено), повторно использовать прежнюю куку для авторизованного доступа нельзя.

---

# Этап 4: модуль загрузки файлов (Files)

**Эндпоинт:**
- `POST /files/upload` (временный, guard `SessionAuthGuard`, поле формы `files`, до 10 файлов) —
  вернёт на этапе Posts, пока используется для ручного тестирования.

**Что сделано:**
1. `src/modules/files/files.service.ts` — `FilesService` с двумя драйверами хранения
   (`STORAGE_DRIVER=s3|local`, дефолт `s3`):
   - `uploadPublicFile(file)` — ключ `${uuid}-${sanitized-original-name}` (пробелы/спецсимволы
     вырезаны), при `s3` — `PutObjectCommand` в `AWS_S3_BUCKET` + `url = ${CLOUDFRONT_DOMAIN}/${key}`;
     при `local` — пишет буфер в `./uploads/${key}` + `url = http://localhost:${PORT}/uploads/${key}`;
     в обоих случаях создаёт и сохраняет `PublicFile{key,url,mimeType,size}`.
   - `uploadManyPublicFiles(files)` — `Promise.all` по `uploadPublicFile`.
   - `deletePublicFile(id)` — если записи нет, тихо возвращается (идемпотентно); иначе удаляет объект
     (S3 `DeleteObjectCommand` либо `fs.unlink` для local) и запись из БД.
   - `TypeOrmModule.forFeature([PublicFile])`, `FilesService` экспортирован из `FilesModule`.
2. `src/common/pipes/file-size-validation.pipe.ts` — `IMAGE_MAX_SIZE` (2 МБ), `VIDEO_MAX_SIZE` (16 МБ),
   белые списки mimetype для картинок/видео; >10 файлов, превышение лимита размера или неизвестный
   mimetype → `BadRequestException` с украиноязычными сообщениями; пустой/`undefined` список — просто
   возвращается как есть (файлы у поста не обязательны).
3. Multer: `memoryStorage()` + `limits.fileSize = 16 МБ` передан прямо в опции `FilesInterceptor('files',
   10, {...})` в контроллере (без глобального `MulterModule.register`).
4. `FilesController` (временный) — `POST /files/upload`, `SessionAuthGuard` + `FilesInterceptor` +
   `@UploadedFiles(FileSizeValidationPipe)` → `filesService.uploadManyPublicFiles`.
5. `.env`/`.env.example` — добавлена `STORAGE_DRIVER` (в `.env` выставлено `local`, так как реального
   AWS-доступа у меня нет); `FILES.md` — буллет-пойнты по созданию S3-бакета + CloudFront distribution
   (приватный бакет, Origin Access Control, IAM-пользователь с правами на один бакет) и по
   `STORAGE_DRIVER=local` как fallback без AWS-аккаунта.
6. Добавлен `@nestjs/serve-static@^5` (не было в зависимостях) + `ServeStaticModule.forRoot({rootPath:
   './uploads', serveRoot: '/uploads'})` в `app.module.ts` — раздаёт файлы local-драйвера; при
   `STORAGE_DRIVER=s3` маршрут просто не используется. `/uploads` добавлен в `.gitignore`.
7. Ручной прогон (local-driver, через поднятый `docker-compose`, логин `johndoe` из этапа 3):
   - валидная загрузка 1 файла → `201`, `PublicFile` создан, файл на диске совпадает побайтово
     с оригиналом (`diff` чистый), `url` открывается и отдаёт тот же файл (`GET /uploads/<key>` → 200);
   - изображение 3 МБ (> лимита 2 МБ) → `400`, `"Файл \"big.jpg\" перевищує ліміт 2 МБ для зображень"`;
   - `application/pdf` → `400`, `"Непідтримуваний тип файлу"`;
   - ровно 10 файлов → `201`, все 10 сохранены; 11 файлов → `400` (см. отклонения ниже);
   - запрос без сессионной куки → `401`;
   - `npm run build` — без ошибок.

**Отклонения / найденные и исправленные баги:**
- `uploadManyPublicFiles(undefined)` падал с `500 TypeError: Cannot read properties of undefined
  (reading 'map')` — воспроизведено вручную (`POST /files/upload` совсем без файлов, что валидно:
  файлы у поста не обязательны). `FileSizeValidationPipe` по спеке возвращает `undefined`/`[]` как
  есть, но сервис не был готов это принять. Исправлено: `uploadManyPublicFiles` теперь возвращает `[]`
  при пустом/`undefined` входе.
- Лимит "больше 10 файлов" по факту падает на уровне multer (`FilesInterceptor('files', 10)` сам
  режет по `maxCount`) раньше, чем до кастомного пайпа доходит очередь — при 11 файлах приходит `400
  "Unexpected field - files"` от multer, а не украиноязычное сообщение из пайпа. Итоговый результат
  (400 при >10 файлов) соответствует требованию, но текст ошибки в этом конкретном сценарии — от
  multer, а не от `FileSizeValidationPipe` (проверка длины в пайпе фактически недостижима, пока
  interceptor и пайп используют один и тот же лимит — оставлено как defense-in-depth на случай, если
  лимиты разъедутся).
- Реального AWS-аккаунта нет, поэтому S3/CloudFront-путь протестирован только чтением кода и сборкой
  (`npm run build`), не живым вызовом — по факту гоняли `local`-драйвер.

---

# Этап 5: модуль Posts (посты)

⚠️ Присланное на этот этап ТЗ обрывается на середине фразы `GET /posts/user/:userId —`, а анонс
"посты, комментарии, лайки" в интро не сопровождался спецификацией для Comments и Likes (ни DTO, ни
методов сервиса, ни роутов). Сделал только Posts — он был specified почти полностью, оставшийся хвост
(`GET /posts/user/:userId`) и `DELETE /posts/:id` восстановил по описанной в `posts.service.ts`
логике (`findByUser`, `remove`). **Comments/Likes не трогал — нужен текст ТЗ по ним.**

**Эндпоинты:**
- `POST /posts` — `SessionAuthGuard`, `FilesInterceptor('files', 10)`, `@CurrentUser()`, создаёт пост
  (файлы через `filesService.uploadManyPublicFiles`, необязательны)
- `GET /posts` — глобальный фид, `createdAt DESC`, `?limit=&offset=` (по умолчанию 20/0, макс. 100)
- `GET /posts/user/:userId` — посты юзера, та же пагинация
- `GET /posts/:id` — публичный, детальный пост (relations: author+profile, files, comments+author, likes)
- `DELETE /posts/:id` — `SessionAuthGuard`, только автор (`ForbiddenException` иначе), удаляет файлы из
  S3/local через `filesService.deletePublicFile` для каждого файла, затем сам пост (comments/likes/
  оставшиеся public_file — через `ON DELETE CASCADE` в БД)

**Что сделано:**
1. `dto/create-post.dto.ts` — `text?` опционально, `@MaxLength(5000)`.
2. `dto/pagination-query.dto.ts` — `limit`/`offset` с `@Type(() => Number)` + `class-validator`
   (не было в явном ТЗ, но нужно для типобезопасной пагинации через `@Query()`).
3. `posts.service.ts` — `create`, `findOne` (`NotFoundException` если нет), `findByUser`, `findFeed`
   (реализован, как и предлагалось "по желанию"), `remove` (проверка владельца, явное удаление файлов,
   затем `postRepository.remove(post)`, опираясь на `ON DELETE CASCADE`).
4. `posts.controller.ts` — 5 роутов выше; `Post` (entity) переименован в `PostEntity` через `import {
   Post as PostEntity }`, т.к. имя конфликтует с HTTP-декоратором `@Post()` из `@nestjs/common`
   (сам декоратор импортирован как `HttpPost`).
5. `posts.module.ts` — `TypeOrmModule.forFeature([Post])` + импорт `FilesModule` (для `FilesService`),
   `PostsService` экспортирован.
6. Подключено в `app.module.ts`.
7. `npm run build` — без ошибок.

**Ручной прогон (docker-compose, local storage driver, `johndoe` из этапа 3):**
- пост без файлов → `201`, `password` автора не утёк, `files: []`;
- пост с картинкой → `201`, `PublicFile` создан и **корректно привязан** (`postId` в БД проставлен
  через cascade при `postRepository.save`), файл реально отдаётся по `url`;
- `GET /posts/:id` без куки (публичный) → полный объект с `author.profile`, `comments`, `likes`,
  пароль исключён даже во вложенном `author` (`ClassSerializerInterceptor` работает рекурсивно);
- `GET /posts/user/:userId?limit=1` → пагинация работает;
- `GET /posts?limit=5` → фид, `createdAt DESC`, оба поста в правильном порядке;
- удаление чужого поста (`janedoe` пытается удалить пост `johndoe`) → `403`;
- удаление своего поста → `204`, строка `post` удалена, строка `public_file` удалена, файл с диска
  удалён, повторный `GET /posts/:id` → `404`;
- `POST /posts` и `DELETE /posts/:id` без сессии → `401`.

**Отклонения / найденные и исправленные баги:**
- TypeORM 1.1.1 (см. этап 2) ужесточил типизацию `FindOneOptions.relations` /
  `FindManyOptions.relations` — старый синтаксис из ТЗ (`relations: ['author', 'author.profile', ...]`,
  строки с точечной нотацией) **не компилируется** (`TS2559`, ожидается `FindOptionsRelations<Entity>`).
  Переписал на вложенный объектный синтаксис: `{ author: { profile: true }, files: true, comments: {
  author: true }, likes: true }` — семантически то же самое, просто другая форма записи под TypeORM 1.x.

---

# Этап 6: модуль Follow (подписки)

⚠️ В присланном ТЗ упомянуто "Готовы: Auth, Files, Posts, Comments, Likes" — по факту Comments и Likes
**не реализованы** (`src/modules/comments/` и `src/modules/likes/` — пустые каталоги с `.gitkeep`, не
подключены в `app.module.ts`), это так и осталось с этапа 5, где ТЗ по ним не пришло. Follow от них не
зависит (нужны только `Follow`/`User` entities, уже готовы), поэтому выполнил этот этап как есть.

**Эндпоинты follow-модуля:**
- `POST /users/:id/follow` — `SessionAuthGuard`, подписаться
- `DELETE /users/:id/follow` — `SessionAuthGuard`, отписаться
- `GET /users/:id/followers` — публичный, список подписчиков (username + profile)
- `GET /users/:id/following` — публичный, список подписок (username + profile)

**Что сделано:**
1. `follow.service.ts` — `follow` (self-follow → `BadRequestException`, несуществующий таргет →
   `NotFoundException`, повторная подписка идемпотентна — возвращает существующую запись без дубля),
   `unfollow` (нет записи → `NotFoundException`), `getFollowers`/`getFollowing` (реализованы, п.1
   опционально) — оба через `followRepository.find` с `relations: { follower: { profile: true } }` /
   `{ following: { profile: true } }`, маппятся в список `User`.
2. `follow.controller.ts` — `@Controller('users')`, 4 роута выше.
3. `follow.module.ts` — `TypeOrmModule.forFeature([Follow, User])`, подключено в `app.module.ts`.
4. `npm run build` — без ошибок.

**Ручной прогон (docker-compose, `johndoe`/`janedoe` из предыдущих этапов):**
- `johndoe` подписывается на `janedoe` → `201`, запись создана;
- повторная подписка → тот же `id`/`createdAt`, в БД по-прежнему одна строка (`count(*) = 1`) — без
  дублей;
- подписка на самого себя → `400` `"Не можна підписатися на самого себе"`;
- подписка на несуществующего юзера (случайный uuid) → `404`;
- `GET /users/:id/followers` и `/following` (без сессии) → корректные списки с `username`+`profile`,
  пароль исключён;
- отписка → `204`, строка в `follow` удалена (`count(*) = 0`);
- повторная отписка → `404` `"Follow relationship not found"`;
- `POST /users/:id/follow` без сессии → `401`.

---

# Этап 7: модуль Search (поиск пользователей)

⚠️ ТЗ снова заявило "Готовы: ...Comments, Likes..." — по-прежнему не реализованы (см. этапы 5-6), Search
от них не зависит, так что не блокировало эту задачу.

**Эндпоинт:** `GET /search/users?query=&limit=&offset=` — публичный, `limit` default 10, `offset`
default 0.

**Что сделано:**
1. `search.service.ts` — `searchUsers(query, limit, offset)` через `QueryBuilder`:
   `leftJoinAndSelect('user.profile', 'profile')`, `where('user.username ILIKE :pattern')`,
   `orWhere('profile.firstName ILIKE :pattern')`, `orWhere('profile.lastName ILIKE :pattern')`,
   `take/skip`, `getManyAndCount()` → `{ items, total, limit, offset }`. Пустой/отсутствующий `query`
   (в т.ч. только пробелы) → `BadRequestException "Параметр query обов'язковий"`. `password`/
   `emailConfirmationToken` исключены — `getManyAndCount()` возвращает настоящие instances сущности
   `User`, `ClassSerializerInterceptor` отрабатывает как обычно.
2. `search.controller.ts` — `GET /search/users`, `@ApiQuery` на `query`/`limit`/`offset` для Swagger.
3. `search.module.ts` — `TypeOrmModule.forFeature([User])`, подключено в `app.module.ts`.
4. `npm run build` — без ошибок.

**Ручной прогон** (docker-compose; для теста дозарегистрировал ещё 3 юзеров: `johnsmith`/John Smith,
`alice99`/Alice Johnson, `bobby`/Bob Johnson — итого 5 юзеров в базе):
- `GET /search/users?query=john` → `4` совпадения: `johndoe`, `johnsmith` (по `username`/`firstName`),
  `alice99`, `bobby` (по `lastName` **"Johnson"**, который тоже содержит подстроку "john" — ожидаемое
  поведение при `OR`-поиске по трём полям, не баг);
  ```json
  {"items":[...4 юзера...],"total":4,"limit":10,"offset":0}
  ```
- `GET /search/users?query=john&limit=2&offset=0` → `total:4, limit:2, offset:0`,
  `["johndoe","alice99"]`; `?query=john&limit=2&offset=2` → те же `total:4`, `["johnsmith","bobby"]` —
  пагинация реально режет и не пересекается, `total` стабилен на обеих страницах;
- `GET /search/users?query=Smith` → `total:1`, `["johnsmith"]` — точечный поиск по фамилии работает;
- без `query`, с `query=` (пусто) и с `query=` из одних пробелов → во всех трёх случаях `400
  "Параметр query обов'язковий"`.

---

# Этап 8: Comments и Likes (полные модули)

⚠️ Четвёртое ТЗ подряд заявляет, что Comments/Likes уже готовы ("базовые create/remove для comments,
like/unlike для likes"). По факту на момент начала этапа это были пустые каталоги с `.gitkeep`, не
подключённые в `app.module.ts` (см. этапы 5-7). Раз "довески" из этого ТЗ (пагинация комментариев,
`getLikesInfo`) физически не на чем строить без базового CRUD — реализовал **оба модуля целиком**:
и "уже готовую" базовую часть (create/remove, like/unlike), и заказанные в этом ТЗ добавки
(`findByPost` с пагинацией, `getLikesInfo`). Роуты/DTO для базовой части нигде не были заданы явно —
взял за основу конвенции, уже устоявшиеся в Posts/Follow (`SessionAuthGuard` + `@CurrentUser()` на
мутациях, `ForbiddenException` при попытке удалить чужое, вложенные под `/posts/:postId/...` роуты).

**Эндпоинты:**
- `POST /posts/:postId/comments` — `SessionAuthGuard`, создать комментарий (`CreateCommentDto.text`,
  до 2000 символов — лимит не был задан в ТЗ, взял вдвое меньше, чем у постов)
- `GET /posts/:postId/comments?limit=&offset=` — публичный, `{ items, total, limit, offset }`,
  `createdAt ASC`, default `limit=20/offset=0` (переиспользован `PaginationQueryDto` из Posts)
- `DELETE /comments/:id` — `SessionAuthGuard`, только автор (иначе `403`)
- `POST /posts/:postId/likes` — `SessionAuthGuard`, лайкнуть (идемпотентно + race-safe, см. ниже)
- `DELETE /posts/:postId/likes` — `SessionAuthGuard`, убрать лайк (нет записи → `404`)
- `GET /posts/:postId/likes` — публичный (без гарда), `{ count, likedByMe }`; `likedByMe` берётся из
  `request.user` (Passport десериализует юзера из сессии на каждый запрос независимо от гарда), для
  анонимов — `false`

**Что сделано:**
1. `comments.service.ts` — `create` (404 если поста нет), `remove` (404/403), `findByPost` (404 если
   поста нет, `findAndCount` с `relations: { author: { profile: true } }`, `order: { createdAt: 'ASC'
   }`, `take/skip`).
2. `likes.service.ts` — `like` (404 если поста нет; идемпотентно — сначала `findOne` по паре
   `user+post`, если есть — вернуть её без вставки; **race-condition защита**: если два конкурентных
   запроса одновременно проходят проверку и оба пытаются `INSERT`, ловим Postgres unique-violation
   (`QueryFailedError`, `code === '23505'`) и просто возвращаем запись, которую вставил
   "победивший" запрос, вместо `500`), `unlike` (404 если записи нет), `getLikesInfo` (404 если поста
   нет; `count()` + опциональный `findOne` для `likedByMe`).
3. `PostsService.findOne` — добавлен TODO-комментарий над `POST_DETAIL_RELATIONS` (п.3 ТЗ): при
   большом числе комментариев переходить с eager `relations.comments` на отдельный пагинированный
   `GET /posts/:id/comments`; оставлено как есть для MVP.
4. `comments.module.ts` / `likes.module.ts` — `TypeOrmModule.forFeature([Comment/Like, Post])`,
   подключены в `app.module.ts`.
5. `npm run build` — без ошибок.

**Ручной прогон (docker-compose, `johndoe`/`janedoe`, отдельный тестовый пост):**
- `jane` и `john` комментируют пост → оба `201`, `GET /posts/:postId/comments` отдаёт их в
  `createdAt ASC` (jane первая, john вторая), `{"total":2,"limit":20,"offset":0}`;
  комментарий на несуществующий пост → `404 "Post not found"`;
- `GET /posts/:postId/likes` до лайков (аноним) → `{"count":0,"likedByMe":false}`; после лайка john'а
  → как john (с курой, без гарда) → `{"count":1,"likedByMe":true}`; аноним видит `{"count":1,
  "likedByMe":false}`; после лайка jane → `{"count":2,"likedByMe":false}` (для анонима);
- **race-condition тест**: 10 параллельных `POST /posts/:postId/likes` от john на один и тот же пост
  (`curl ... & ... wait`) → все 10 ответов `201` с **одинаковым** `id`, в БД ровно 1 строка лайка —
  ни дублей, ни `500`;
- `unlike` → `204`; повторный `unlike` → `404 "Like not found"`;
- `jane` пытается удалить комментарий `john` → `403`; `john` удаляет свой → `204`;
- **проверка каскада** (п.3 ТЗ): у поста было 1 comment + 2 likes, после `DELETE /posts/:id` — оба
  счётчика `0` в БД (`ON DELETE CASCADE` подтверждён вживую, а не только чтением entity-кода).

---

# Этап 9: модуль Profile (просмотр профиля)

Впервые за несколько этапов ТЗ верно описало текущее состояние проекта — Comments/Likes/Follow/Search
и правда были готовы к началу этого этапа.

**Эндпоинты:**
- `GET /users/:id` — публичный, `{ id, username, profile: { firstName, lastName, bio, avatar },
  followersCount, followingCount, isFollowedByMe }`
- `GET /users/:id/posts?limit=&offset=` — публичный, `{ items, total, limit, offset }`, `createdAt DESC`
  (default `limit=20/offset=0`, из переиспользованного `PaginationQueryDto`)

**Что сделано:**
1. `profile.service.ts` — `getProfile` (404 если юзера нет, `relations: { profile: { avatar: true } }`),
   `getUserPosts` (проверка существования юзера через `userRepository.exists()`, затем делегирует в
   `postsService.findByUser` — без дублирования пагинации/сортировки), `getFollowCounts` (два `count()`
   по `Follow` — реализовано, п.1 опционально), `isFollowedByCurrentUser` (soft-проверка по
   `currentUserId?`, аналогично `LikesService.getLikesInfo` — тоже реализовано).
2. `profile.controller.ts` — собирает трим-шейп профиля (`id`, `username`, только `firstName/lastName/
   bio/avatar` из `Profile`, счётчики, `isFollowedByMe`) **намеренно не возвращая сырую `User`-сущность
   целиком** — иначе в публичный профиль утекли бы `email`/`isEmailConfirmed`/`createdAt`/`updatedAt`,
   которые не помечены `@Exclude()` (это норм для ответов самому юзеру, но не для чужого профиля).
   `isFollowedByMe` берётся из `req.user?.id`, гарда на эндпоинте нет — паттерн один в один с
   `LikesController.getLikesInfo` с этапа 8.
3. **Рефакторинг `PostsService.findByUser`** (было нужно для честного переиспользования без дублей):
   раньше возвращал голый `Post[]` (через `.find()`), теперь — `{ items, total, limit, offset }` через
   `findAndCount()`, экспортирован тип `FindPostsResult`. `PostsController` (`GET /posts/user/:userId`)
   обновлён под новый тип. Точечное, осознанное изменение уже сданного в этапе 5 кода — по-другому
   `ProfileService.getUserPosts` пришлось бы либо дублировать подсчёт `total`, либо не отдавать его
   вовсе, а ТЗ явно просит `{ items, total, limit, offset }`.
4. `profile.module.ts` — `TypeOrmModule.forFeature([User, Follow])` **напрямую** (без импорта
   `FollowModule`) + `imports: [PostsModule]` (уже экспортирует `PostsService` с этапа 5). Циклической
   зависимости нет: `ProfileModule → PostsModule → FilesModule` (лист), `FollowModule` в граф вообще не
   входит — проверено загрузкой приложения (`Nest application successfully started` без ошибок DI).
5. Подключено в `app.module.ts`. `npm run build` — без ошибок.

**Ручной прогон (docker-compose):**
- `GET /users/:id` для `johndoe` → `firstName/lastName` на месте, `bio`/`avatar` — `null` (ещё не
  выставлены), `email`/`password`/`isEmailConfirmed` в ответе отсутствуют;
- `GET /users/:id` для случайного uuid → `404 "User not found"`;
- 4 поста `johndoe` → `GET /users/:id/posts?limit=2&offset=0` и `?limit=2&offset=2`: `total:4` стабилен
  на обеих страницах, `createdAt DESC`, без пересечений;
- `GET /users/:id/posts` для несуществующего юзера → `404`;
- **isFollowedByMe end-to-end**: `jane` подписывается на `john` → его профиль **от лица jane** (с
  курой) → `isFollowedByMe: true`, `followersCount: 1`; `jane` разлогинивается → тот же профиль (кука
  уже "пустая" анонимная сессия) → `isFollowedByMe: false`; запрос вовсе без куки → тоже `false`;
- заливка аватара через `/files/upload` + ручная простановка `bio`/`avatarId` в БД (эндпоинта
  редактирования профиля ещё нет — не требовался этим ТЗ) → `GET /users/:id` отдаёт `bio` и вложенный
  `avatar: { id, key, url, mimeType, size }` корректно.

**Инфраструктурная заминка (не связана с кодом):** к началу этапа `brovafarmatest_postgres`/`redis`
снова заняли 5432/6379 (кто-то поднял этот стек параллельно). Уточнил у пользователя — подтвердили
остановить `brovafarmatest` ещё раз. После остановки контейнеры `sn-test` (созданные 19 часов назад)
поднялись вообще без port-биндингов (`docker compose restart` не подтягивает актуальный `ports:` из
compose-файла для уже существующих контейнеров) — потребовался `docker compose up -d --force-recreate
postgres redis`, после чего порты встали на место; данные не потерялись (именованный volume пережил
recreate).

---

# Этап 10: сквозная проверка, Swagger, ошибки, e2e, README

**Swagger:** на всех эндпоинтах есть `@ApiOperation`, success-ответ с типом и `ApiErrorResponses(...)`
(`src/common/swagger`). Документируются только коды, которые эндпоинт реально может вернуть: у
публичных GET нет 401/403. У защищённых эндпоинтов стоит `@ApiCookieAuth()`. На сущностях
`@ApiProperty`, `password`/`emailConfirmationToken`/обратные коллекции скрыты через
`@ApiHideProperty`. Интерфейсы ответов (`FindPostsResult`, `FindCommentsResult`, `LikesInfo`,
`SearchUsersResult`, `PublicProfile`) стали классами в `dto/`. Появились `LoginDto` (раньше
у `/auth/login` в Swagger не было тела) и multipart-схемы у `POST /posts` и `/files/upload`.
Cookie-auth в Swagger UI проверена в браузере: логин из UI ставит httpOnly-куку `connect.sid`.

**Ошибки:** глобальный `AllExceptionsFilter` приводит всё к формату `{ statusCode, message, error,
timestamp, path }`. Для 500 стектрейс идёт только в лог, при `NODE_ENV=production` message
generic. Найденный баг: невалидный UUID в пути давал 500 (ошибка Postgres `22P02`), теперь
везде стоит `ParseUUIDPipe` → 400.

**Рефакторинг:** глобальная настройка вынесена из `main.ts` в `src/app.setup.ts` (`setupApp`), чтобы
e2e гонял те же pipes/serializer/filter/session. Swagger и Redis остались в `main.ts`.

**e2e:** `test/user-flow.e2e-spec.ts` (15 тестов) работает с отдельной БД `sn_test_e2e`
(`test/global-setup.ts` создаёт её и прогоняет миграции), MemoryStore вместо Redis, `FilesService`
замокан. Каждый ответ рекурсивно проверяется на `password`/`emailConfirmationToken`. Проверил
мутацией: без `@Exclude()` падают 12 тестов. Отклонение от ТЗ: удаление поста отдаёт `204`, а не
`200`, так было с этапа 5, тест ожидает `204`.
Грабли: `@nestjs/config|typeorm|passport` v12 и `uuid` v14 — ESM-only. Jest на Node 22 не может
их `require()` (нужен Node ≥ 24.9), поэтому `test/tsconfig.e2e.json` (commonjs + allowJs) +
`transformIgnorePatterns` + `test/esm-to-cjs.transformer.js` (вырезает единственный
`createRequire(import.meta.url)` в `@nestjs/typeorm`).

**Утечка email (по итогам этапа):** `email` и `isEmailConfirmed` раньше отдавались всем: во вложенном
`author`, у подписчиков, в поиске. Теперь это `@Expose({ groups: [OWN_ACCOUNT_GROUP] })`
(`src/common/serialization/groups.ts`), группу включает только `POST /auth/register` через
`@SerializeOptions`. e2e проверяет отсутствие этих полей во всех публичных ответах. Мутация:
без `@Expose` на `email` падают 8 тестов.

**Также:** unit-тест фильтра (`all-exceptions.filter.spec.ts`), README переписан, в eslint для тестов
отключены `no-unsafe-*` (supertest отдаёт `any`).

---

# Этап 11: исправления по аудиту ТЗ

Сверка ТЗ с кодом: п.3 (DELETE → 204) уже был выполнен, все 4 DELETE давно отдавали `204` без
тела; утверждение ТЗ о `200 { message }` не подтвердилось. П.9 (bio в ответе профиля) — тоже уже
работало, проблема из аудита была в отсутствии API *установки* bio, не в ответе. Оба пункта теперь
закреплены e2e-тестами. П.6 про «сырой стектрейс» — тоже не так: единый формат уже давал
`AllExceptionsFilter`, но Nest-овский `FilesInterceptor` сам превращал `MulterError` в 413 до фильтра.

1. **Поиск, экранирование:** `escapeLikePattern()` экранирует `\`, `%`, `_`, в SQL — `ILIKE ... ESCAPE '\'`.
2. **Поиск, сортировка:** `ORDER BY username ASC, id ASC`.
3. **DELETE:** без изменений кода (см. выше).
4. **FK аватара:** миграция `ProfileAvatarSetNull1790160342925` (`ON DELETE SET NULL`), применена к
   `sn_test`. До миграции удаление файла-аватара падало с FK violation (проверено в транзакции с откатом).
5. **`POST /files/upload` удалён** вместе с `FilesController` (`FilesModule` теперь только провайдер).
6. **Лимиты загрузки:** вместо `FilesInterceptor` — свой `FilesUploadInterceptor` (multer напрямую,
   потолки 20 МБ / 11 файлов только ради памяти), все `MulterError` → 400 с теми же формулировками,
   что у pipe. Реальные лимиты проверяет только `FileSizeValidationPipe`.
7. **Magic bytes:** `file-type` (`fileTypeFromBuffer`) в pipe, детект должен совпадать с `mimetype`.
   `file-type` и его 5 зависимостей — ESM-only, добавлены в `transformIgnorePatterns` e2e.
8. **`GET /users/by-username/:username`**. Грабля: `/users/by-username/followers` совпадал с
   `FollowController` `:id/followers` (400 от ParseUUIDPipe) — `ProfileModule` перенесён перед
   `FollowModule` в `app.module.ts` (Express берёт первый совпавший маршрут), закреплено тестом.
9. **bio:** уже возвращался, добавлен e2e.

Тесты: новый `test/hardening.e2e-spec.ts` (23 теста), общий `test/utils/test-app.ts`. Мутационная
проверка: откат экранирования (3 падения), magic bytes (2), порядка модулей (2), возврат
`FilesInterceptor` (5). Итого e2e 39/39, unit 4/4, lint чистый.

---

# Этап 12: коллизия роутов /users, file-type, Node 22

**Коллизия `/users/by-username/followers`:** ТЗ описывало её как открытую, но она была устранена ещё
на этапе 11 (порядок `ProfileModule` → `FollowModule` в `app.module.ts`; внутри `ProfileController`
`by-username/:username` объявлен до `:id`). Живая проверка до изменений: без такого юзера — `404
"User not found"` от `ProfileController` (не роутинговый 404 и не 400 от `ParseUUIDPipe`),
`/users/:id/followers` работает. Кодовых изменений не потребовалось; добавлен e2e: юзер `followers`
открывается по username, на него можно подписаться, `/users/:id/followers` и `/users/:id/following`
возвращают корректные списки. Живое демо — юзер `followers` временно создан в `sn_test` и удалён.

**file-type:** v22.1.1, ESM-only (с v17, не с v5, как в ТЗ). Подключён статическим `import`,
компилируется в `require()` — работает через `require(esm)` Node (без флага с 20.19 / 22.12), не
через динамический `import()`. В Jest — ts-jest + `transformIgnorePatterns` (этап 11). Обход
задокументирован в README («ESM-зависимости»).

**Node:** контейнер был на Node 20.20.2 — минимум для `require(esm)` выполнялся, но Node 20 EOL с
2026-04-30. `Dockerfile` → `node:22-alpine` (собрался, Node 22.23.1), в `package.json` добавлен
`engines.node: ">=22.12"`.

---

# Этап 13: rate limiting + CSRF

**Rate limiting:** `@nestjs/throttler` 6.7, `ThrottlerModule.forRoot` (default 60/60с), глобальный
`ThrottlerGuard` через `APP_GUARD` + `useExisting` (чтобы e2e могли его подменить). Точечно:
login 5/60с, register 3/60с, confirm-email 10/60с, POST и DELETE likes 20/10с
(`src/common/throttling/throttle-limits.ts`). 429 — через `AllExceptionsFilter`, сообщение
«Забагато запитів, спробуйте пізніше», плюс `Retry-After`. Важно: `@Throttle` *заменяет* дефолт на
роуте, поэтому лайки ограничены только 20/10с (до 120/мин) — задокументировано.
`TRUST_PROXY=true` → `app.set('trust proxy', 1)` в `setupApp`, трекер `req.ips[0]`
(`getClientTracker`). По умолчанию `false`; без флага `X-Forwarded-For` игнорируется (тест).

**CSRF:** double submit cookie + привязка к сессии. Токен (32 байта) в `req.session.csrfToken` и в
не-httpOnly куке `sn-test-csrf`; выдаётся на login (сессия регенерируется passport'ом → токен
ротируется) и `GET /auth/csrf-token`. Глобальный `CsrfGuard`: на POST/PUT/PATCH/DELETE при
залогиненной сессии заголовок `X-CSRF-Token` обязан совпасть и с кукой, и с сессией
(timing-safe), иначе 403 «Invalid CSRF token». Пропускаются safe-методы и запросы без
аутентифицированной сессии (register/login анонимно; защищённые роуты там дают 401). Logout при
залогиненной сессии тоже требует токен. Добавлен `cookie-parser`. Swagger: схема `csrf` (apiKey в
заголовке) и `@ApiCsrfProtected()` — одно требование `{cookie, csrf}` (И, а не ИЛИ).

**Найденный баг:** `SessionSerializer.deserializeUser` не передавал ошибку БД в `done()` — запрос с
сессионной кукой вис бы навсегда. Исправлено. Всплыло в тестах: passport держит сериализаторы в
глобальном списке, и второе Nest-приложение в том же jest-файле десериализовало сессии через первое
(уже закрытое). Отсюда правило — одно приложение на e2e-файл (комментарий в `createTestApp`).

**Тесты:** новые `csrf.e2e-spec.ts` (12), `rate-limit.e2e-spec.ts` (7, одно приложение, сброс
`ThrottlerStorage` перед каждым тестом), `trust-proxy.e2e-spec.ts` (2). В старых e2e троттлинг
выключен через override, CSRF включён: адаптированы только хелперы логина (`loginWithCsrf` /
`useCsrfToken` — токен ставится агенту как default-заголовок). Мутации: guard не отклоняет (6
падений), без привязки к сессии (1), без лимита логина (2), трекер по сокету (1), трекер по сырому
XFF (2). Итого e2e 61/61, unit 4/4.

**Дополнение к этапу 13:** `@nestjs/platform-express` 11.2.5 → 11.2.6. Закрывает 2 high-уязвимости
`npm audit` во вложенном multer 2.2.0: теперь multer один, 2.4.0 (дедуплицирован), `npm audit` —
0 уязвимостей. Вместе с ним подтянулись express 5.2.1 и path-to-regexp 8.4.2. Build, lint,
unit 4/4, e2e 61/61, docker build — зелёные. Остальные `@nestjs/*` остались на 11.2.5 (peer-deps
`^11.0.0` совместимы).

---

# Этап 14: сессия удалённого пользователя

**Сверка ТЗ:** «500 при осиротевшей сессии» не подтвердилось. Воспроизведено на живом контейнере
до изменений (юзер залогинен → удалён SQL-ом): `POST /posts` → 401, `GET likes` → 200
`likedByMe:false`. Passport (`strategies/session.js`) на любой falsy-результат десериализации сам
удаляет `passport.user` и пропускает запрос анонимным. Реальная проблема была другой: мёртвая сессия
оставалась в Redis как `{"passport":{},"csrfToken":…}`, и каждый запрос продлевал её TTL на 7 дней.

**Сделано:**
1. `deserializeUser` → `done(null, user ?? false)` (явный passport-идиом; поведение то же).
2. Middleware `clearOrphanedSession` сразу после `passport.session()` (а не в `SessionAuthGuard`,
   как предлагало ТЗ, — чтобы одинаково покрыть и защищённые, и soft-auth роуты). Признак сироты —
   ключ `passport` без `user` (его оставляет только passport после неудачной десериализации;
   logout пересоздаёт сессию без этого ключа). Действие — `session.regenerate()` (удаляет запись;
   в отличие от `destroy()`, `req.session` остаётся рабочим для csrf-token/login в том же запросе),
   сброс CSRF-куки, ошибка удаления — только warn.
3. Грабля express-session: регенерированную сессию он считает изменённой (сменился id) и
   сохраняет даже пустой — после первого варианта в Redis появлялась пустая сессия на 7 дней.
   Исправлено: `save` новой сессии пропускается, пока в неё ничего не записали (override через
   non-enumerable `defineProperty` — обычное присваивание само выглядело как «данные»).
4. `createRedisSessionStore()` вынесен из `main.ts` (переиспользуется в e2e).

**Тесты:** `orphaned-session.e2e-spec.ts` (5) на реальном Redis с префиксом `sn-test-e2e:sess:`:
401 и удаление ключа, soft-auth (likes, профиль) как гость + удаление ключа, в том же запросе
выдаётся рабочий CSRF-токен, пустая новая сессия не сохраняется, живые сессии не трогаются.
Мутации: без middleware — 4 падения, без `saveOnlyIfUsed` — 2. Итого e2e 66/66, unit 4/4.
