// Rewrites relative import specifiers and path strings after moving source files.
// Usage: node scripts/rewrite-imports.mjs <mapping.json>
// mapping.json: { "api/modules/x.ts": "api/infrastructure/db/repositories/x.ts", ... } (repo-root relative)
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const mapPath = process.argv[2];
if (!mapPath) {
  console.error('uso: node scripts/rewrite-imports.mjs <mapping.json>');
  process.exit(1);
}
const MAP = JSON.parse(readFileSync(mapPath, 'utf8'));
const ROOT = process.cwd();

const files = execSync(
  "git ls-files '*.ts' '*.tsx' '*.mjs' '*.js' ':!public/**' ':!drizzle/**'",
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .filter(Boolean);
const fileSet = new Set(files);

function splitQuery(spec) {
  const m = spec.match(/^([^?#]*)([?#].*)?$/);
  return { pathname: m[1], query: m[2] ?? '' };
}

// Resolve a relative specifier from the OLD importer dir to an existing source file.
function resolveOld(baseDirOld, spec) {
  const { pathname } = splitQuery(spec);
  const p = resolve(baseDirOld, pathname);
  const candidates = [
    p,
    p.replace(/\.js$/, '.ts'),
    p.replace(/\.ts$/, '.js'),
    p + '.ts',
    p + '.js',
    p + '/index.ts',
    p + '/index.js',
  ];
  for (const cand of candidates) {
    const rel = relative(ROOT, cand);
    if (fileSet.has(rel) || fileSet.has(rel.replace(/\\/g, '/'))) return rel;
  }
  return null;
}

let renames = 0;
let rewrites = 0;
for (const f of files) {
  const moved = MAP[f] ? resolve(ROOT, MAP[f]) : null;
  const baseDirOld = dirname(resolve(ROOT, f));
  const baseDirNew = moved ? dirname(moved) : baseDirOld;
  let text = readFileSync(f, 'utf8');
  const original = text;

  // 1) relative import/export specifiers (static, side-effect and dynamic)
  text = text.replace(
    /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+(?:type\s+)?)(['"])(\.[^'"]*?)\2/g,
    (m, pre, q, spec) => {
      const targetOld = resolveOld(baseDirOld, spec);
      if (!targetOld) return m;
      const targetNew = MAP[targetOld] ?? targetOld;
      // Relative path WITHOUT extension; the specifier's own suffix is re-appended.
      const extless = targetNew.replace(/\.(?:ts|js|mjs)$/, '');
      const rel = relative(baseDirNew, resolve(ROOT, extless)).replace(/\\/g, '/');
      const norm = rel.startsWith('.') ? rel : './' + rel;
      // Suffix and query come from the pathname, not the full specifier (query may trail).
      const { pathname, query } = splitQuery(spec);
      const suffix = pathname.endsWith('.mjs')
        ? '.mjs'
        : pathname.endsWith('.ts')
          ? '.ts'
          : pathname.endsWith('.js')
            ? '.js'
            : '';
      const replaced = pre + q + norm + suffix + query + q;
      if (replaced !== m) {
        rewrites++;
        return replaced;
      }
      return m;
    },
  );

  // 2) string literals pointing exactly at a moved file (readFileSync in tests)
  text = text.replace(
    /(['"])((?:api\/)?[a-z0-9_\-/]+\.(?:ts|mjs|js))(['"])/g,
    (m, q1, pth, q2) => {
      const key = pth.startsWith('api/') ? pth : 'api/' + pth;
      if (MAP[key]) {
        rewrites++;
        return q1 + MAP[key] + q2;
      }
      return m;
    },
  );

  if (text !== original) writeFileSync(f, text);
  if (moved) {
    mkdirSync(dirname(moved), { recursive: true });
    renameSync(f, moved);
    renames++;
  }
}
console.log(`renames: ${renames}, rewrites: ${rewrites}`);
