// Command-level regression for the safe E2E runner (scripts/run-safe-e2e.mjs).
//
// The confirmed parent bug: a blocked egress that set process.exitCode was
// erased by the unconditional `process.exit(result.status)`, so a green
// Playwright run made the whole command pass even with blocked egress. These
// tests execute the real script as a child process and stub only `npx` (the
// Playwright launcher) so no browser, server or remote call participates.
//
// Evidence attribution: the runner only accepts a `guard_initialized` marker
// that carries THIS run's nonce and comes from the app-server entrypoint. The
// stub simulates the guard output of whichever process we want to model.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  buildSafeE2eEnvironment,
  NETWORK_GUARD_PATH,
  safeE2eNpxArgs,
  SAFE_E2E_EGRESS_LOG_VAR,
  SAFE_E2E_SERVER_ENTRY,
} from '../../scripts/lib/safe-e2e-env.mjs';

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RUNNER = fileURLToPath(new URL('../../scripts/run-safe-e2e.mjs', import.meta.url));
const DISPOSABLE_URL = 'postgresql://review:review@127.0.0.1:55432/aspen_safe_e2e';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'safe-e2e-runner-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const egressLog = join(dir, 'egress.log');
  return { dir, bin, egressLog };
}

/**
 * Stub `npx` that records its argv and simulates the guard output of a given
 * process, using the run nonce the runner injected into the environment. Only
 * the app-server entry counts as server-attributed evidence.
 */
function stubNpx(
  bin,
  status,
  { init = true, entry = SAFE_E2E_SERVER_ENTRY, blocked = false, malformed = false } = {}
) {
  const lines = [];
  if (init) {
    lines.push(
      `printf '{"event":"guard_initialized","runId":"%s","entry":"%s"}\\n' "$SAFE_E2E_RUN_ID" "${entry}" >> "$SAFE_E2E_EGRESS_LOG"`
    );
  }
  if (blocked) {
    lines.push(
      `printf '{"event":"blocked","host":"remote.invalid"}\\n' >> "$SAFE_E2E_EGRESS_LOG"`
    );
  }
  if (malformed) {
    lines.push(`printf 'not-json\\n' >> "$SAFE_E2E_EGRESS_LOG"`);
  }
  if (init) {
    lines.push(
      `printf '{"event":"allowed","host":"127.0.0.1"}\\n' >> "$SAFE_E2E_EGRESS_LOG"`
    );
  }
  writeFileSync(
    join(bin, 'npx'),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "$(dirname "$0")/npx-argv.txt"\n${lines.join('\n')}\nexit ${status}\n`,
    { mode: 0o755 }
  );
}

function runRunner({ bin, egressLog }) {
  return spawnSync(process.execPath, [RUNNER], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      TEST_DATABASE_URL: DISPOSABLE_URL,
      [SAFE_E2E_EGRESS_LOG_VAR]: egressLog,
    },
    timeout: 30_000,
  });
}

test('a green Playwright run still fails the command when egress was blocked', () => {
  const { dir, bin, egressLog } = setup();
  try {
    stubNpx(bin, 0, { blocked: true });
    const result = runRunner({ bin, egressLog });
    assert.notEqual(result.status, 0, `expected nonzero, got 0\n${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /egress não-loopback bloqueado/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a green Playwright run fails when the guard never initialized', () => {
  const { dir, bin, egressLog } = setup();
  try {
    stubNpx(bin, 0, { init: false });
    const result = runRunner({ bin, egressLog });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /não registrou inicialização/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a green Playwright run fails on an unreadable audit log', () => {
  const { dir, bin, egressLog } = setup();
  try {
    stubNpx(bin, 0, { malformed: true });
    const result = runRunner({ bin, egressLog });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ilegível/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a stale server marker from a previous run cannot satisfy the audit', () => {
  const { dir, bin, egressLog } = setup();
  try {
    // Pre-existing evidence pretending the server guard was active, but under
    // an older run nonce.
    writeFileSync(
      egressLog,
      `${JSON.stringify({
        event: 'guard_initialized',
        runId: 'previous-run',
        entry: `/workspace/scripts/${SAFE_E2E_SERVER_ENTRY}`,
      })}\n${JSON.stringify({ event: 'allowed', host: '127.0.0.1' })}\n`
    );
    stubNpx(bin, 0, { init: false });
    const result = runRunner({ bin, egressLog });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /servidor HTTP testado/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a marker from another Node process (npx/Playwright) cannot satisfy the audit', () => {
  const { dir, bin, egressLog } = setup();
  try {
    stubNpx(bin, 0, { entry: 'node_modules/npx-cli.js' });
    const result = runRunner({ bin, egressLog });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /servidor HTTP testado/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a green Playwright run passes only with run-scoped server-attributed evidence', () => {
  const { dir, bin, egressLog } = setup();
  try {
    stubNpx(bin, 0);
    const result = runRunner({ bin, egressLog });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const argv = readFileSync(join(bin, 'npx-argv.txt'), 'utf8');
    assert.match(argv, /playwright/);
    assert.match(argv, /tests\/commercial-queue-integrated\.spec\.js/);
    // The runner must force the guard through npm's own config precedence.
    assert.match(argv, /--node-options/);
    assert.match(argv, /--import .*safe-e2e-network-guard\.mjs/);
    assert.match(argv, /--no-install/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failing Playwright run fails the command', () => {
  const { dir, bin, egressLog } = setup();
  try {
    stubNpx(bin, 1);
    const result = runRunner({ bin, egressLog });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Playwright retornou status 1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The runner refuses the whole run when its positive control does not block a
 * non-loopback probe. This proves the exact control command the runner uses is
 * load-bearing: the same probe returns nonzero when the guard module is
 * missing, so the runner's precondition can never pass silently.
 */
test('the positive-control probe distinguishes an active guard from a broken one', () => {
  const { dir, egressLog } = setup();
  const controlCode = `globalThis.fetch('https://control.invalid/egress').then(() => process.exit(9), (error) => process.exit(String(error.message).includes('SAFE_E2E_EGRESS_BLOCKED') ? 0 : 8));`;
  try {
    const active = spawnSync(
      process.execPath,
      ['--import', NETWORK_GUARD_PATH, '-e', controlCode],
      {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        env: { PATH: process.env.PATH, [SAFE_E2E_EGRESS_LOG_VAR]: egressLog },
      }
    );
    assert.equal(active.status, 0, `active guard must block: ${active.stderr}`);

    const missingGuard = join(dir, 'missing-guard.mjs');
    const broken = spawnSync(process.execPath, ['--import', missingGuard, '-e', controlCode], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, [SAFE_E2E_EGRESS_LOG_VAR]: egressLog },
    });
    assert.notEqual(broken.status, 0, 'a missing guard must fail the probe');
    assert.equal(existsSync(missingGuard), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Real npm child-process seam. `npm_config_node_options` makes npm overwrite the
 * child's NODE_OPTIONS, which previously dropped the preloaded guard before the
 * app server/Playwright descendant started. The runner now passes an explicit
 * `--node-options` that outranks env aliases and `.npmrc`. The hostile alias is
 * re-injected on purpose so this test fails if that forced config is ever lost.
 * Uses the installed local Playwright with `--version` (no browser, server or
 * package download).
 */
test('the real npx/Playwright chain keeps the guard when npm config is poisoned', () => {
  const dir = mkdtempSync(join(tmpdir(), 'safe-e2e-npm-'));
  const egressLog = join(dir, 'egress.log');
  try {
    const safe = buildSafeE2eEnvironment(
      {
        TEST_DATABASE_URL: DISPOSABLE_URL,
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        npm_config_node_options: '--no-warnings',
        NPM_CONFIG_NODE_OPTIONS: '--trace-warnings',
        npm_config_userconfig: join(dir, 'hostile.npmrc'),
        NPM_TOKEN: 'npm-secret-sentinel',
      },
      { egressLog, runId: 'npm-seam-run' }
    );
    const hostileEnv = {
      ...safe.env,
      npm_config_node_options: '--no-warnings',
      NPM_CONFIG_NODE_OPTIONS: '--trace-warnings',
    };
    const args = safeE2eNpxArgs([]);
    args[args.length - 1] = '--version';

    const result = spawnSync('npx', args, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      env: hostileEnv,
      timeout: 60_000,
    });
    assert.equal(result.status, 0, `npx playwright --version failed:\n${result.stderr}`);

    const lines = readFileSync(egressLog, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const playwrightInit = lines.find(
      (entry) => entry.event === 'guard_initialized' && /playwright/i.test(String(entry.entry))
    );
    assert.ok(
      playwrightInit,
      `the Playwright descendant must load the egress guard (entries: ${JSON.stringify(
        lines.filter((e) => e.event === 'guard_initialized').map((e) => e.entry)
      )})`
    );
    assert.equal(playwrightInit.runId, safe.runId, 'guard evidence must carry the fresh run id');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
