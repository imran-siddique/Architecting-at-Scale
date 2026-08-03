import type { NextFunction, Request, Response } from 'express';
import {
  CORRELATION_HEADER,
  resolveCorrelationId,
  type Resolution,
} from './correlation-id.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlation?: Resolution;
    }
  }
}

/**
 * Mount this first, before anything that logs.
 *
 * Two properties matter more than the code:
 *   1. It runs at the edge, so every log line downstream can carry the ID.
 *   2. It echoes the ID back on the response, so a customer reporting a failure can hand you
 *      the exact identifier instead of an approximate timestamp. That single habit removes most
 *      of the guesswork from a support conversation.
 */
export function correlationMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const resolution = resolveCorrelationId(req.headers[CORRELATION_HEADER]);
    req.correlation = resolution;
    res.setHeader(CORRELATION_HEADER, resolution.correlationId);
    next();
  };
}
