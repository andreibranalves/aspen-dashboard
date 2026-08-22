#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const PROJECT_ROOT = resolve(new URL('..', import.meta.url).pathname);
const TAG_PATTERN = /^aspen-lite-baseline-[0-9]{8}$/;

export function parseBaselineArgs(argv) {
  const args = { tag: '', push: false, evidence: '', backup: '', restore: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--tag') args.tag = String(argv[++index] || '').trim();
    else if (arg === '--push') args.push = true;
    else if (arg === '--evidence') args.evidence = String(argv[++index] || '').trim();
    else if (arg === '--backup') args.backup = String(argv[++index] || '').trim();
    else if (arg === '--restore') args.restore = String(argv[++index] || '').trim();
    else throw new Error(`Opção desconhecida: ${arg}`);
  }
  if (args.tag && !TAG_PATTERN.test(args.tag)) throw new Error('Tag deve usar aspen-lite-baseline-YYYYMMDD.');
  if (args.push && !args.tag) throw new Error('--push exige --tag.');
  return args;
}

function assertOutsideCheckout(filepath) {
  const absolute = resolve(filepath);
  if (absolute === PROJECT_ROOT || absolute.startsWith(`${PROJECT_ROOT}/`)) {
    throw new Error('Backup e evidência devem ficar fora do checkout.');
  }
  return absolute;
}

function assertProtectedFile(filepath, label) {
  const target = assertOutsideCheckout(filepath);
  let stat;
  try { stat = lstatSync(target); } catch { throw new Error(`${label} não encontrado.`); }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) {
    throw new Error(`${label} deve ser arquivo regular com permissão 0600.`);
  }
  return target;
}

function command(file, args) {
  return execFileSync(file, args, { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function createBaselineTag(tag, { push = false } = {}) {
  if (!TAG_PATTERN.test(tag)) throw new Error('Tag deve usar aspen-lite-baseline-YYYYMMDD.');
  if (command('git', ['status', '--porcelain'])) throw new Error('Checkout deve estar limpo antes de criar o baseline.');
  command('git', ['tag', tag]);
  if (push) command('git', ['push', 'origin', `refs/tags/${tag}`]);
  return tag;
}

export function writeBaselineEvidence(filepath, evidence) {
  const target = assertOutsideCheckout(filepath);
  const directory = dirname(target);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (existsSync(target)) throw new Error('Arquivo de evidência já existe.');
  writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  chmodSync(target, 0o600);
  const stat = lstatSync(target);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) throw new Error('Evidência deve ser arquivo regular com permissão 0600.');
  return target;
}

export function baselineProcedure({ tag, backup, restore, evidence }) {
  if (!tag || !TAG_PATTERN.test(tag)) throw new Error('Informe --tag aspen-lite-baseline-YYYYMMDD.');
  if (!backup || !restore) throw new Error('Informe os caminhos externos de backup e restauração validados.');
  const backupPath = assertProtectedFile(backup, 'Backup externo');
  const restorePath = assertProtectedFile(restore, 'Evidência de restauração');
  const result = { tag, backup: backupPath, restore: restorePath, checkedAt: new Date().toISOString() };
  if (evidence) result.evidence = writeBaselineEvidence(evidence, result);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    const args = parseBaselineArgs(process.argv.slice(2));
    if (!args.tag) {
      process.stdout.write('Use uma tag aspen-lite-baseline-YYYYMMDD e valide backup/restauração fora do checkout.\n');
    } else {
      if (!args.backup || !args.restore) throw new Error('--tag exige --backup e --restore validados fora do checkout.');
      const result = baselineProcedure({ ...args, evidence: '' });
      createBaselineTag(args.tag, { push: args.push });
      if (args.evidence) writeBaselineEvidence(args.evidence, result);
      process.stdout.write(`Tag criada: ${args.tag}${args.push ? ' e publicada' : ''}.\n`);
      process.stdout.write(`Baseline verificado: ${result.checkedAt}.\n`);
    }
  } catch (error) {
    process.stderr.write(`FAIL baseline Aspen Lite: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
