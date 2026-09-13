#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { classifyChangedPaths, parseNameStatusZ } from './lib/ci-change-classifier.mjs';

const base = String(process.env.BASE_SHA || '').trim();
const head = String(process.env.HEAD_SHA || 'HEAD').trim();

if (!base) {
  process.stderr.write('BASE_SHA é obrigatório para classificar o diff do CI.\n');
  process.exit(1);
}

const diff = spawnSync(
  'git',
  ['diff', '--name-status', '-z', '--find-renames', `${base}...${head}`],
  {
    encoding: 'utf8',
  }
);
if (diff.status !== 0) {
  process.stderr.write('Não foi possível ler o diff Git do pull request.\n');
  process.exit(diff.status ?? 1);
}

let result;
try {
  result = classifyChangedPaths(parseNameStatusZ(diff.stdout));
} catch {
  process.stderr.write('Diff Git inválido para classificação conservadora.\n');
  process.exit(1);
}

const output = `code=${result.code}\ndocs_only=${result.docsOnly}\n`;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
process.stdout.write(
  `changed=${result.changedPaths.length} code=${result.code} docs_only=${result.docsOnly}\n`
);
