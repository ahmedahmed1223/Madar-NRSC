import type { Request, Response } from 'express';

const MAX_DRAIN_BYTES = 16 * 1024 * 1024;

/**
 * Safely drains an unread incoming request body before sending an early error
 * response so Node's HTTP server does not reset the TCP socket (`ECONNRESET`)
 * while the client is still transmitting upload bytes.
 */
export function drainRequestBody(req: Request, maxWaitMs = 5000, maxBytes = MAX_DRAIN_BYTES): Promise<boolean> {
  if (req.complete || req.readableEnded || req.destroyed) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    let drained = 0;
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('close', onClose);
      req.off('aborted', onClose);
      req.off('error', onClose);
      resolve(completed);
    };
    const onData = (chunk: Buffer | string) => {
      drained += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      if (drained > maxBytes) {
        req.pause();
        finish(false);
      }
    };
    const onEnd = () => finish(true);
    const onClose = () => finish(Boolean(req.complete || req.readableEnded));
    const timeout = setTimeout(() => finish(false), maxWaitMs);
    timeout.unref();
    req.on('data', onData);
    req.once('end', onEnd);
    req.once('close', onClose);
    req.once('aborted', onClose);
    req.once('error', onClose);
    req.resume();
  });
}

/**
 * Sends a JSON error response only after any unread request body has been
 * safely drained, preventing intermittent `ECONNRESET` on rejected uploads.
 */
export function sendErrorAfterDrain(
  req: Request,
  res: Response,
  status: number,
  body: Record<string, unknown>,
): void {
  if (req.complete || req.readableEnded || req.destroyed) {
    if (!res.headersSent && !res.destroyed) res.status(status).json(body);
    return;
  }
  void drainRequestBody(req).then((completed) => {
    if (res.headersSent || res.destroyed) return;
    if (!completed) res.setHeader('Connection', 'close');
    res.status(status).json(body);
  });
}
