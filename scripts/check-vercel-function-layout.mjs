import { execFileSync } from 'node:child_process';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const FUNCTION_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.cts', '.mts']);

function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function isPrivateApiPath(path) {
  return path
    .split('/')
    .slice(1)
    .some((segment) => segment.startsWith('_'));
}

export function findVercelFunctionViolations(paths) {
  return [...new Set(paths.map(normalizePath))]
    .filter((path) => path.startsWith('api/'))
    .filter((path) => !path.endsWith('.d.ts'))
    .filter((path) => FUNCTION_EXTENSIONS.has(extname(path)))
    .filter((path) => path !== 'api/[...path].ts')
    .filter((path) => !isPrivateApiPath(path))
    .sort();
}

function runCli() {
  const trackedPaths = execFileSync('git', ['ls-files', '--', 'api'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .filter(Boolean);
  const violations = findVercelFunctionViolations(trackedPaths);
  if (violations.length > 0) process.stderr.write(`${violations.join('\n')}\n`);
  process.exitCode = violations.length > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
