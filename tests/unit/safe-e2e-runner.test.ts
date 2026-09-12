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
//
// Teardown contract: best-effort. On SIGINT/SIGTERM the runner revokes the
// capability FIRST, then signals ONLY the known direct child/group while the
// live ChildProcess lifecycle says it is still running, waits a bounded time
// and exits with the conventional 130/143. It never chases detached descendants
// and never reuses a stale PID/PGID, so a descendant that survives in its own
// session is accepted (documented in docs/safe-e2e.md) and is not asserted as a
// failure here.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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
    lines.push(`printf '{"event":"blocked","host":"remote.invalid"}\\n' >> "$SAFE_E2E_EGRESS_LOG"`);
  }
  if (malformed) {
    lines.push(`printf 'not-json\\n' >> "$SAFE_E2E_EGRESS_LOG"`);
  }
  if (init) {
    lines.push(`printf '{"event":"allowed","host":"127.0.0.1"}\\n' >> "$SAFE_E2E_EGRESS_LOG"`);
  }
  writeFileSync(
    join(bin, 'npx'),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "$(dirname "$0")/npx-argv.txt"\nprintf '%s' "$SAFE_E2E_CAPABILITY_PATH" > "$(dirname "$0")/capability-path.txt"\n${lines.join('\n')}\nexit ${status}\n`,
    { mode: 0o755 }
  );
}

function writeDescendant(bin) {
  writeFileSync(
    join(bin, 'descendant.sh'),
    `#!/bin/sh\nDIR="$(dirname "$0")"\nprintf '%s' "$$" > "$DIR/descendant-pid.txt"\nif [ "\${DESC_TRAP:-0}" = "1" ]; then\n  trap 'echo term > "$DIR/descendant-signaled.txt"' TERM\nfi\nwhile true; do sleep 1; done\n`,
    { mode: 0o755 }
  );
}

/**
 * Stub `npx` modelling the real launcher: a long-lived process that stays in a
 * NEW process group and spawns a descendant into the SAME group. The trap
 * records whether the capability still existed when the signal arrived, so the
 * "capability revoked before signal" ordering is observable through the public
 * contract. `ignoreTerm` keeps the launcher alive so bounded-wait is exercised.
 */
function stubLiveTree(bin, { ignoreTerm = false } = {}) {
  writeDescendant(bin);
  const trap = ignoreTerm
    ? "trap '' TERM"
    : `trap 'if [ -e "$SAFE_E2E_CAPABILITY_PATH" ]; then echo present > "$DIR/cap-at-signal.txt"; else echo absent > "$DIR/cap-at-signal.txt"; fi; exit 0' TERM`;
  writeFileSync(
    join(bin, 'npx'),
    `#!/bin/sh\nDIR="$(dirname "$0")"\nprintf '%s' "$SAFE_E2E_CAPABILITY_PATH" > "$DIR/capability-path.txt"\nprintf '%s' "$$" > "$DIR/npx-pid.txt"\n${trap}\nDESC_TRAP=0 "$DIR/descendant.sh" &\ni=0\nwhile [ ! -f "$DIR/descendant-pid.txt" ] && [ "$i" -lt 200 ]; do sleep 0.05; i=$((i+1)); done\nprintf '{"event":"guard_initialized","runId":"%s","entry":"app-server.mjs"}\\n' "$SAFE_E2E_RUN_ID" >> "$SAFE_E2E_EGRESS_LOG"\nprintf '{"event":"allowed","host":"127.0.0.1"}\\n' >> "$SAFE_E2E_EGRESS_LOG"\nprintf 'ready' > "$DIR/ready.txt"\nwhile true; do sleep 1; done\n`,
    { mode: 0o755 }
  );
}

/**
 * Stub `npx` that exits green while leaving a same-group descendant behind. The
 * descendant traps TERM (recording it) and keeps running, so the runner must
 * observe the launcher as already closed and send NO signal at all — a stale
 * `kill(-pgid)` would both kill it and leave a record.
 */
function stubResidualTree(bin) {
  writeDescendant(bin);
  writeFileSync(
    join(bin, 'npx'),
    `#!/bin/sh\nDIR="$(dirname "$0")"\nprintf '%s' "$SAFE_E2E_CAPABILITY_PATH" > "$DIR/capability-path.txt"\nprintf '%s' "$$" > "$DIR/npx-pid.txt"\nDESC_TRAP=1 "$DIR/descendant.sh" &\ni=0\nwhile [ ! -f "$DIR/descendant-pid.txt" ] && [ "$i" -lt 200 ]; do sleep 0.05; i=$((i+1)); done\nprintf '{"event":"guard_initialized","runId":"%s","entry":"app-server.mjs"}\\n' "$SAFE_E2E_RUN_ID" >> "$SAFE_E2E_EGRESS_LOG"\nprintf '{"event":"allowed","host":"127.0.0.1"}\\n' >> "$SAFE_E2E_EGRESS_LOG"\nprintf 'ready' > "$DIR/ready.txt"\nexit 0\n`,
    { mode: 0o755 }
  );
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
}

function killIfAlive(pid) {
  if (!pidAlive(pid)) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // best-effort cleanup only
  }
}

/** Reads a recorded PID, tolerating a missing file during best-effort cleanup. */
function readRecordedPid(path) {
  try {
    return Number(readFileSync(path, 'utf8')) || 0;
  } catch {
    return 0;
  }
}

async function waitForFile(path, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return existsSync(path);
}

async function waitForDeath(pid, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !pidAlive(pid);
}

function spawnRunner({ bin, egressLog }) {
  const child = spawn(process.execPath, [RUNNER], {
    cwd: PROJECT_ROOT,
    stdio: 'ignore',
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      TEST_DATABASE_URL: DISPOSABLE_URL,
      [SAFE_E2E_EGRESS_LOG_VAR]: egressLog,
    },
  });
  // Capture exit immediately so a signal/close race can never miss the event.
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  return { child, exited };
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
    // Audit failure must still revoke the capability.
    const capabilityPath = readFileSync(join(bin, 'capability-path.txt'), 'utf8');
    assert.equal(
      existsSync(capabilityPath),
      false,
      'a capability deve sumir após falha de auditoria'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SIGTERM revoga a capability, sinaliza o grupo conhecido e sai 143', async () => {
  const { dir, bin, egressLog } = setup();
  try {
    stubLiveTree(bin);
    const { child, exited } = spawnRunner({ bin, egressLog });
    assert.ok(
      await waitForFile(join(bin, 'ready.txt')),
      'o stub deve sinalizar prontidão da árvore'
    );
    assert.ok(await waitForFile(join(bin, 'descendant-pid.txt')));
    const npxPid = Number(readFileSync(join(bin, 'npx-pid.txt'), 'utf8'));
    const descendantPid = Number(readFileSync(join(bin, 'descendant-pid.txt'), 'utf8'));
    const capabilityPath = readFileSync(join(bin, 'capability-path.txt'), 'utf8');
    assert.ok(capabilityPath, 'o filho deve registrar a capability antes do sinal');
    assert.equal(existsSync(capabilityPath), true);

    child.kill('SIGTERM');
    const { code } = await exited;
    assert.equal(code, 143, 'SIGTERM deve resultar no código convencional 143');
    assert.equal(
      readFileSync(join(bin, 'cap-at-signal.txt'), 'utf8').trim(),
      'absent',
      'a capability deve ser revogada ANTES do sinal ao grupo conhecido'
    );
    assert.equal(
      await waitForDeath(descendantPid),
      true,
      'o membro do grupo conhecido não sobrevive'
    );
    assert.equal(await waitForDeath(npxPid), true, 'o launcher não sobrevive');
    assert.equal(existsSync(capabilityPath), false, 'a capability deve sumir no caminho de sinal');
  } finally {
    killIfAlive(readRecordedPid(join(bin, 'npx-pid.txt')));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SIGINT revoga a capability e sai 130', async () => {
  const { dir, bin, egressLog } = setup();
  try {
    stubLiveTree(bin);
    const { child, exited } = spawnRunner({ bin, egressLog });
    assert.ok(await waitForFile(join(bin, 'ready.txt')));
    assert.ok(await waitForFile(join(bin, 'descendant-pid.txt')));
    const descendantPid = Number(readFileSync(join(bin, 'descendant-pid.txt'), 'utf8'));
    const capabilityPath = readFileSync(join(bin, 'capability-path.txt'), 'utf8');

    child.kill('SIGINT');
    const { code } = await exited;
    assert.equal(code, 130, 'SIGINT deve resultar no código convencional 130');
    assert.equal(
      await waitForDeath(descendantPid),
      true,
      'o membro do grupo conhecido não sobrevive'
    );
    assert.equal(existsSync(capabilityPath), false, 'a capability deve sumir no caminho de sinal');
  } finally {
    killIfAlive(readRecordedPid(join(bin, 'npx-pid.txt')));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sinais repetidos são idempotentes: uma finalização, capability removida e status 143', async () => {
  const { dir, bin, egressLog } = setup();
  try {
    stubLiveTree(bin);
    const { child, exited } = spawnRunner({ bin, egressLog });
    assert.ok(await waitForFile(join(bin, 'ready.txt')));
    assert.ok(await waitForFile(join(bin, 'descendant-pid.txt')));
    const capabilityPath = readFileSync(join(bin, 'capability-path.txt'), 'utf8');

    child.kill('SIGTERM');
    child.kill('SIGTERM');
    const { code } = await exited;
    assert.equal(code, 143, 'a finalização idempotente preserva o código convencional');
    assert.equal(existsSync(capabilityPath), false, 'a capability é removida uma única vez');
  } finally {
    killIfAlive(readRecordedPid(join(bin, 'npx-pid.txt')));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('espera limitada: filho que ignora SIGTERM não trava o runner', async () => {
  const { dir, bin, egressLog } = setup();
  try {
    stubLiveTree(bin, { ignoreTerm: true });
    const { child, exited } = spawnRunner({ bin, egressLog });
    assert.ok(await waitForFile(join(bin, 'ready.txt')));
    assert.ok(await waitForFile(join(bin, 'descendant-pid.txt')));
    const npxPid = Number(readFileSync(join(bin, 'npx-pid.txt'), 'utf8'));
    const capabilityPath = readFileSync(join(bin, 'capability-path.txt'), 'utf8');
    const started = Date.now();

    child.kill('SIGTERM');
    const { code } = await exited;
    const elapsed = Date.now() - started;
    assert.equal(code, 143, 'o status convencional é preservado mesmo sem fechamento');
    assert.ok(elapsed < 15_000, `o runner deve encerrar dentro da janela limitada (${elapsed}ms)`);
    assert.equal(existsSync(capabilityPath), false, 'a capability é revogada antes de sair');
    // O filho direto que ignora o sinal pode sobreviver (limite best-effort).
    assert.equal(pidAlive(npxPid), true, 'limite documentado: filho que ignora TERM sobrevive');
  } finally {
    killIfAlive(readRecordedPid(join(bin, 'npx-pid.txt')));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('filho já fechado não recebe sinal e nenhum PGID obsoleto é reutilizado', async () => {
  const { dir, bin, egressLog } = setup();
  try {
    stubResidualTree(bin);
    const { exited } = spawnRunner({ bin, egressLog });
    assert.ok(await waitForFile(join(bin, 'ready.txt')));
    assert.ok(await waitForFile(join(bin, 'descendant-pid.txt')));
    const descendantPid = Number(readFileSync(join(bin, 'descendant-pid.txt'), 'utf8'));
    const capabilityPath = readFileSync(join(bin, 'capability-path.txt'), 'utf8');

    const { code } = await exited;
    assert.equal(code, 0, 'a conclusão normal com evidência válida deve passar');
    // O launcher fechou antes da finalização: nenhum kill(-pgid) pode ter saído.
    assert.equal(
      existsSync(join(bin, 'descendant-signaled.txt')),
      false,
      'um PGID de filho fechado nunca pode ser sinalizado'
    );
    assert.equal(pidAlive(descendantPid), true, 'o descendente residual sobrevive (limite aceito)');
    assert.equal(existsSync(capabilityPath), false, 'a capability deve sumir após o run verde');
  } finally {
    killIfAlive(readRecordedPid(join(bin, 'descendant-pid.txt')));
    killIfAlive(readRecordedPid(join(bin, 'npx-pid.txt')));
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
    assert.match(argv, /--config/);
    assert.match(argv, /playwright\.safe\.config\.js/);
    assert.match(argv, /tests\/commercial-queue-integrated\.spec\.js/);
    // The runner must force the guard through npm's own config precedence.
    assert.match(argv, /--node-options/);
    assert.match(argv, /--import .*safe-e2e-network-guard\.mjs/);
    assert.match(argv, /--no-install/);
    // The capability must be removed on the success path.
    const capabilityPath = readFileSync(join(bin, 'capability-path.txt'), 'utf8');
    assert.ok(capabilityPath, 'o filho deve receber o caminho da capability');
    assert.equal(existsSync(capabilityPath), false, 'a capability deve sumir após o run verde');
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
    // The capability must also be removed when Playwright fails.
    const capabilityPath = readFileSync(join(bin, 'capability-path.txt'), 'utf8');
    assert.equal(existsSync(capabilityPath), false, 'a capability deve sumir após falha do run');
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
    // Replace `test --config <file> [...specs]` so the real chain runs quickly
    // (`playwright --version`) while keeping the forced --node-options guard.
    const testIndex = args.indexOf('test');
    args.splice(testIndex, args.length - testIndex, '--version');

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
