import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, ZodError, type ZodTypeAny } from 'zod';

/** Wraps an async handler so rejected promises reach the error middleware. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

export class ValidationError extends Error {
  constructor(public readonly issues: Array<{ path: string; message: string }>) {
    super(issues.map((i) => i.message).join(' '));
    this.name = 'ValidationError';
  }
}

export function validate<S extends ZodTypeAny>(schema: S, payload: unknown): z.output<S> {
  try {
    return schema.parse(payload);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new ValidationError(err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    throw err;
  }
}

export class NotFoundError extends Error {
  constructor(what = 'Resource') {
    super(`${what} not found.`);
    this.name = 'NotFoundError';
  }
}

export function parseIntParam(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function parseBool(value: unknown): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  return ['1', 'true', 'yes'].includes(String(value).toLowerCase());
}

/** Accepts either a numeric id or a QID string in a route param. */
export function idOrQid(param: string): number | string {
  return /^\d+$/.test(param) ? Number(param) : param;
}
