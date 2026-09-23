import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { CSRF_HEADER_NAME } from './common/csrf/csrf';
import {
  COOKIE_SECURITY_NAME,
  CSRF_SECURITY_NAME,
} from './common/swagger/api-csrf-protected.decorator';
import { setupApp } from './app.setup';
import { createRedisSessionStore } from './common/session/redis-session-store';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const { store } = await createRedisSessionStore('sn-test:sess:');
  setupApp(app, { sessionStore: store });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('sn-test API')
    .setDescription(
      'REST API for the social network. Auth is session-based: call ' +
        'POST /auth/login from this page and the browser stores the ' +
        'httpOnly `connect.sid` cookie, which is then sent automatically ' +
        'with every "Try it out" request to protected endpoints. ' +
        'State-changing requests also need the X-CSRF-Token header: call ' +
        'GET /auth/csrf-token after logging in and paste the token into ' +
        'Authorize → csrf. Requests are rate-limited per IP (429).',
    )
    .setVersion('1.0')
    .addCookieAuth('connect.sid', undefined, COOKIE_SECURITY_NAME)
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: CSRF_HEADER_NAME,
        description: 'Token from GET /auth/csrf-token (rotates on login)',
      },
      CSRF_SECURITY_NAME,
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      withCredentials: true,
      persistAuthorization: true,
    },
  });

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap().catch((err) => {
  console.error('Failed to start the application', err);
  process.exit(1);
});
