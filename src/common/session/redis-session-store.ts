import { RedisStore } from 'connect-redis';
import { createClient, RedisClientType } from 'redis';

export interface RedisSessionStore {
  store: RedisStore;
  client: RedisClientType;
}

export async function createRedisSessionStore(
  prefix: string,
): Promise<RedisSessionStore> {
  const client: RedisClientType = createClient({
    socket: {
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
    },
  });
  client.on('error', (err) => console.error('Redis Client Error', err));
  await client.connect();

  return { store: new RedisStore({ client, prefix }), client };
}
