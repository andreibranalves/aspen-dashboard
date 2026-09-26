#!/usr/bin/env node
// Read-only WhatsApp delivery readiness check.
//
// Purpose: before/after any operational change, prove that the real callback and
// scheduler destinations resolve and are reachable, and that the durable outbox
// has no stale runnable work hiding behind a healthy-looking worker.
//
// Safety:
// - never sends a message and never invokes the worker;
// - never prints credentials, headers, query strings or hashes;
// - the database section runs plain SELECTs only;
// - destination probing is mandatory: a report cannot be OK unless both
//   canonical endpoints answered the side-effect-free probe with their expected
//   handler status (`405` on unsupported `HEAD`). `--no-probe` exists for
//   diagnosis only and always yields FALHA/nonzero.
//
// Usage:
//   node scripts/whatsapp-delivery-readiness.mjs \
//     --webhook-url https://app.example.com/api/evolution-webhook \
//     --worker-url  https://aspen-worker.example.com/wake
//
// DATABASE_URL (when present) enables the stale-backlog section. The URL is read
// only from the environment/config; `--database-url` is forbidden and fails
// closed so credentials never appear in shell history or process listings.

import { lookup } from 'node:dns/promises';
import { pathToFileURL } from 'node:url';

const PROBE_TIMEOUT_MS = 5_000;
// A runnable step this old has been waiting far beyond the worker's wake and
// timer and indicates a stalled worker or claim path.
const STALE_RUNNABLE_MS = 30 * 60_000;
const SAFE_DATABASE_FAILURE = 'Falha ao consultar a fila no banco de dados.';
const INVALID_BACKLOG = 'INVALID_BACKLOG';
const FORBIDDEN_ARGV_FLAG = '--database-url';
const SAFE_ARGV_FAILURE =
  'FAIL readiness WhatsApp: argumento proibido. Remova --database-url; a URL vem apenas do ambiente protegido.\n';

// The database result shape is untrusted input: a malformed count or a runnable
// positive count without a parseable oldest timestamp cannot be treated as a
// healthy empty queue. Fail closed instead of coercing to zero.
class InvalidBacklogError extends Error {
  constructor() {
    super(SAFE_DATABASE_FAILURE);
    this.name = 'InvalidBacklogError';
    this.code = INVALID_BACKLOG;
  }
}

// Only fixed, explicit classifications ever reach the operator. Driver codes,
// error names and messages are arbitrary strings that can embed credentials (a
// connection string, a password), so nothing raw is echoed: a small allow-list
// maps known conditions to stable operator categories, and anything else —
// including secret-like alphanumeric values — becomes `UNKNOWN`.
const FAILURE_CATEGORIES = {
  ECONNREFUSED: 'CONNECTION_REFUSED',
  ECONNRESET: 'CONNECTION_RESET',
  ECONNABORTED: 'CONNECTION_ABORTED',
  EPIPE: 'CONNECTION_CLOSED',
  ETIMEDOUT: 'TIMEOUT',
  ENOTFOUND: 'HOST_NOT_FOUND',
  EAI_AGAIN: 'DNS_TEMPORARY',
  EHOSTUNREACH: 'HOST_UNREACHABLE',
  ENETUNREACH: 'NETWORK_UNREACHABLE',
  EADDRNOTAVAIL: 'ADDRESS_UNAVAILABLE',
  EACCES: 'ACCESS_DENIED',
  EPERM: 'ACCESS_DENIED',
  '08000': 'CONNECTION_FAILED',
  '08001': 'CONNECTION_FAILED',
  '08006': 'CONNECTION_FAILED',
  '28P01': 'AUTH_FAILED',
  '28000': 'AUTH_FAILED',
  '3D000': 'DATABASE_NOT_FOUND',
  '42P01': 'RELATION_MISSING',
  '53300': 'TOO_MANY_CONNECTIONS',
  '57P03': 'DATABASE_UNAVAILABLE',
  TimeoutError: 'TIMEOUT',
  AbortError: 'TIMEOUT',
  TypeError: 'NETWORK',
  [INVALID_BACKLOG]: INVALID_BACKLOG,
};

// The fixed categories this module may emit. Recognizing them on a second pass
// keeps classification idempotent without ever echoing a driver-supplied value:
// every member is part of this module's own non-sensitive vocabulary.
const SAFE_FAILURE_CODES = new Set(Object.values(FAILURE_CATEGORIES));

export function classifyFailure(error) {
  const candidates = [];
  if (error && typeof error === 'object') {
    if (typeof error.code === 'string') candidates.push(error.code);
    if (error.cause && typeof error.cause === 'object') {
      if (typeof error.cause.code === 'string') candidates.push(error.cause.code);
      if (typeof error.cause.name === 'string') candidates.push(error.cause.name);
    }
    if (typeof error.name === 'string') candidates.push(error.name);
  }
  for (const candidate of candidates) {
    const key = candidate.trim();
    // Own-property lookup only: `FAILURE_CATEGORIES[key]` would inherit from
    // `Object.prototype`, so a driver code like `constructor` or `toString`
    // would bypass the allow-list and echo native function source.
    if (Object.hasOwn(FAILURE_CATEGORIES, key)) return FAILURE_CATEGORIES[key];
    // `readRunnableBacklog` already stores a mapped category on the safe wrapper
    // and the caller classifies again; recognize an emitted category so the
    // operator sees the original cause instead of a downgraded `UNKNOWN`.
    if (SAFE_FAILURE_CODES.has(key)) return key;
  }
  return 'UNKNOWN';
}

export function formatReadinessFailure(error) {
  const detail =
    error instanceof Error && error.message === SAFE_DATABASE_FAILURE
      ? SAFE_DATABASE_FAILURE
      : 'Verificação de prontidão interrompida.';
  return `FAIL readiness WhatsApp: ${detail} (${classifyFailure(error)})\n`;
}

// Endpoint-specific safe probes. Each sends an unsupported `HEAD` without
// credentials or body, and the handler rejects it with `405` before bearer
// validation or any work. On Vercel the real pipeline lets the canonical machine
// route through global auth; a wrong protected path returns `401` before route
// lookup and therefore fails readiness. The VPS worker (ADR 0013) answers `404`
// on any path but its own.
// `OPTIONS` is unusable here: the Node adapter short-circuits it with `204`.
export const DESTINATION_SPECS = [
  {
    name: 'webhook',
    method: 'HEAD',
    expectedStatus: 405,
    envKey: 'EVOLUTION_WEBHOOK_URL',
    path: '/api/evolution-webhook',
  },
  {
    name: 'worker',
    method: 'HEAD',
    expectedStatus: 405,
    envKey: 'WORKER_WAKE_URL',
    path: '/wake',
  },
];

export function parseDestination(value, name) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} deve ser uma URL http(s) válida.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${name} deve usar http ou https.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${name} não pode conter credenciais.`);
  }
  return { origin: parsed.origin, host: parsed.hostname, path: parsed.pathname };
}

export async function resolveDestinationHost(host, resolve = lookup) {
  try {
    const result = await resolve(host);
    const addresses = Array.isArray(result) ? result.map((entry) => entry.address) : [result.address];
    return { ok: true, addresses };
  } catch (error) {
    return { ok: false, error: classifyFailure(error) };
  }
}

export async function probeDestination(destination, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${destination.origin}${destination.path}`, {
      method: destination.method || 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    return { ok: true, status: response.status };
  } catch (error) {
    return { ok: false, error: classifyFailure(error) };
  }
}

export function classifyRunnableBacklog(rows, now = Date.now()) {
  if (!rows || typeof rows !== 'object') throw new InvalidBacklogError();
  const runnable = rows.runnable;
  if (!Number.isSafeInteger(runnable) || runnable < 0) throw new InvalidBacklogError();
  // Any value at all (including an unparseable string) that is present but not a
  // valid timestamp is invalid when a positive count is claimed.
  const rawOldest = rows.oldest;
  let oldest = null;
  if (rawOldest !== null && rawOldest !== undefined) {
    const parsed = new Date(rawOldest);
    if (Number.isNaN(parsed.getTime())) throw new InvalidBacklogError();
    oldest = parsed;
  }
  if (runnable > 0 && oldest === null) throw new InvalidBacklogError();
  return {
    runnable,
    oldest: oldest ? oldest.toISOString() : null,
    stale: oldest !== null && now - oldest.getTime() > STALE_RUNNABLE_MS,
  };
}

export async function readRunnableBacklog(connectionString) {
  const { default: postgres } = await import('postgres');
  let client;
  try {
    client = postgres(connectionString, { max: 1, connect_timeout: 5, onnotice: () => {} });
    const [row] = await client`
      SELECT
        count(*)::int AS runnable,
        min(next_attempt_at) AS oldest
      FROM quotation_delivery_steps
      WHERE state IN ('queued', 'retry_scheduled')
        AND next_attempt_at IS NOT NULL
        AND next_attempt_at <= now()
    `;
    return { runnable: row?.runnable, oldest: row?.oldest ?? null };
  } catch (error) {
    const failure = new Error(SAFE_DATABASE_FAILURE);
    failure.code = classifyFailure(error);
    throw failure;
  } finally {
    if (client) await client.end({ timeout: 5 }).catch(() => {});
  }
}

export function formatReadiness(report) {
  const failures = readinessFailures(report);
  const lines = ['whatsapp readiness (somente leitura)'];
  for (const destination of report.destinations) {
    if (destination.missing) {
      lines.push(`destino ${destination.name}: AUSENTE (configure a URL)`);
      continue;
    }
    const dns = destination.dns?.ok
      ? `dns=OK (${destination.dns.addresses.length} endereço(s))`
      : `dns=FAIL (${destination.dns?.error || 'UNKNOWN'})`;
    const probe =
      destination.probe === null || destination.probe === undefined
        ? 'probe=OMITIDO (obrigatório)'
        : destination.probe.ok
          ? `probe=HTTP ${destination.probe.status}${
              destination.probe.status === destination.expectedStatus
                ? ' OK'
                : ` (esperado ${destination.expectedStatus})`
            }`
          : `probe=FAIL (${destination.probe.error})`;
    const route = destination.pathMismatch ? ' rota=divergente (esperada a canônica)' : '';
    lines.push(`destino ${destination.name}: host=${destination.host}${route} ${dns} ${probe}`);
  }
  if (!report.backlog?.checked) {
    lines.push(
      report.backlog?.error
        ? `fila executável: FALHA na verificação (${report.backlog.error})`
        : 'fila executável: não verificada (DATABASE_URL ausente)',
    );
  } else {
    const { runnable, oldest, stale } = report.backlog;
    lines.push(
      `fila executável agora: ${runnable} etapa(s); mais antiga: ${oldest || '—'}; ${stale ? 'FAIL atraso acima de 30min' : 'OK'}`,
    );
  }
  lines.push(
    failures.length === 0 ? 'resultado: OK' : `resultado: FALHA em ${failures.join(', ')}`,
  );
  return `${lines.join('\n')}\n`;
}

export function readinessFailures(report) {
  const failures = [];
  for (const destination of report.destinations || []) {
    if (destination.missing) {
      failures.push(destination.name);
      continue;
    }
    if (destination.pathMismatch) {
      failures.push(destination.name);
      continue;
    }
    if (!destination.dns?.ok) {
      failures.push(destination.name);
      continue;
    }
    // Probing is mandatory: without the observed endpoint status the report
    // cannot prove the callback/schedule routes reach the active handler, so an
    // omitted probe is a failure, never an implicit pass.
    if (!destination.probe) {
      failures.push(destination.name);
      continue;
    }
    if (!destination.probe.ok || destination.probe.status !== destination.expectedStatus) {
      failures.push(destination.name);
    }
  }
  if (!report.backlog?.checked || report.backlog.stale) failures.push('fila');
  return failures;
}

export async function runReadiness({
  webhookUrl,
  workerUrl,
  databaseUrl,
  probe = true,
  env = process.env,
  resolve = lookup,
  fetchImpl = fetch,
  readBacklog = readRunnableBacklog,
} = {}) {
  const destinations = [];
  for (const spec of DESTINATION_SPECS) {
    const value = (spec.name === 'webhook' ? webhookUrl : workerUrl) || env[spec.envKey];
    const destination = parseDestination(value, spec.name);
    if (!destination) {
      destinations.push({ ...spec, missing: true, dns: null, probe: null });
      continue;
    }
    destinations.push({
      ...spec,
      ...destination,
      missing: false,
      pathMismatch: destination.path !== spec.path,
      dns: await resolveDestinationHost(destination.host, resolve),
      probe: probe
        ? await probeDestination(
            { ...destination, method: spec.method },
            fetchImpl,
          )
        : null,
    });
  }
  const url = String(databaseUrl || env.DATABASE_URL || '').trim();
  let backlog;
  if (!url) {
    backlog = { runnable: 0, oldest: null, stale: false, checked: false };
  } else {
    try {
      backlog = { ...classifyRunnableBacklog(await readBacklog(url)), checked: true };
    } catch (error) {
      // Never surface the raw driver/connection error: it can embed the
      // connection string. Keep the safe message and bounded code only.
      backlog = {
        runnable: 0,
        oldest: null,
        stale: true,
        checked: false,
        error: classifyFailure(error),
      };
    }
  }
  return { destinations, backlog };
}

export async function main(argv = process.argv.slice(2)) {
  // Credentials must never travel through argv (shell history, process
  // listings). The database URL is read only from the protected environment or
  // config path; the forbidden flag fails closed without echoing its value.
  if (argv.some((argument) => argument === FORBIDDEN_ARGV_FLAG || argument.startsWith(`${FORBIDDEN_ARGV_FLAG}=`))) {
    return { output: SAFE_ARGV_FAILURE, ok: false, forbiddenArgument: true };
  }
  const valueAfter = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const report = await runReadiness({
    webhookUrl: valueAfter('--webhook-url'),
    workerUrl: valueAfter('--worker-url'),
    // Probing is mandatory; `--no-probe` is a diagnosis escape hatch that always
    // produces FALHA because readiness cannot be proven without it.
    probe: !argv.includes('--no-probe'),
  });
  const output = formatReadiness(report);
  const ok = readinessFailures(report).length === 0;
  return { output, ok };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(({ output, ok }) => {
      process.stdout.write(output);
      if (!ok) process.exitCode = 1;
    })
    .catch((error) => {
      process.stderr.write(formatReadinessFailure(error));
      process.exitCode = 1;
    });
}
