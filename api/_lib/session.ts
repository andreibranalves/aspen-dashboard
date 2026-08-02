import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'aspen_token';
export const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_TOKEN_PREFIX = 'aspen-session:v1';

const SESSION_NONCE_BYTES = 32;
const SESSION_SIGNATURE_BYTES = 32;
const MIN_SESSION_SECRET_BYTES = 32;
const MAX_SESSION_SECRET_BYTES = 4096;
const MAX_SESSION_TOKEN_LENGTH = 512;
const EXPIRY_PATTERN = /^[1-9][0-9]{0,12}$/;

function getSecretMaterial(secret: unknown): Buffer | null {
  if (typeof secret !== 'string') return null;

  const bytes = Buffer.from(secret, 'utf8');
  if (bytes.length < MIN_SESSION_SECRET_BYTES || bytes.length > MAX_SESSION_SECRET_BYTES) {
    return null;
  }

  return bytes;
}

function isCanonicalBase64Url(value: string, expectedBytes: number): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false;

  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.length === expectedBytes && decoded.toString('base64url') === value;
  } catch {
    return false;
  }
}

function getUnixSeconds(nowMilliseconds: number): number | null {
  if (!Number.isFinite(nowMilliseconds) || nowMilliseconds < 0) return null;

  const seconds = Math.floor(nowMilliseconds / 1000);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

function signPayload(payload: string, secret: Buffer): Buffer {
  return createHmac('sha256', secret).update(payload, 'utf8').digest();
}

export function isValidSessionSecret(secret: unknown): secret is string {
  return getSecretMaterial(secret) !== null;
}

/** Issue an independently signed, expiring session token. */
export function createSessionToken(sessionSecret: unknown, nowMilliseconds = Date.now()): string | null {
  const secret = getSecretMaterial(sessionSecret);
  const issuedAt = getUnixSeconds(nowMilliseconds);
  if (!secret || issuedAt === null) return null;

  const expiresAt = issuedAt + SESSION_LIFETIME_SECONDS;
  if (!Number.isSafeInteger(expiresAt)) return null;

  try {
    const nonce = randomBytes(SESSION_NONCE_BYTES).toString('base64url');
    const payload = `${SESSION_TOKEN_PREFIX}:${expiresAt}:${nonce}`;
    const signature = signPayload(payload, secret).toString('base64url');
    return `${payload}:${signature}`;
  } catch {
    return null;
  }
}

/** Verify structure, signature, and expiry without accepting legacy cookies. */
export function verifySessionToken(
  token: unknown,
  sessionSecret: unknown,
  nowMilliseconds = Date.now()
): boolean {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_SESSION_TOKEN_LENGTH) {
    return false;
  }

  const secret = getSecretMaterial(sessionSecret);
  const now = getUnixSeconds(nowMilliseconds);
  if (!secret || now === null) return false;

  const [namespace, version, expiryText, nonce, signature, ...extra] = token.split(':');
  if (
    extra.length > 0 ||
    namespace !== 'aspen-session' ||
    version !== 'v1' ||
    !expiryText ||
    !nonce ||
    !signature ||
    !EXPIRY_PATTERN.test(expiryText) ||
    !isCanonicalBase64Url(nonce, SESSION_NONCE_BYTES) ||
    !isCanonicalBase64Url(signature, SESSION_SIGNATURE_BYTES)
  ) {
    return false;
  }

  const expiresAt = Number(expiryText);
  if (!Number.isSafeInteger(expiresAt)) return false;

  try {
    const expectedSignature = signPayload(
      `${SESSION_TOKEN_PREFIX}:${expiryText}:${nonce}`,
      secret
    );
    const suppliedSignature = Buffer.from(signature, 'base64url');
    if (suppliedSignature.length !== expectedSignature.length) return false;

    return timingSafeEqual(expectedSignature, suppliedSignature) && expiresAt > now;
  } catch {
    return false;
  }
}

/** Build the exact cookie attributes used for all successful browser sessions. */
export function createSessionCookie(token: unknown): string | null {
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > MAX_SESSION_TOKEN_LENGTH ||
    !/^[A-Za-z0-9:_-]+$/.test(token)
  ) {
    return null;
  }

  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_LIFETIME_SECONDS}; Path=/`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/`;
}
