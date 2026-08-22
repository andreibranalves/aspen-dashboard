import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const MODULE_ROOT = resolve(PROJECT_ROOT, 'api/_modules');

const ALLOWED_IMPORTS = {
  'api/_modules/operational-status.ts': {
    'api/_infrastructure/db/client.ts': new Set(['getDatabase']),
    'api/_infrastructure/db/schema.ts': new Set(['appSettings']),
    'drizzle-orm': new Set(['sql']),
  },
  'api/_modules/quotation-preview.ts': {
    'api/_infrastructure/db/client.ts': new Set(['getDatabase']),
  },
  'api/_modules/whatsapp-crm-match.ts': {
    'drizzle-orm': new Set(['and', 'asc', 'desc', 'eq', 'inArray', 'ne', 'or', 'sql']),
    'api/_infrastructure/db/client.ts': new Set(['getDatabase', 'AppDatabase']),
    'api/_infrastructure/db/schema.ts': new Set([
      'clients',
      'crmDeals',
      'quoteLeads',
      'quoteRevisions',
      'quotationDeliveries',
      'quotations',
    ]),
  },
};

const IMPORT_GAP = String.raw`(?:\s|/\*[\s\S]*?\*/|//[^\r\n]*(?:\r?\n|$))*`;
const LEADING_IMPORT_GAP = String.raw`(?:[^\S\r\n]|/\*[\s\S]*?\*/|//[^\r\n]*(?:\r?\n|$))*`;
const STATIC_IMPORT_PATTERN = new RegExp(
  String.raw`^${LEADING_IMPORT_GAP}(import)${IMPORT_GAP}(?:(?:([\s\S]*?)${IMPORT_GAP}from${IMPORT_GAP}))?(['"])([^'"]+)\3${IMPORT_GAP};?`,
  'gmd'
);
const DYNAMIC_IMPORT_PATTERN = new RegExp(
  String.raw`\bimport${IMPORT_GAP}\(${IMPORT_GAP}(['"])([^'"]+)\1${IMPORT_GAP}\)`,
  'gd'
);

/** @typedef {{ path: string, content: string }} BoundarySourceFile */
/** @typedef {{ path: string, line: number, target: string }} BoundaryViolation */

function toPosix(value) {
  return value.replaceAll('\\', '/');
}

function normalizeRepositoryPath(value) {
  return toPosix(relative(PROJECT_ROOT, resolve(PROJECT_ROOT, value)));
}

function canonicalTarget(specifier, importerPath) {
  if (/^drizzle-orm(?:\/|$)/.test(specifier)) return specifier;
  if (/^postgres(?:\/|$)/.test(specifier)) return specifier;
  if (!specifier.startsWith('.')) return null;

  const importerDirectory = dirname(resolve(PROJECT_ROOT, importerPath));
  const resolved = normalizeRepositoryPath(resolve(importerDirectory, specifier));
  const withoutExtension = resolved.replace(/\.(?:js|ts)$/, '');
  if (withoutExtension === 'api/_infrastructure/db/client') {
    return 'api/_infrastructure/db/client.ts';
  }
  if (withoutExtension === 'api/_infrastructure/db/schema') {
    return 'api/_infrastructure/db/schema.ts';
  }
  return null;
}

function lineNumber(content, index) {
  return content.slice(0, index).split('\n').length;
}

function importedBindings(clause) {
  if (!clause) return [];

  let value = clause.trim().replace(/^type\s+/, '');
  const bindings = [];
  const namedStart = value.indexOf('{');
  if (namedStart >= 0) {
    if (namedStart > 0) bindings.push('default');
    const namedEnd = value.lastIndexOf('}');
    const named = value.slice(namedStart + 1, namedEnd >= namedStart ? namedEnd : value.length);
    for (const item of named.split(',')) {
      const imported = item
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        .trim();
      if (imported) bindings.push(imported);
    }
    return bindings;
  }

  if (value.startsWith('*')) return ['*'];
  if (value) bindings.push('default');
  return bindings;
}

function importsIn(content) {
  const imports = [];
  for (const match of content.matchAll(STATIC_IMPORT_PATTERN)) {
    imports.push({
      index: match.indices?.[1]?.[0] ?? match.index ?? 0,
      specifier: match[4],
      bindings: importedBindings(match[2]),
    });
  }
  for (const match of content.matchAll(DYNAMIC_IMPORT_PATTERN)) {
    imports.push({ index: match.index ?? 0, specifier: match[2], bindings: [] });
  }
  return imports.sort((left, right) => left.index - right.index);
}

/**
 * @param {readonly BoundarySourceFile[]} files
 * @returns {BoundaryViolation[]}
 */
export function findPostgresBoundaryViolations(files) {
  const violations = [];
  for (const file of files) {
    const path = normalizeRepositoryPath(file.path);
    const allowedTargets = ALLOWED_IMPORTS[path];
    for (const foundImport of importsIn(file.content)) {
      const target = canonicalTarget(foundImport.specifier, path);
      if (!target) continue;
      const allowedBindings = allowedTargets?.[target];
      const allowed =
        allowedBindings &&
        foundImport.bindings.length > 0 &&
        foundImport.bindings.every((binding) => allowedBindings.has(binding));
      if (!allowed) {
        violations.push({
          path,
          line: lineNumber(file.content, foundImport.index),
          target,
        });
      }
    }
  }

  return violations.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.target.localeCompare(right.target)
  );
}

function collectTypeScriptFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectTypeScriptFiles(path));
    else if (entry.isFile() && path.endsWith('.ts')) files.push(path);
  }
  return files;
}

function runCli() {
  const files = collectTypeScriptFiles(MODULE_ROOT).map((path) => ({
    path: relative(PROJECT_ROOT, path),
    content: readFileSync(path, 'utf8'),
  }));
  const violations = findPostgresBoundaryViolations(files);
  for (const violation of violations) {
    console.error(
      `${violation.path}:${violation.line}: direct PostgreSQL/Drizzle import from ${violation.target}`
    );
  }
  process.exitCode = violations.length > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
