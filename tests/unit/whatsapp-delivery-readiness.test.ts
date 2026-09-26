import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  DESTINATION_SPECS,
  classifyFailure,
  classifyRunnableBacklog,
  formatReadiness,
  formatReadinessFailure,
  main,
  parseDestination,
  probeDestination,
  readinessFailures,
  resolveDestinationHost,
  runReadiness,
} from '../../scripts/whatsapp-delivery-readiness.mjs';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'scripts',
  'whatsapp-delivery-readiness.mjs',
);

function runCli(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, DOTENV_CONFIG_PATH: '/dev/null', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

const MACHINE_ROUTES = new Set(['evolution-webhook']);

// A local, side-effect-free server that mirrors the real request pipelines: the
// Node adapter answers OPTIONS before routing, global auth runs before route
// lookup, only the canonical machine routes bypass it, the VPS worker serves
// `/wake` on its own, and each handler rejects unsupported HEAD with 405 before
// any bearer check or work. It never parses webhooks, never wakes the worker and
// never contacts Evolution.
async function withRouteAwareServer(
  fn: (input: {
    port: number;
    requests: Array<{ method: string; path: string }>;
  }) => Promise<void>,
) {
  const requests: Array<{ method: string; path: string }> = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const routeName = url.pathname.replace(/^\/api\/?/, '').split('/')[0];
    const method = String(request.method || '');
    requests.push({ method, path: url.pathname });
    if (method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    if (url.pathname !== '/wake' && !MACHINE_ROUTES.has(routeName)) {
      response.writeHead(401);
      response.end('unauthorized');
      return;
    }
    if (method !== 'POST') {
      response.writeHead(405);
      response.end('method not allowed');
      return;
    }
    response.writeHead(401);
    response.end('unauthorized');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  try {
    await fn({ port: address.port, requests });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function destination(name: 'webhook' | 'worker') {
  const spec = DESTINATION_SPECS.find((entry: { name: string }) => entry.name === name)!;
  return parseDestination(
    name === 'webhook' ? 'https://app.example.com/api/evolution-webhook' : 'https://aspen-worker.example.com/wake',
    spec.name,
  )!;
}

function healthyReport() {
  return {
    destinations: DESTINATION_SPECS.map((spec: { name: string; expectedStatus: number }) => ({
      ...spec,
      ...destination(spec.name as 'webhook' | 'worker'),
      missing: false,
      dns: { ok: true, addresses: ['203.0.113.10'] },
      probe: { ok: true, status: spec.expectedStatus },
    })),
    backlog: { runnable: 0, oldest: null, stale: false, checked: true },
  };
}

test('destination parsing accepts http(s) origins and rejects credentials or other schemes', () => {
  assert.deepEqual(parseDestination('https://app.example.com/api/evolution-webhook', 'webhook'), {
    origin: 'https://app.example.com',
    host: 'app.example.com',
    path: '/api/evolution-webhook',
  });
  assert.equal(parseDestination('', 'webhook'), null);
  assert.throws(() => parseDestination('ftp://app.example.com', 'webhook'), /http ou https/);
  assert.throws(
    () => parseDestination('https://user:secret@app.example.com', 'webhook'),
    /credenciais/,
  );
});

test('destination DNS resolution reports addresses or a redacted failure', async () => {
  const ok = await resolveDestinationHost('app.example.com', async () => ({ address: '203.0.113.10' }));
  assert.deepEqual(ok, { ok: true, addresses: ['203.0.113.10'] });
  const failed = await resolveDestinationHost('dead.example.com', async () => {
    throw Object.assign(new Error('getaddrinfo ENOTFOUND dead.example.com'), { code: 'ENOTFOUND' });
  });
  assert.deepEqual(failed, { ok: false, error: 'HOST_NOT_FOUND' });
});

test('probe reports only the HTTP status and never throws', async () => {
  const webhook = { ...destination('webhook'), method: 'GET' };
  const unauthorized = await probeDestination(
    webhook,
    async () => new Response('nope', { status: 401 }),
  );
  assert.deepEqual(unauthorized, { ok: true, status: 401 });
  const unreachable = await probeDestination(webhook, async () => {
    throw Object.assign(new Error('fetch failed'), { name: 'TypeError', cause: { code: 'ECONNREFUSED' } });
  });
  assert.deepEqual(unreachable, { ok: false, error: 'CONNECTION_REFUSED' });
});

test('endpoint specs use the canonical paths with a side-effect-free HEAD probe', () => {
  assert.deepEqual(
    DESTINATION_SPECS.map(
      (spec: { name: string; method: string; expectedStatus: number; path: string }) => [
        spec.name,
        spec.method,
        spec.expectedStatus,
        spec.path,
      ],
    ),
    [
      ['webhook', 'HEAD', 405, '/api/evolution-webhook'],
      ['worker', 'HEAD', 405, '/wake'],
    ],
  );
});

test('runnable backlog flags old work and tolerates an empty queue', () => {
  const now = Date.parse('2026-09-11T12:00:00.000Z');
  const stale = classifyRunnableBacklog(
    { runnable: 3, oldest: '2026-09-11T10:00:00.000Z' },
    now,
  );
  assert.deepEqual(stale, { runnable: 3, oldest: '2026-09-11T10:00:00.000Z', stale: true });
  const fresh = classifyRunnableBacklog(
    { runnable: 1, oldest: '2026-09-11T11:55:00.000Z' },
    now,
  );
  assert.equal(fresh.stale, false);
  // A genuinely empty queue is healthy: zero runnable with no oldest.
  assert.deepEqual(classifyRunnableBacklog({ runnable: 0, oldest: null }, now), {
    runnable: 0,
    oldest: null,
    stale: false,
  });
});

test('an invalid backlog shape fails closed instead of becoming a green empty queue', () => {
  const now = Date.parse('2026-09-11T12:00:00.000Z');
  // The exact false-green coercion the old classifier produced: a non-numeric
  // count must never be read as zero.
  for (const rows of [
    { runnable: 'x', oldest: null },
    { runnable: -1, oldest: null },
    { runnable: 1.5, oldest: null },
    { runnable: Number.NaN, oldest: null },
    { runnable: Number.POSITIVE_INFINITY, oldest: null },
    { runnable: undefined, oldest: null },
    { runnable: 3, oldest: null },
    { runnable: 3, oldest: 'not-a-date' },
    { runnable: 0, oldest: 'not-a-date' },
    null,
    undefined,
  ]) {
    assert.throws(
      () => classifyRunnableBacklog(rows),
      (error: unknown) =>
        error instanceof Error &&
        error.message === 'Falha ao consultar a fila no banco de dados.',
      `expected invalid backlog to throw: ${JSON.stringify(rows)}`,
    );
  }
});

test('a malformed database result is reported as an unchecked, failing backlog', async () => {
  const report = await runReadiness({
    webhookUrl: 'https://app.example.com/api/evolution-webhook',
    workerUrl: 'https://aspen-worker.example.com/wake',
    databaseUrl: 'postgres://user:pass@127.0.0.1:5432/aspen',
    env: {},
    resolve: async () => ({ address: '203.0.113.20' }),
    fetchImpl: async () => new Response('', { status: 405 }),
    readBacklog: async () => ({ runnable: 'x', oldest: null }),
  });
  assert.equal(report.backlog.checked, false);
  assert.equal(report.backlog.stale, true);
  assert.equal(report.backlog.error, 'INVALID_BACKLOG');
  assert.deepEqual(readinessFailures(report), ['fila']);
  const output = formatReadiness(report);
  assert.match(output, /FALHA na verificação \(INVALID_BACKLOG\)/);
  assert.doesNotMatch(output, /resultado: OK/);
});


test('readiness report shows the destination host and fails on unresolved DNS without leaking URLs', async () => {
  const report = await runReadiness({
    webhookUrl: 'https://old.example.com/api/evolution-webhook',
    workerUrl: 'https://aspen-worker.example.com/wake',
    env: {},
    resolve: async (host: string) => {
      if (host === 'old.example.com') {
        throw Object.assign(new Error('ENOTFOUND'), { name: 'ENOTFOUND' });
      }
      return { address: '203.0.113.20' };
    },
    fetchImpl: async () => new Response('', { status: 405 }),
  });
  assert.equal(report.backlog.checked, false);
  const output = formatReadiness(report);
  assert.match(output, /destino webhook: host=old\.example\.com dns=FAIL \(HOST_NOT_FOUND\)/);
  assert.match(output, /destino worker: host=aspen-worker\.example\.com dns=OK/);
  assert.match(output, /resultado: FALHA em webhook, fila/);
  assert.doesNotMatch(output, /api\/evolution-webhook/);
  assert.doesNotMatch(output, /\/wake/);
});

test('missing, wrong-route and failing destinations make readiness fail closed', async () => {
  const base = {
    webhookUrl: 'https://app.example.com/api/evolution-webhook',
    workerUrl: 'https://aspen-worker.example.com/wake',
    probe: true,
  };
  const resolve = async () => ({ address: '203.0.113.20' });

  const missing = await runReadiness({ ...base, env: {}, resolve });
  assert.deepEqual(
    missing.destinations.map((entry: { missing: boolean }) => entry.missing),
    [false, false],
  );
  const noUrls = await runReadiness({ env: {}, resolve });
  assert.deepEqual(readinessFailures(noUrls), ['webhook', 'worker', 'fila']);
  assert.match(formatReadiness(noUrls), /destino webhook: AUSENTE/);

  for (const status of [404, 500, 401]) {
    const report = await runReadiness({
      ...base,
      env: {},
      resolve,
      fetchImpl: async () => new Response('', { status }),
    });
    // A wrong route (404), a broken route (500), or a protected path answered by
    // global auth before route lookup (401) must fail: only the canonical
    // handler reached with HEAD yields 405.
    assert.ok(readinessFailures(report).includes('webhook'));
    assert.match(formatReadiness(report), new RegExp(`probe=HTTP ${status} \\(esperado 405\\)`));
  }

  // A machine route that is not the canonical endpoint can still answer 405, so
  // the configured path itself must match the canonical one.
  const wrongPath = await runReadiness({
    ...base,
    webhookUrl: 'https://app.example.com/api/not-the-webhook',
    env: {},
    resolve,
    fetchImpl: async () => new Response('', { status: 405 }),
  });
  assert.ok(readinessFailures(wrongPath).includes('webhook'));
  assert.match(formatReadiness(wrongPath), /rota=divergente/);
});

test('stale runnable backlog fails readiness while a healthy report passes', async () => {
  assert.deepEqual(readinessFailures(healthyReport()), []);
  assert.match(formatReadiness(healthyReport()), /resultado: OK/);
  assert.match(formatReadiness(healthyReport()), /probe=HTTP 405 OK/);

  const stale = healthyReport();
  stale.backlog = { runnable: 2, oldest: '2026-09-11T10:00:00.000Z', stale: true, checked: true };
  assert.deepEqual(readinessFailures(stale), ['fila']);
  assert.match(formatReadiness(stale), /resultado: FALHA em fila/);
  assert.match(formatReadiness(stale), /FAIL atraso acima de 30min/);
});

test('an omitted probe can never produce an OK report', async () => {
  const omitted = healthyReport();
  omitted.destinations = omitted.destinations.map((entry: Record<string, unknown>) => ({
    ...entry,
    probe: null,
  }));
  assert.deepEqual(readinessFailures(omitted), ['webhook', 'worker']);
  assert.match(formatReadiness(omitted), /probe=OMITIDO \(obrigatório\)/);
  assert.match(formatReadiness(omitted), /resultado: FALHA em webhook, worker/);

  // The default path probes both endpoints; an explicit opt-out is a failure,
  // never an implicit pass.
  let probes = 0;
  const probing = await runReadiness({
    webhookUrl: 'https://app.example.com/api/evolution-webhook',
    workerUrl: 'https://aspen-worker.example.com/wake',
    env: {},
    resolve: async () => ({ address: '203.0.113.20' }),
    fetchImpl: async () => {
      probes += 1;
      return new Response('', { status: 405 });
    },
  });
  assert.equal(probes, 2);
  assert.deepEqual(readinessFailures(probing), ['fila']);

  probes = 0;
  const optedOut = await runReadiness({
    webhookUrl: 'https://app.example.com/api/evolution-webhook',
    workerUrl: 'https://aspen-worker.example.com/wake',
    probe: false,
    env: {},
    resolve: async () => ({ address: '203.0.113.20' }),
    fetchImpl: async () => {
      probes += 1;
      return new Response('', { status: 405 });
    },
  });
  assert.equal(probes, 0);
  assert.deepEqual(readinessFailures(optedOut), ['webhook', 'worker', 'fila']);
});

test('the process probes both canonical endpoints with HEAD and fails closed with --no-probe', async () => {
  await withRouteAwareServer(async ({ port, requests }) => {
    const urls = [
      '--webhook-url',
      `http://127.0.0.1:${port}/api/evolution-webhook`,
      '--worker-url',
      `http://127.0.0.1:${port}/wake`,
    ];
    const probed = await runCli(urls, { DATABASE_URL: '' });
    assert.match(probed.stdout, /probe=HTTP 405 OK/g);
    // Only unsupported HEAD reaches the handlers: no worker or webhook work ran.
    assert.deepEqual(requests.map((entry) => entry.method), ['HEAD', 'HEAD']);
    assert.deepEqual(requests.map((entry) => entry.path), [
      '/api/evolution-webhook',
      '/wake',
    ]);
    // No database is configured here, so the overall result is still FALHA; the
    // probes themselves must have run.
    assert.equal(probed.status, 1);

    requests.length = 0;
    const optedOut = await runCli([...urls, '--no-probe'], { DATABASE_URL: '' });
    assert.equal(optedOut.status, 1);
    assert.match(optedOut.stdout, /probe=OMITIDO \(obrigatório\)/);
    assert.equal(requests.length, 0);
  });
});

test('a wrong protected path returns 401 before route lookup and fails readiness', async () => {
  await withRouteAwareServer(async ({ port, requests }) => {
    const base = `http://127.0.0.1:${port}`;
    // Canonical machine routes reach the handler and answer HEAD with 405.
    assert.deepEqual(
      await probeDestination({ origin: base, path: '/api/evolution-webhook', method: 'HEAD' }),
      { ok: true, status: 405 },
    );
    assert.deepEqual(
      await probeDestination({
        origin: base,
        path: '/wake',
        method: 'HEAD',
      }),
      { ok: true, status: 405 },
    );
    // Both canonical probes were side-effect-free HEAD requests.
    assert.ok(requests.every((entry) => entry.method === 'HEAD'));

    // A wrong protected path returns 401, the same blanket status the old
    // accepted-method probe wrongly treated as healthy.
    requests.length = 0;
    assert.deepEqual(
      await probeDestination({ origin: base, path: '/api/not-the-webhook', method: 'HEAD' }),
      { ok: true, status: 401 },
    );
    assert.deepEqual(
      await probeDestination({ origin: base, path: '/api/not-the-worker', method: 'HEAD' }),
      { ok: true, status: 401 },
    );
    assert.ok(requests.every((entry) => entry.method === 'HEAD'));
  });

  const report = await runReadiness({
    webhookUrl: 'https://app.example.com/api/not-the-webhook',
    workerUrl: 'https://app.example.com/api/not-the-worker',
    env: {},
    resolve: async () => ({ address: '203.0.113.20' }),
    fetchImpl: async () => new Response('', { status: 401 }),
  });
  const failures = readinessFailures(report);
  assert.ok(failures.includes('webhook'));
  assert.ok(failures.includes('worker'));
  assert.doesNotMatch(formatReadiness(report), /resultado: OK/);
});

test('a database failure is reported without leaking the connection string', async () => {
  const secret = 'sup3r-s3cret-p4ss';
  const malicious = Object.assign(
    new Error(`connect ECONNREFUSED postgres://hermes:${secret}@10.0.0.9:5432/aspen`),
    { code: 'ECONNREFUSED' },
  );
  const failure = formatReadinessFailure(malicious);
  assert.match(failure, /Verificação de prontidão interrompida\./);
  assert.match(failure, /CONNECTION_REFUSED/);
  assert.doesNotMatch(failure, new RegExp(secret));
  assert.doesNotMatch(failure, /postgres:\/\//);
  assert.doesNotMatch(failure, /10\.0\.0\.9/);
  // A database failure keeps its fixed, specific message.
  assert.match(
    formatReadinessFailure(
      Object.assign(new Error('Falha ao consultar a fila no banco de dados.'), {
        code: 'ECONNREFUSED',
      }),
    ),
    /Falha ao consultar a fila no banco de dados\./,
  );

  // `readRunnableBacklog` classifies once and stores the mapped category on its
  // safe wrapper; the caller classifies that wrapper again. Re-emitting the
  // original category keeps the operator's diagnosis instead of degrading it to
  // UNKNOWN, and stays idempotent because the input is this module's own code.
  for (const mapped of ['CONNECTION_REFUSED', 'AUTH_FAILED', 'TIMEOUT', 'UNKNOWN']) {
    assert.equal(classifyFailure(Object.assign(new Error('safe'), { code: mapped })), mapped);
  }

  await withRouteAwareServer(async ({ port }) => {
    const child = await runCli(
      [
        '--webhook-url',
        `http://127.0.0.1:${port}/api/evolution-webhook`,
        '--worker-url',
        `http://127.0.0.1:${port}/wake`,
      ],
      { DATABASE_URL: `postgres://hermes:${secret}@127.0.0.1:1/aspen` },
    );
    assert.equal(child.status, 1);
    const output = `${child.stdout}${child.stderr}`;
    assert.match(output, /FALHA na verificação/);
    assert.doesNotMatch(output, new RegExp(secret));
    assert.doesNotMatch(output, /postgres:\/\//);
  });
});

test('an arbitrary driver code or secret-bearing message never reaches stdout, stderr or the report', async () => {
  // Any alphanumeric driver field is still arbitrary: it can be a secret. Only
  // the fixed allow-list may be printed.
  const codeSecret = 'sup3rs3cretp4ss';
  const messageSecret = 'p4ssw0rd-in-message';
  const urlSecret = 'https://driver:secretpw@10.9.8.7:5432/aspen';

  const arbitraryCode = Object.assign(
    new Error(`boom ${messageSecret} ${urlSecret}`),
    { code: codeSecret },
  );
  assert.equal(formatReadinessFailure(arbitraryCode), 'FAIL readiness WhatsApp: Verificação de prontidão interrompida. (UNKNOWN)\n');

  const arbitraryName = Object.assign(new Error(messageSecret), { name: codeSecret });
  assert.match(formatReadinessFailure(arbitraryName), /\(UNKNOWN\)/);

  // Prototype-chain keys must not bypass the allow-list: a plain bracket lookup
  // would inherit `Object.prototype` members and echo native function source.
  for (const prototypeKey of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
    const leaked = Object.assign(new Error(messageSecret), { code: prototypeKey });
    assert.equal(
      formatReadinessFailure(leaked),
      'FAIL readiness WhatsApp: Verificação de prontidão interrompida. (UNKNOWN)\n',
      `prototype key ${prototypeKey} must classify as UNKNOWN`,
    );
    assert.equal(classifyFailure(leaked), 'UNKNOWN');
  }

  // The report path stores the classification too: an unknown code becomes
  // UNKNOWN and the raw message never appears in the formatted report.
  const backlogSecret = Object.assign(new Error(messageSecret), { code: codeSecret });
  const report = {
    destinations: [
      {
        name: 'webhook',
        missing: false,
        expectedStatus: 405,
        host: 'app.example.com',
        dns: { ok: true, addresses: ['203.0.113.10'] },
        probe: { ok: true, status: 405 },
      },
      {
        name: 'worker',
        missing: false,
        expectedStatus: 405,
        host: 'app.example.com',
        dns: { ok: true, addresses: ['203.0.113.10'] },
        probe: { ok: true, status: 405 },
      },
    ],
    backlog: {
      runnable: 0,
      oldest: null,
      stale: true,
      checked: false,
      error: classifyFailure(backlogSecret),
    },
  };
  const output = formatReadiness(report);
  assert.match(output, /FALHA na verificação \(UNKNOWN\)/);
  assert.doesNotMatch(output, new RegExp(codeSecret));
  assert.doesNotMatch(output, new RegExp(messageSecret));
  assert.doesNotMatch(output, /10\.9\.8\.7/);
  assert.doesNotMatch(output, /secretpw/);

  // End to end through the real CLI: a secret-like code cannot escape even
  // though the database is unreachable for an unrelated reason.
  await withRouteAwareServer(async ({ port }) => {
    const child = await runCli(
      [
        '--webhook-url',
        `http://127.0.0.1:${port}/api/evolution-webhook`,
        '--worker-url',
        `http://127.0.0.1:${port}/wake`,
      ],
      { DATABASE_URL: `postgres://hermes:${codeSecret}@127.0.0.1:1/aspen` },
    );
    const output = `${child.stdout}${child.stderr}`;
    assert.equal(child.status, 1);
    assert.doesNotMatch(output, new RegExp(codeSecret));
    assert.doesNotMatch(output, new RegExp(messageSecret));
    assert.doesNotMatch(output, /postgres:\/\//);
    // Only a fixed uppercase category may appear; the raw driver value never.
    assert.match(output, /FALHA na verificação \((?:UNKNOWN|CONNECTION_REFUSED|[A-Z_]+)\)/);
  });
});

test('the real CLI exits nonzero for a failed readiness report without leaking paths', () => {
  const child = spawnSync(
    process.execPath,
    [
      SCRIPT,
      '--webhook-url',
      'https://nonexistent.invalid/api/evolution-webhook',
      '--worker-url',
      'https://nonexistent.invalid/wake',
    ],
    { encoding: 'utf8', timeout: 30_000, env: { ...process.env, DOTENV_CONFIG_PATH: '/dev/null' } },
  );
  assert.equal(child.status, 1);
  assert.match(child.stdout, /resultado: FALHA/);
  assert.doesNotMatch(child.stdout, /api\/evolution-webhook/);
});

test('main reports a healthy run as acceptable only when destinations and backlog pass', async () => {
  const failing = await main([
    '--webhook-url',
    'https://nonexistent.invalid/api/evolution-webhook',
    '--worker-url',
    'https://nonexistent.invalid/wake',
  ]);
  assert.equal(failing.ok, false);
  assert.match(failing.output, /resultado: FALHA/);
});

test('a database credential on argv is refused and never echoed', async () => {
  const secret = 'sup3r-s3cret-argv';
  const url = `postgres://hermes:${secret}@10.0.0.9:5432/aspen`;
  for (const argv of [
    ['--database-url', url],
    [`--database-url=${url}`],
    [
      '--webhook-url',
      'https://app.example.com/api/evolution-webhook',
      '--database-url',
      url,
    ],
  ]) {
    const result = await main(argv);
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.output, new RegExp(secret));
    assert.doesNotMatch(result.output, /postgres:\/\//);
    assert.doesNotMatch(result.output, /10\.0\.0\.9/);
    assert.match(result.output, /argumento proibido/);
  }
});

test('the real CLI refuses --database-url with a nonzero exit and no leak', async () => {
  const secret = 'argv-secret-value';
  const child = await runCli(
    ['--database-url', `postgres://user:${secret}@10.1.1.1:5432/aspen`],
    { DATABASE_URL: '' },
  );
  assert.equal(child.status, 1);
  const output = `${child.stdout}${child.stderr}`;
  assert.doesNotMatch(output, new RegExp(secret));
  assert.doesNotMatch(output, /postgres:\/\//);
  assert.match(output, /argumento proibido/);
});

