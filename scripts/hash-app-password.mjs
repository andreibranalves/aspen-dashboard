#!/usr/bin/env node
// Generate one APP_PASSWORD_HASH value without printing the entered password.
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { stdin, stderr, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';

/**
 * @typedef {import('node:stream').Readable & { isTTY?: boolean, setRawMode?: (enabled: boolean) => void }} PasswordInput
 * @typedef {import('node:stream').Writable} PasswordOutput
 */

// This is intentionally self-contained so first-time credential setup does not
// require generated API JavaScript. These are the fixed `scrypt:v1` parameters
// accepted by api/_shared/password.ts; the unit test verifies cross-module output.
const MAX_PASSWORD_BYTES = 1024;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_DERIVED_KEY_BYTES = 64;
const SCRYPT_OPTIONS = {
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
};

function isValidPasswordInput(password) {
  return (
    typeof password === 'string' &&
    Buffer.byteLength(password, 'utf8') > 0 &&
    Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_BYTES
  );
}

function deriveKey(password, salt) {
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

export async function createPasswordHash(password) {
  if (!isValidPasswordInput(password)) {
    throw new Error('A senha deve ter entre 1 e 1024 bytes UTF-8.');
  }

  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const derivedKey = await deriveKey(password, salt);
  return `scrypt:v1:${salt.toString('base64url')}:${derivedKey.toString('base64url')}`;
}

function trimTerminalNewline(value) {
  return value.endsWith('\r\n') ? value.slice(0, -2) : value.endsWith('\n') ? value.slice(0, -1) : value;
}

/** @param {PasswordInput} input */
function readPipedPassword(input) {
  return new Promise((resolve, reject) => {
    let password = '';

    input.setEncoding('utf8');
    input.on('data', (chunk) => {
      password += chunk;
      if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES + 2) {
        reject(new Error('Senha muito longa.'));
        input.pause();
      }
    });
    input.once('error', reject);
    input.once('end', () => resolve(trimTerminalNewline(password)));
  });
}

/**
 * Read a terminal password in raw mode so entered characters are never echoed.
 * @param {PasswordInput} [input]
 * @param {PasswordOutput} [promptOutput]
 */
export function readPassword(input = stdin, promptOutput = stderr) {
  if (!input.isTTY) return readPipedPassword(input);

  promptOutput.write('Digite a senha para APP_PASSWORD_HASH: ');
  return new Promise((resolve, reject) => {
    let password = '';

    const cleanup = () => {
      input.off('data', onData);
      input.off('error', onError);
      input.setRawMode?.(false);
      input.pause();
    };
    const finish = (value) => {
      cleanup();
      promptOutput.write('\n');
      resolve(value);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onData = (chunk) => {
      const characters = chunk.toString('utf8');

      for (const character of characters) {
        if (character === '\u0003' || character === '\u0004') {
          finish(null);
          return;
        }
        if (character === '\r' || character === '\n') {
          finish(password);
          return;
        }
        if (character === '\u0008' || character === '\u007f') {
          password = password.slice(0, -1);
          continue;
        }

        password += character;
        if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
          onError(new Error('Senha muito longa.'));
          return;
        }
      }
    };

    input.setRawMode?.(true);
    input.resume();
    input.on('data', onData);
    input.once('error', onError);
  });
}

/**
 * @param {{ input?: PasswordInput, output?: PasswordOutput, promptOutput?: PasswordOutput }} [options]
 */
export async function main({ input = stdin, output = stdout, promptOutput = stderr } = {}) {
  const password = await readPassword(input, promptOutput);
  if (password === null) return 130;

  const hash = await createPasswordHash(password);
  output.write(`${hash}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      stderr.write('Não foi possível gerar o hash da senha.\n');
      process.exitCode = 1;
    });
}
