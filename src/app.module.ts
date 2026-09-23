import { join } from 'path';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import typeormConfig from './config/typeorm.config';
import { CsrfGuard } from './common/guards/csrf.guard';
import {
  getClientTracker,
  THROTTLE_ERROR_MESSAGE,
  THROTTLE_LIMITS,
} from './common/throttling/throttle-limits';
import { AuthModule } from './modules/auth/auth.module';
import { MailModule } from './modules/mail/mail.module';
import { FilesModule } from './modules/files/files.module';
import { PostsModule } from './modules/posts/posts.module';
import { FollowModule } from './modules/follow/follow.module';
import { SearchModule } from './modules/search/search.module';
import { CommentsModule } from './modules/comments/comments.module';
import { LikesModule } from './modules/likes/likes.module';
import { ProfileModule } from './modules/profile/profile.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [typeormConfig],
    }),
    TypeOrmModule.forRootAsync({
      inject: [typeormConfig.KEY],
      useFactory: (config: ReturnType<typeof typeormConfig>) => config,
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ...THROTTLE_LIMITS.default }],
      errorMessage: THROTTLE_ERROR_MESSAGE,
      getTracker: getClientTracker,
    }),
    // Serves files saved by FilesService's local storage driver
    // (STORAGE_DRIVER=local) — unused/no-op when the S3 driver is active.
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
    AuthModule,
    MailModule,
    FilesModule,
    PostsModule,
    // Must be registered before FollowModule: both own /users/* routes, and
    // Express picks the first match, so GET /users/by-username/followers has
    // to hit ProfileController rather than FollowController's :id/followers.
    ProfileModule,
    FollowModule,
    SearchModule,
    CommentsModule,
    LikesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global guards, run in this order before any route guard. Registered
    // as named providers (useExisting) so e2e tests can override them.
    ThrottlerGuard,
    CsrfGuard,
    { provide: APP_GUARD, useExisting: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: CsrfGuard },
  ],
})
export class AppModule {}
