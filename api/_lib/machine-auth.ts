import { timingSafeEqual } from 'node:crypto';
import type { FunctionHeaders } from './types.js';

export const MIN_MACHINE_SECRET_BYTES = 32;

function headerValue(headers: FunctionHeaders | undefined): string {
  const value = headers?.authorization ?? headers?.Authorization;
  if (Array.isArray(value)) return value[0] || '';
  return typeof value === 'string' ? value : '';
}

function bearerToken(headers: FunctionHeaders | undefined): string {
  const match = /^Bearer\s+([^\s]+)$/i.exec(headerValue(headers).trim());
  return match?.[1] || '';
}

export function isMachineBearerAuthorized(
  headers: FunctionHeaders | undefined,
  configuredSecret: unknown,
): boolean {
  const secret = typeof configuredSecret === 'string' ? configuredSecret.trim() : '';
  const expected = Buffer.from(secret, 'utf8');
  if (expected.length < MIN_MACHINE_SECRET_BYTES) return false;

  const supplied = Buffer.from(bearerToken(headers), 'utf8');
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(expected, supplied);
}
