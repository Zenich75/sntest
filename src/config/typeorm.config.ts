import { join } from 'path';
import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export default registerAs('typeorm', (): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  // Every entity is loaded up front via glob, regardless of whether its
  // feature module exists yet — otherwise entities only referenced by
  // relations (e.g. Profile -> PublicFile) fail metadata resolution
  // until their own module registers them via forFeature().
  entities: [join(__dirname, '../entities/*.entity{.ts,.js}')],
  // Schema changes are driven exclusively by migrations (src/migrations,
  // run via `npm run migration:run`) — this is the source of truth for
  // the schema in production. autoLoadEntities stays on purely for
  // convenience so new entities picked up via forFeature() elsewhere
  // don't need to be added here too.
  autoLoadEntities: true,
  synchronize: false,
  migrationsRun: false,
}));
