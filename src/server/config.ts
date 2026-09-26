import path from 'path';
import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const int = (fallback: number, min = 0) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') return fallback;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min) {
        ctx.addIssue({ code: 'custom', message: `must be an integer >= ${min}` });
        return z.NEVER;
      }
      return n;
    });

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const isProduction = env.NODE_ENV === 'production';
  const isTest = env.NODE_ENV === 'test';

  const schema = z.object({
    PORT: int(3000, 1),
    HOST: z.string().default('0.0.0.0'),
    DATA_DIR: z.string().default(path.join(process.cwd(), 'data')),
    APP_URL: z.string().optional(),
    TRUST_PROXY: z.string().optional(),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default(isProduction ? 'info' : 'debug'),

    SESSION_TTL_HOURS: int(12, 1),
    COOKIE_SECURE: bool(isProduction),

    ADMIN_EMAIL: z.string().email().optional().or(z.literal('').transform(() => undefined)),
    ADMIN_PASSWORD: z.string().optional(),
    ADMIN_NAME: z.string().default('مدير النظام'),

    SEED_DEMO_DATA: bool(!isProduction),
    DEMO_USER_PASSWORD: z.string().default('Madar@Demo2026'),

    ENABLE_SQL_CONSOLE: bool(!isProduction),
    ALLOW_DB_RESET: bool(!isProduction),
    BACKUP_INTERVAL_HOURS: int(24, 0),
    BACKUP_RETENTION: int(20, 1),
    // Agency wire feeds (RSS/Atom) configured per news source.
    WIRE_POLL_MINUTES: int(5, 0),
    WIRE_RETENTION_DAYS: int(3, 1),
    WIRE_ALLOW_PRIVATE_HOSTS: bool(false),
    // Data retention (days; 0 keeps forever).
    TRASH_RETENTION_DAYS: int(30, 0),
    NOTIFICATION_RETENTION_DAYS: int(90, 0),
    LOG_RETENTION_DAYS: int(365, 0),
    AUDIT_LOG_RETENTION_DAYS: int(0, 0),

    RATE_LIMIT_PER_MINUTE: int(600, 10),
    LOGIN_RATE_LIMIT_PER_15MIN: int(20, 3),

    MEDIA_MAX_UPLOAD_MB: int(500, 1),

    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  });

  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  const c = parsed.data;

  if (c.ADMIN_PASSWORD && c.ADMIN_PASSWORD.length < 10) {
    throw new Error('ADMIN_PASSWORD must be at least 10 characters');
  }

  const geminiKey = c.GEMINI_API_KEY && c.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY' ? c.GEMINI_API_KEY : undefined;

  let trustProxy: boolean | number | string = false;
  if (c.TRUST_PROXY) {
    if (c.TRUST_PROXY === 'true') trustProxy = true;
    else if (c.TRUST_PROXY === 'false') trustProxy = false;
    else if (/^\d+$/.test(c.TRUST_PROXY)) trustProxy = Number(c.TRUST_PROXY);
    else trustProxy = c.TRUST_PROXY;
  }

  return {
    isProduction,
    isTest,
    port: c.PORT,
    host: c.HOST,
    dataDir: path.resolve(c.DATA_DIR),
    appUrl: c.APP_URL,
    trustProxy,
    logLevel: c.LOG_LEVEL,
    sessionTtlMs: c.SESSION_TTL_HOURS * 60 * 60 * 1000,
    cookieSecure: c.COOKIE_SECURE,
    admin: { email: c.ADMIN_EMAIL, password: c.ADMIN_PASSWORD, name: c.ADMIN_NAME },
    seedDemoData: c.SEED_DEMO_DATA,
    demoUserPassword: c.DEMO_USER_PASSWORD,
    enableSqlConsole: c.ENABLE_SQL_CONSOLE,
    allowDbReset: c.ALLOW_DB_RESET,
    backupIntervalHours: c.BACKUP_INTERVAL_HOURS,
    backupRetention: c.BACKUP_RETENTION,
    wires: {
      pollMinutes: c.WIRE_POLL_MINUTES,
      retentionDays: c.WIRE_RETENTION_DAYS,
      allowPrivateHosts: c.WIRE_ALLOW_PRIVATE_HOSTS,
    },
    retention: {
      trashDays: c.TRASH_RETENTION_DAYS,
      notificationDays: c.NOTIFICATION_RETENTION_DAYS,
      logDays: c.LOG_RETENTION_DAYS,
      auditLogDays: c.AUDIT_LOG_RETENTION_DAYS,
    },
    rateLimitPerMinute: c.RATE_LIMIT_PER_MINUTE,
    loginRateLimitPer15Min: c.LOGIN_RATE_LIMIT_PER_15MIN,
    mediaMaxUploadBytes: c.MEDIA_MAX_UPLOAD_MB * 1024 * 1024,
    gemini: { apiKey: geminiKey, model: c.GEMINI_MODEL },
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;
