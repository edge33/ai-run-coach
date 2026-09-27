import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';

export interface Config {
  databasePath: string;
  wikiPath: string;
  timezone: string;
  apiKey: string;
  athleteId: string;
  origins: string[];
  hosts: string[];
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const timezone = env.ATHLETE_TIMEZONE ?? 'Europe/Rome';
  new Intl.DateTimeFormat('en', { timeZone: timezone });
  const origins = (
    env.APP_ORIGINS ??
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001'
  )
    .split(',')
    .map((s) => new URL(s.trim()).origin);
  return {
    databasePath: resolve(root, env.SQLITE_PATH ?? 'data/db/coach.sqlite'),
    wikiPath: resolve(root, env.WIKI_PATH ?? 'athlete_wiki'),
    timezone,
    apiKey: env.INTERVALS_API_KEY ?? '',
    athleteId: env.INTERVALS_ATHLETE_ID ?? '0',
    origins,
    hosts: [...new Set(origins.map((origin) => new URL(origin).host))],
  };
}
export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: ['authorization', 'apiKey', 'req.headers.authorization'],
    base: undefined,
  },
  pino.destination(2),
);

export function isAllowedRequest(
  config: Config,
  host: string | undefined,
  origin: string | undefined,
): boolean {
  return (
    !!host &&
    config.hosts.includes(new URL(`http://${host}`).host) &&
    (!origin || config.origins.includes(origin))
  );
}
