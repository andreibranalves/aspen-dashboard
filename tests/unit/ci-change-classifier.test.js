import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyChangedPaths, parseNameStatusZ } from '../../scripts/lib/ci-change-classifier.mjs';

test('classifica somente documentação conhecida como docs-only', () => {
  assert.deepEqual(classifyChangedPaths(['AGENTS.md', 'docs/release-lanes.md']), {
    code: false,
    docsOnly: true,
    changedPaths: ['AGENTS.md', 'docs/release-lanes.md'],
  });
});

test('glossário de domínio é docs-only sem dispensar CI para código misturado', () => {
  assert.equal(classifyChangedPaths(['CONTEXT.md']).docsOnly, true);
  const mixed = classifyChangedPaths(['CONTEXT.md', 'src/app/App.tsx']);
  assert.equal(mixed.code, true);
  assert.equal(mixed.docsOnly, false);
});

test('arquivo desconhecido, configuração e markdown executável são código', () => {
  for (const paths of [
    ['notes.md'],
    ['scripts/check-docs.md'],
    ['package.json'],
    ['.github/workflows/ci.yml'],
  ]) {
    assert.equal(classifyChangedPaths(paths).code, true, paths.join(','));
    assert.equal(classifyChangedPaths(paths).docsOnly, false, paths.join(','));
  }
});

test('mistura de documentação e código roda as lanes de código', () => {
  const result = classifyChangedPaths(['docs/release-lanes.md', 'src/app/App.tsx']);
  assert.equal(result.code, true);
  assert.equal(result.docsOnly, false);
});

test('renomeação preserva a origem e o destino, inclusive com nomes especiais', () => {
  const paths = parseNameStatusZ('R100\0docs/old\tname.md\0docs/new\nname.md\0M\0docs/other.md\0');
  assert.deepEqual(paths, ['docs/old\tname.md', 'docs/new\nname.md', 'docs/other.md']);
  assert.equal(classifyChangedPaths(paths).docsOnly, true);
});

test('renomeação entre documentação e script não é docs-only', () => {
  const paths = parseNameStatusZ('R100\0docs/runbook.md\0scripts/runbook.mjs\0');
  assert.equal(classifyChangedPaths(paths).code, true);
});
