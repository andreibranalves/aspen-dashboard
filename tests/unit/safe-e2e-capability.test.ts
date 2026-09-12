import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { SAFE_E2E_RUN_ID_VAR, SAFE_E2E_SPECS } from '../../scripts/lib/safe-e2e-env.mjs';
import {
  assertSafeE2eCapability,
  createSafeE2eCapability,
  deleteSafeE2eCapability,
  isSafeE2eCapabilityValid,
  SAFE_E2E_CAPABILITY_PATH_VAR,
  SAFE_E2E_CAPABILITY_PROOF_VAR,
} from '../../scripts/lib/safe-e2e-capability.mjs';

function envFor(capability, overrides = {}) {
  return {
    [SAFE_E2E_RUN_ID_VAR]: capability.runId,
    [SAFE_E2E_CAPABILITY_PATH_VAR]: capability.path,
    [SAFE_E2E_CAPABILITY_PROOF_VAR]: capability.proof,
    ...overrides,
  };
}

test('createSafeE2eCapability grava arquivo/dir privados e nunca a prova em claro', () => {
  const parent = mkdtempSync(join(tmpdir(), 'cap-unit-'));
  const capability = createSafeE2eCapability({ runId: 'run-1', dir: parent });
  try {
    assert.equal(lstatSync(capability.path).mode & 0o777, 0o600);
    assert.equal(lstatSync(capability.dir).mode & 0o777, 0o700);
    const raw = readFileSync(capability.path, 'utf8');
    assert.equal(raw.includes(capability.proof), false, 'a prova não pode estar em claro');
    assert.equal(isSafeE2eCapabilityValid(envFor(capability)), true);
    const parsed = assertSafeE2eCapability(envFor(capability));
    assert.equal(parsed.runId, 'run-1');
    assert.deepEqual(parsed.specs, [...SAFE_E2E_SPECS]);
  } finally {
    deleteSafeE2eCapability(capability);
    rmSync(parent, { recursive: true, force: true });
  }
});

test('prova errada, runId divergente e formato malformado lançam', () => {
  const parent = mkdtempSync(join(tmpdir(), 'cap-unit-'));
  const capability = createSafeE2eCapability({ runId: 'run-2', dir: parent });
  try {
    assert.throws(
      () =>
        assertSafeE2eCapability(
          envFor(capability, { [SAFE_E2E_CAPABILITY_PROOF_VAR]: 'b'.repeat(64) })
        ),
      /prova inválida/
    );
    assert.throws(
      () => assertSafeE2eCapability(envFor(capability, { [SAFE_E2E_RUN_ID_VAR]: 'other' })),
      /runId divergente/
    );
    writeFileSync(capability.path, 'not-json', { mode: 0o600 });
    assert.throws(() => assertSafeE2eCapability(envFor(capability)), /malformada/);
  } finally {
    deleteSafeE2eCapability(capability);
    rmSync(parent, { recursive: true, force: true });
  }
});

test('capability expirada e permissões públicas lançam', () => {
  const parent = mkdtempSync(join(tmpdir(), 'cap-unit-'));
  const expired = createSafeE2eCapability({ runId: 'run-3', dir: parent, ttlMs: 1 });
  const publicCap = createSafeE2eCapability({ runId: 'run-4', dir: parent });
  try {
    const deadline = Date.now() + 500;
    while (Date.now() < deadline) {
      try {
        assertSafeE2eCapability(envFor(expired));
      } catch (error) {
        assert.match(String(error.message), /expirada/);
        break;
      }
    }
    chmodSync(publicCap.path, 0o644);
    assert.throws(() => assertSafeE2eCapability(envFor(publicCap)), /permissões não privadas/);
  } finally {
    deleteSafeE2eCapability(expired);
    deleteSafeE2eCapability(publicCap);
    rmSync(parent, { recursive: true, force: true });
  }
});

test('link simbólico no lugar da capability é recusado', () => {
  const parent = mkdtempSync(join(tmpdir(), 'cap-unit-'));
  const target = join(parent, 'real.json');
  writeFileSync(target, '{}', { mode: 0o600 });
  const link = join(parent, 'link.json');
  symlinkSync(target, link);
  try {
    assert.throws(
      () =>
        assertSafeE2eCapability({
          [SAFE_E2E_RUN_ID_VAR]: 'run-5',
          [SAFE_E2E_CAPABILITY_PATH_VAR]: link,
          [SAFE_E2E_CAPABILITY_PROOF_VAR]: 'c'.repeat(64),
        }),
      /link simbólico/
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('deleteSafeE2eCapability remove o diretório e é idempotente', () => {
  const parent = mkdtempSync(join(tmpdir(), 'cap-unit-'));
  const capability = createSafeE2eCapability({ runId: 'run-6', dir: parent });
  deleteSafeE2eCapability(capability);
  assert.equal(existsSync(capability.dir), false);
  deleteSafeE2eCapability(capability);
  deleteSafeE2eCapability(undefined);
  rmSync(parent, { recursive: true, force: true });
});
