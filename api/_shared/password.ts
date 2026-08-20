import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

export const PASSWORD_HASH_PREFIX = 'scrypt:v1';
export const PASSWORD_SALT_BYTES = 16;
export const PASSWORD_DERIVED_KEY_BYTES = 64;
export const MAX_PASSWORD_BYTES = 1024;

const MAX_PASSWORD_HASH_LENGTH = 256;
const SCRYPT_OPTIONS = {
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
};

export interface ParsedPasswordHash {
  salt: Buffer;
  derivedKey: Buffer;
}

function hasExpectedBase64Url(value: string, expectedBytes: number): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false;

  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.length === expectedBytes && decoded.toString('base64url') === value;
  } catch {
    return false;
  }
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, PASSWORD_DERIVED_KEY_BYTES, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });
}

/**
 * Passwords are intentionally bounded before scrypt so hostile request bodies
 * cannot turn an authentication attempt into an unbounded allocation.
 */
export function isValidPasswordInput(password: unknown): password is string {
  return (
    typeof password === 'string' &&
    Buffer.byteLength(password, 'utf8') > 0 &&
    Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_BYTES
  );
}

/** Strictly parse the only password-hash format accepted by this deployment. */
export function parsePasswordHash(encodedHash: unknown): ParsedPasswordHash | null {
  if (typeof encodedHash !== 'string' || encodedHash.length === 0 || encodedHash.length > MAX_PASSWORD_HASH_LENGTH) {
    return null;
  }

  const [algorithm, version, salt, derivedKey, ...extra] = encodedHash.split(':');
  if (
    extra.length > 0 ||
    algorithm !== 'scrypt' ||
    version !== 'v1' ||
    !salt ||
    !derivedKey ||
    !hasExpectedBase64Url(salt, PASSWORD_SALT_BYTES) ||
    !hasExpectedBase64Url(derivedKey, PASSWORD_DERIVED_KEY_BYTES)
  ) {
    return null;
  }

  return {
    salt: Buffer.from(salt, 'base64url'),
    derivedKey: Buffer.from(derivedKey, 'base64url'),
  };
}

export function isValidPasswordHash(encodedHash: unknown): encodedHash is string {
  return parsePasswordHash(encodedHash) !== null;
}

/** Create a versioned scrypt hash suitable for APP_PASSWORD_HASH. */
export async function createPasswordHash(password: string): Promise<string> {
  if (!isValidPasswordInput(password)) {
    throw new Error('A senha deve ter entre 1 e 1024 bytes UTF-8.');
  }

  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const derivedKey = await deriveKey(password, salt);
  return `${PASSWORD_HASH_PREFIX}:${salt.toString('base64url')}:${derivedKey.toString('base64url')}`;
}

/**
 * Verify credentials without exposing malformed hashes or scrypt failures to
 * callers. Both derived keys have a fixed length before timingSafeEqual runs.
 */
export async function verifyPassword(password: unknown, encodedHash: unknown): Promise<boolean> {
  if (!isValidPasswordInput(password)) return false;

  const parsedHash = parsePasswordHash(encodedHash);
  if (!parsedHash) return false;

  try {
    const derivedKey = await deriveKey(password, parsedHash.salt);
    return timingSafeEqual(derivedKey, parsedHash.derivedKey);
  } catch {
    return false;
  }
}
