import { join } from 'path';
import { DataSource } from 'typeorm';
import { applyE2eEnv } from './e2e-env';

function connectionOptions(database: string) {
  return {
    type: 'postgres' as const,
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database,
  };
}

// Creates the e2e database on first run and brings its schema up to date
// with the same migrations production uses.
export default async function globalSetup(): Promise<void> {
  applyE2eEnv();
  const database = process.env.DB_NAME!;

  const admin = new DataSource(connectionOptions('postgres'));
  await admin.initialize();
  const existing: unknown[] = await admin.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [database],
  );
  if (existing.length === 0) {
    await admin.query(`CREATE DATABASE "${database}"`);
  }
  await admin.destroy();

  const dataSource = new DataSource({
    ...connectionOptions(database),
    entities: [join(__dirname, '../src/entities/*.entity.ts')],
    migrations: [join(__dirname, '../src/migrations/*.ts')],
  });
  await dataSource.initialize();
  await dataSource.runMigrations();
  await dataSource.destroy();
}
