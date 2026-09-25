import type { NextFunction, Request, Response } from 'express';

/**
 * Fixed-window in-memory rate limiter. Suitable for a single-instance deployment
 * (SQLite already implies one writer process); put a shared limiter at the proxy if scaling out.
 */
export function createRateLimiter(opts: { windowMs: number; max: number; key: (req: Request) => string; message: string }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, opts.windowMs);
  sweep.unref();

  const middleware = (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = opts.key(req);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + opts.windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    res.setHeader('RateLimit-Limit', String(opts.max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, opts.max - entry.count)));
    if (entry.count > opts.max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ success: false, error: opts.message, code: 'RATE_LIMITED' });
    }
    next();
  };

  return Object.assign(middleware, { reset: () => hits.clear() });
}
