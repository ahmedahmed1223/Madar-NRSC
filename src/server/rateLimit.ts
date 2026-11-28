import type { NextFunction, Request, Response } from 'express';
import { sendErrorAfterDrain } from './requestBody';

/**
 * Fixed-window in-memory rate limiter. Suitable for a single-instance deployment
 * (SQLite already implies one writer process); put a shared limiter at the proxy if scaling out.
 */
export function createRateLimiter(opts: { windowMs: number; max: number; key: (req: Request) => string; message: string }) {
  const maxKeys = 10_000;
  const hits = new Map<string, { count: number; resetAt: number }>();

  let lastSweep = 0;
  const purgeExpired = (now: number) => {
    lastSweep = now;
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  };
  const sweep = setInterval(() => purgeExpired(Date.now()), opts.windowMs);
  sweep.unref();

  const rateLimited = (req: Request, res: Response, retryAfter: number) => {
    res.setHeader('Retry-After', String(retryAfter));
    const body = { success: false, error: opts.message, code: 'RATE_LIMITED' };
    if (req.headers['transfer-encoding'] || Number(req.headers['content-length']) > 0) {
      return sendErrorAfterDrain(req, res, 429, body);
    }
    return res.status(429).json(body);
  };

  const middleware = (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = opts.key(req);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      if (!entry && hits.size >= maxKeys && now - lastSweep >= 1000) purgeExpired(now);
      if (!entry && hits.size >= maxKeys) {
        return rateLimited(req, res, Math.ceil(opts.windowMs / 1000));
      }
      entry = { count: 0, resetAt: now + opts.windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    res.setHeader('RateLimit-Limit', String(opts.max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, opts.max - entry.count)));
    if (entry.count > opts.max) {
      return rateLimited(req, res, Math.ceil((entry.resetAt - now) / 1000));
    }
    next();
  };

  return Object.assign(middleware, { reset: () => hits.clear() });
}
