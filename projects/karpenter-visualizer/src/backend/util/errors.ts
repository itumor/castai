// Express error-handling helpers.
// Wraps async handlers so thrown errors propagate to the central error middleware.

import type { Request, Response, NextFunction, RequestHandler } from 'express';

export type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

export function asyncHandler(fn: AsyncRouteHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Centralised error responder. Use as the last middleware on the API router.
// Never leaks stack traces; always returns `{ error: string }`.
export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // eslint-disable-next-line no-console
  console.error('[api] handler error:', err);

  const message =
    err instanceof Error && err.message
      ? err.message
      : typeof err === 'string'
        ? err
        : 'internal server error';

  // Avoid leaking secret-shaped strings (kubeconfig contents, tokens, etc.).
  const sanitised = sanitiseErrorMessage(message);

  if (!res.headersSent) {
    res.status(500).json({ error: sanitised });
  }
}

function sanitiseErrorMessage(msg: string): string {
  // Trim and cap length so we never echo huge payloads (e.g. decoded CRDs).
  const trimmed = msg.trim().slice(0, 500);
  // Redact anything that looks like a bearer token or PEM block.
  if (/-----BEGIN [A-Z ]+-----/.test(trimmed)) return 'kubernetes client error';
  if (/Bearer\s+[A-Za-z0-9._-]+/i.test(trimmed)) return 'kubernetes client error';
  return trimmed;
}
