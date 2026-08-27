import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cleanEmittedApiFiles, isApiBuildStale } from '../../scripts/build-api.mjs';

test('cleanEmittedApiFiles removes all emitted js and maps, keeping sources', () => {
  const apiDir = mkdtempSync(path.join(tmpdir(), 'api-build-clean-'));
  try {
    // Emitted artifacts (git-ignored in the real repo): flat and nested.
    mkdirSync(path.join(apiDir, '_http'));
    writeFileSync(path.join(apiDir, 'index.js'), '');
    writeFileSync(path.join(apiDir, 'index.js.map'), '');
    writeFileSync(path.join(apiDir, '_http', 'node-adapter.js'), '');
    writeFileSync(path.join(apiDir, '_http', 'node-adapter.js.map'), '');

    // Stale emission for a REMOVED source: no matching .ts exists. This is the
    // regression class this cleaning exists to prevent: a deleted or moved
    // TypeScript file must not survive through its old neighbor JavaScript,
    // because runtime resolution would keep using it.
    writeFileSync(path.join(apiDir, '_legacy-cutover.js'), '');

    // Hand-maintained source material must never be touched.
    writeFileSync(path.join(apiDir, 'config.json'), '{}');
    writeFileSync(path.join(apiDir, 'handler.ts'), '');

    const removed = cleanEmittedApiFiles(apiDir);

    assert.equal(removed, 5);
    assert.deepEqual(readdirSync(apiDir), ['_http', 'config.json', 'handler.ts']);
    assert.equal(existsSync(path.join(apiDir, '_legacy-cutover.js')), false);
    assert.equal(existsSync(path.join(apiDir, '_http', 'node-adapter.js')), false);
  } finally {
    rmSync(apiDir, { recursive: true, force: true });
  }
});

function createSourceAndOutput(apiDir) {
  const tsFile = path.join(apiDir, 'handler.ts');
  writeFileSync(tsFile, '');
  const jsFile = path.join(apiDir, 'handler.js');
  // Emitted output must be strictly fresher than its source.
  const future = new Date(Date.now() + 60000);
  writeFileSync(jsFile, '');
  utimesSync(jsFile, future, future);
  return { tsFile, jsFile };
}

test('isApiBuildStale is false for fresh, complete output', () => {
  const apiDir = mkdtempSync(path.join(tmpdir(), 'api-stale-'));
  try {
    createSourceAndOutput(apiDir);
    assert.equal(isApiBuildStale(apiDir), false);
  } finally {
    rmSync(apiDir, { recursive: true, force: true });
  }
});

test('isApiBuildStale detects missing output and output older than source', () => {
  const apiDir = mkdtempSync(path.join(tmpdir(), 'api-stale-'));
  try {
    const { tsFile, jsFile } = createSourceAndOutput(apiDir);

    rmSync(jsFile);
    assert.equal(isApiBuildStale(apiDir), true, 'missing output must be stale');

    writeFileSync(jsFile, '');
    // Deterministically make the source fresher than the output.
    utimesSync(tsFile, new Date(Date.now() + 120000), new Date(Date.now() + 120000));
    assert.equal(isApiBuildStale(apiDir), true, 'output older than source must be stale');
  } finally {
    rmSync(apiDir, { recursive: true, force: true });
  }
});

test('isApiBuildStale flags orphaned output for removed or moved sources', () => {
  const apiDir = mkdtempSync(path.join(tmpdir(), 'api-stale-'));
  try {
    const { tsFile, jsFile } = createSourceAndOutput(apiDir);

    // Deleted/moved source: emitted JavaScript must not survive on its own,
    // otherwise deleted or moved TypeScript keeps surviving through stale
    // neighbor JavaScript in runtime resolution (AC 1).
    rmSync(tsFile);
    assert.equal(isApiBuildStale(apiDir), true);

    rmSync(jsFile);
    assert.equal(isApiBuildStale(apiDir), false, 'only sources left: not stale');
  } finally {
    rmSync(apiDir, { recursive: true, force: true });
  }
});
