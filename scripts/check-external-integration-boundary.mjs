import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const RUNTIME_ROOTS = [resolve(PROJECT_ROOT, 'api/_modules'), resolve(PROJECT_ROOT, 'api/_shared')];

const FORBIDDEN_IMPORTS = /^@vercel\/(?:blob(?:\/client)?|kv)$/;
const PROVIDER_ENV_NAME =
  /^(?:EVOLUTION_[A-Z0-9_]+|OPENROUTER_[A-Z0-9_]+|(?:QUOTATION_)?BLOB_[A-Z0-9_]+|KV_REST_API_(?:URL|TOKEN)|VERCEL_OIDC_TOKEN)$/;
const PROCESS_ENV_ACCESS =
  /\bprocess\s*\.\s*env\s*(?:\.\s*([A-Z][A-Z0-9_]*)|\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\])/g;
const FORBIDDEN_ENDPOINTS = [
  { pattern: /openrouter\.ai\/api\/v1\/chat\/completions/g, target: 'openrouter endpoint' },
];

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

function isRuntimePath(path) {
  return RUNTIME_ROOTS.some((root) => {
    const runtimeRoot = normalizeRepositoryPath(root);
    return path === runtimeRoot || path.startsWith(`${runtimeRoot}/`);
  });
}

function lineNumber(content, index) {
  return content.slice(0, index).split('\n').length;
}

function importsIn(content) {
  const imports = [];
  for (const match of content.matchAll(STATIC_IMPORT_PATTERN)) {
    imports.push({
      index: match.indices?.[1]?.[0] ?? match.index ?? 0,
      specifier: match[4],
    });
  }
  for (const match of content.matchAll(DYNAMIC_IMPORT_PATTERN)) {
    imports.push({ index: match.index ?? 0, specifier: match[2] });
  }
  return imports.sort((left, right) => left.index - right.index);
}

/**
 * @param {readonly BoundarySourceFile[]} files
 * @returns {BoundaryViolation[]}
 */
export function findExternalIntegrationBoundaryViolations(files) {
  const violations = [];
  for (const file of files) {
    const path = normalizeRepositoryPath(file.path);
    if (!isRuntimePath(path)) continue;

    for (const foundImport of importsIn(file.content)) {
      if (FORBIDDEN_IMPORTS.test(foundImport.specifier)) {
        violations.push({
          path,
          line: lineNumber(file.content, foundImport.index),
          target: foundImport.specifier,
        });
      }
    }

    for (const match of file.content.matchAll(PROCESS_ENV_ACCESS)) {
      const name = match[1] || match[2];
      if (PROVIDER_ENV_NAME.test(name)) {
        violations.push({
          path,
          line: lineNumber(file.content, match.index ?? 0),
          target: name,
        });
      }
    }

    for (const { pattern, target } of FORBIDDEN_ENDPOINTS) {
      for (const match of file.content.matchAll(pattern)) {
        violations.push({
          path,
          line: lineNumber(file.content, match.index ?? 0),
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
  const files = RUNTIME_ROOTS.flatMap((root) => collectTypeScriptFiles(root)).map((path) => ({
    path: relative(PROJECT_ROOT, path),
    content: readFileSync(path, 'utf8'),
  }));
  const violations = findExternalIntegrationBoundaryViolations(files);
  for (const violation of violations) {
    console.error(
      `${violation.path}:${violation.line}: direct external integration access: ${violation.target}`
    );
  }
  process.exitCode = violations.length > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
