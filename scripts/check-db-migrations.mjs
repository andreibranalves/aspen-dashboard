import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));

function normalizePath(value) {
  return value.replaceAll('\\', '/');
}

export function migrationRisk(content) {
  const lines = content.split(/\r?\n/);
  const declarations = lines.filter((line) => /^\s*--\s*migration-risk\s*:/.test(line));
  const firstContent = lines.find((line) => line.trim() !== '')?.trim() || '';
  const match = firstContent.match(/^-- migration-risk: (additive|destructive)$/);
  if (declarations.length !== 1 || !match) return { risk: 'invalid', valid: false };
  return { risk: match[1], valid: true };
}

export function parseNameStatus(raw) {
  const fields = String(raw || '').split('\0');
  const changes = [];
  let index = 0;

  while (index < fields.length) {
    const status = fields[index++];
    if (!status) continue;

    const renamedOrCopied = status.startsWith('R') || status.startsWith('C');
    const previousPath = renamedOrCopied ? fields[index++] : null;
    const path = fields[index++];
    if (!path) continue;

    changes.push({
      path: normalizePath(path),
      previousPath: previousPath ? normalizePath(previousPath) : null,
      status,
    });
  }

  return changes;
}

function gitArgs(baseRef) {
  return [
    'diff',
    '--name-status',
    '-z',
    '--find-renames',
    '--find-copies',
    '--find-copies-harder',
    baseRef,
    '--',
    'drizzle/*.sql',
  ];
}

function untrackedChanges(raw) {
  return String(raw || '')
    .split('\0')
    .filter(Boolean)
    .map((file) => ({ path: normalizePath(file), previousPath: null, status: 'A' }));
}

function changeKey(change) {
  return `${change.status}\0${change.previousPath || ''}\0${change.path}`;
}

function collectChanges(executeGit, baseRef) {
  const changes = parseNameStatus(executeGit(gitArgs(baseRef)));
  const seen = new Set(changes.map(changeKey));

  for (const change of untrackedChanges(
    executeGit(['ls-files', '--others', '--exclude-standard', '-z', '--', 'drizzle/*.sql']),
  )) {
    if (seen.has(changeKey(change))) continue;
    changes.push(change);
    seen.add(changeKey(change));
  }

  return changes;
}

export function runMigrationCheck({
  projectRoot = process.cwd(),
  baseRef,
  executeGit,
  readContent,
  now = () => new Date(),
}) {
  const root = path.resolve(projectRoot);
  const runGit =
    executeGit ||
    ((args) =>
      execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }));
  const read = readContent || ((file) => readFileSync(path.resolve(root, file), 'utf8'));
  const ref = String(baseRef || 'HEAD').trim() || 'HEAD';
  const commit = String(runGit(['rev-parse', '--short', 'HEAD'])).trim();
  const timestamp = now().toISOString();
  const changes = collectChanges(runGit, ref);
  const violations = [];
  const assessments = [];

  for (const change of changes) {
    if (change.status !== 'A') {
      assessments.push({ ...change, risk: 'historical', result: 'FAIL' });
      violations.push({ ...change, reason: 'historical-change' });
      continue;
    }

    const classification = migrationRisk(read(change.path));
    const risk = classification.valid ? classification.risk : 'invalid';
    const result = classification.valid ? 'PASS' : 'FAIL';
    assessments.push({ ...change, risk, result });
    if (!classification.valid) violations.push({ ...change, reason: 'invalid-risk' });
  }

  return { commit, timestamp, changes, violations, assessments };
}

export function formatMigrationCheck(result) {
  const lines = [`commit: ${result.commit}`, `timestamp: ${result.timestamp}`];
  if (result.assessments.length === 0) {
    lines.push('PASS migrations: nenhuma mudança');
    return lines.join('\n');
  }

  for (const assessment of result.assessments) {
    lines.push(
      `${assessment.result} ${assessment.path} status=${assessment.status} risk=${assessment.risk} result=${assessment.result}`,
    );
  }
  return lines.join('\n');
}

function runCli() {
  try {
    const result = runMigrationCheck({
      projectRoot: PROJECT_ROOT,
      baseRef: process.env.MIGRATION_BASE_REF?.trim() || 'HEAD',
    });
    process.stdout.write(`${formatMigrationCheck(result)}\n`);
    process.exitCode = result.violations.length > 0 ? 1 : 0;
  } catch {
    process.stderr.write(
      `timestamp: ${new Date().toISOString()}\nFAIL check de migrations: não foi possível inspecionar o diff Git.\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
