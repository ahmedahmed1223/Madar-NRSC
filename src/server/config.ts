import path from 'path';
import { z } from 'zod';

export const AI_PROVIDERS = ['gemini', 'openai', 'openrouter'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

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
    // A temporary password issued by an administrator stops working after this many hours.
    TEMP_PASSWORD_HOURS: int(72, 1),
    COOKIE_SECURE: bool(isProduction),

    ADMIN_EMAIL: z.string().email().optional().or(z.literal('').transform(() => undefined)),
    ADMIN_PASSWORD: z.string().optional(),
    ADMIN_NAME: z.string().default('مدير النظام'),

    SEED_DEMO_DATA: bool(!isProduction),
    DEMO_USER_PASSWORD: z.string().default('Madar@Demo2026'),
    // Demo accounts share one published password: production refuses them unless this is set on purpose.
    ALLOW_DEMO_IN_PRODUCTION: bool(false),

    ENABLE_SQL_CONSOLE: bool(!isProduction),
    ALLOW_DB_RESET: bool(!isProduction),
    BACKUP_INTERVAL_HOURS: int(24, 0),
    BACKUP_RETENTION: int(20, 1),
    BACKUP_DIRECTORY: z.string().optional(),
    BACKUP_REMOTE: z.string().optional(),
    // Finished news untouched for this many days leaves the synced newsroom (0 = sync everything).
    NEWS_ACTIVE_DAYS: int(90, 0),
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
    // Copying library files to Dropbox / Google Drive / the shared folder (seconds; 0 disables).
    STORAGE_SYNC_SECONDS: int(20, 0),

    // Outgoing e-mail for notifications (leave SMTP_HOST empty to disable e-mail).
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: int(587, 1),
    SMTP_SECURE: bool(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().optional(),
    // Web Push (VAPID). Generated and stored in the database when not provided.
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().optional(),
    // How often queued notifications are delivered by e-mail/push (seconds; 0 disables delivery).
    NOTIFY_DELIVERY_SECONDS: int(15, 0),

    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().trim().min(1).max(120).default('gpt-4.1-mini'),
    OPENROUTER_API_KEY: z.string().optional(),
    OPENROUTER_MODEL: z.string().trim().min(1).max(120).default('openai/gpt-4.1-mini'),
    AI_DEFAULT_PROVIDER: z.enum(AI_PROVIDERS).optional().or(z.literal('').transform(() => undefined)),
  });

  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  const c = parsed.data;

  // Checked on every start; the letters-and-digits rule is applied when the account is created (seed.ts).
  if (c.ADMIN_PASSWORD && c.ADMIN_PASSWORD.length < 10) {
    throw new Error('ADMIN_PASSWORD must be at least 10 characters');
  }
  if (isProduction && c.SEED_DEMO_DATA && !c.ALLOW_DEMO_IN_PRODUCTION) {
    throw new Error('SEED_DEMO_DATA=true is refused in production: demo accounts share a published password. Set SEED_DEMO_DATA=false (or ALLOW_DEMO_IN_PRODUCTION=true for a demo server only).');
  }

  const providers = {
    gemini: { apiKey: c.GEMINI_API_KEY?.trim() === 'MY_GEMINI_API_KEY' ? undefined : c.GEMINI_API_KEY?.trim() || undefined, model: c.GEMINI_MODEL },
    openai: { apiKey: c.OPENAI_API_KEY?.trim() || undefined, model: c.OPENAI_MODEL },
    openrouter: { apiKey: c.OPENROUTER_API_KEY?.trim() || undefined, model: c.OPENROUTER_MODEL },
  };
  if (c.AI_DEFAULT_PROVIDER && !providers[c.AI_DEFAULT_PROVIDER].apiKey) {
    throw new Error('AI_DEFAULT_PROVIDER requires a key for the selected provider');
  }
  const defaultAiProvider = c.AI_DEFAULT_PROVIDER ?? AI_PROVIDERS.find((id) => providers[id].apiKey) ?? null;

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
    tempPasswordHours: c.TEMP_PASSWORD_HOURS,
    /** The process time zone (TZ); scheduled jobs and logs follow it, so production should set it. */
    timeZone: env.TZ || undefined,
    cookieSecure: c.COOKIE_SECURE,
    admin: { email: c.ADMIN_EMAIL, password: c.ADMIN_PASSWORD, name: c.ADMIN_NAME },
    seedDemoData: c.SEED_DEMO_DATA,
    demoUserPassword: c.DEMO_USER_PASSWORD,
    enableSqlConsole: c.ENABLE_SQL_CONSOLE,
    allowDbReset: c.ALLOW_DB_RESET,
    backupIntervalHours: c.BACKUP_INTERVAL_HOURS,
    backupRetention: c.BACKUP_RETENTION,
    backupDirectory: c.BACKUP_DIRECTORY || undefined,
    backupRemote: c.BACKUP_REMOTE || undefined,
    newsActiveDays: c.NEWS_ACTIVE_DAYS,
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
    storageSyncSeconds: c.STORAGE_SYNC_SECONDS,
    ...providers,
    defaultAiProvider,
    mail: c.SMTP_HOST
      ? {
          host: c.SMTP_HOST,
          port: c.SMTP_PORT,
          secure: c.SMTP_SECURE,
          user: c.SMTP_USER || undefined,
          pass: c.SMTP_PASS || undefined,
          from: c.MAIL_FROM || c.SMTP_USER || `Madar NRCS <no-reply@${c.SMTP_HOST}>`,
        }
      : undefined,
    vapid: {
      publicKey: c.VAPID_PUBLIC_KEY || undefined,
      privateKey: c.VAPID_PRIVATE_KEY || undefined,
      subject: c.VAPID_SUBJECT || (c.MAIL_FROM && /@/.test(c.MAIL_FROM) ? `mailto:${c.MAIL_FROM.replace(/^.*<|>.*$/g, '')}` : c.APP_URL || 'mailto:admin@localhost'),
    },
    deliverySeconds: c.NOTIFY_DELIVERY_SECONDS,
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;
