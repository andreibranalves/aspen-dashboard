import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, it } from 'node:test';

import { createPasswordHash } from '../../api/_lib/password.js';

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getAvailablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Não foi possível reservar uma porta de teste.');
  }

  const { port } = address;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function waitForServer(
  url: string,
  appServer: ChildProcessWithoutNullStreams
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (appServer.exitCode !== null) {
      throw new Error(`app-server encerrou antes de iniciar (código ${appServer.exitCode}).`);
    }

    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      await delay(25);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Tempo esgotado ao iniciar app-server.');
}

async function stopServer(appServer: ChildProcessWithoutNullStreams): Promise<void> {
  if (appServer.exitCode !== null) return;

  const exited = once(appServer, 'exit');
  appServer.kill('SIGTERM');
  await Promise.race([exited, delay(2_000)]);
  if (appServer.exitCode === null) {
    appServer.kill('SIGKILL');
    await exited;
  }
}

describe('app-server authentication handoff', () => {
  it('forwards login and logout Set-Cookie headers while protecting settings in production', async () => {
    const port = await getAvailablePort();
    const password = randomBytes(24).toString('base64url');
    const passwordHash = await createPasswordHash(password);
    const sessionSecret = randomBytes(32).toString('base64url');
    const appServer = spawn(process.execPath, ['scripts/app-server.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'production',
        APP_AUTH_BYPASS: 'true',
        APP_PASSWORD_HASH: passwordHash,
        APP_SESSION_SECRET: sessionSecret,
        ERPNEXT_TOKEN: 'app-server-test-token',
        DATABASE_URL: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    appServer.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    appServer.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    try {
      const ready = await waitForServer(`${baseUrl}/api/login`, appServer);
      assert.equal(ready.status, 405, output);

      const unauthenticated = await fetch(`${baseUrl}/api/settings`);
      assert.equal(unauthenticated.status, 401);

      const login = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      assert.equal(login.status, 200);
      const loginCookie = login.headers.get('set-cookie');
      assert.match(
        loginCookie || '',
        /^aspen_token=[A-Za-z0-9:_-]+; HttpOnly; Secure; SameSite=Lax;/
      );

      const sessionCookie = loginCookie?.split(';', 1)[0];
      assert.ok(sessionCookie);
      const authenticated = await fetch(`${baseUrl}/api/settings`, {
        headers: { cookie: sessionCookie },
      });
      // DATABASE_URL is intentionally empty in this harness. Reaching the
      // settings handler must therefore be a safe database error, not 401.
      assert.equal(authenticated.status, 500);

      const logout = await fetch(`${baseUrl}/api/logout`, {
        method: 'POST',
        headers: { cookie: sessionCookie },
      });
      assert.equal(logout.status, 200);
      assert.match(logout.headers.get('set-cookie') || '', /Max-Age=0; Path=\/$/);
    } finally {
      await stopServer(appServer);
    }
  });
});
