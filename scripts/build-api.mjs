// API compilation entry point.
//
// The compiler emits .js/.js.map files next to their TypeScript sources
// (api/tsconfig.api.json uses outDir "."), and api/**/*.js is fully generated
// and git-ignored. tsc never deletes emitted output for removed or moved
// sources, so stale neighbor JavaScript could keep participating in runtime
// resolution (app-server, unit tests). Cleaning before each compilation makes
// stale modules impossible instead of relying on discipline.

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
export const API_DIR = join(__dirname, '../api');
const TSC_BIN = join(__dirname, '../node_modules/typescript/bin/tsc');

export function cleanEmittedApiFiles(apiDir = API_DIR) {
  let removed = 0;
  walk(apiDir);
  return removed;

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name.endsWith('.js') || entry.name.endsWith('.js.map')) {
        rmSync(full);
        removed += 1;
      }
    }
  }
}

// ponytail: mtime comparison treats equal timestamps as fresh; false negatives
// would need tsc --build with a tsbuildinfo to fix. Add it if E2E ever exposes
// a stale-source failure.
export function isApiBuildStale(apiDir = API_DIR) {
  let stale = false;
  walk(apiDir);
  return stale;

  function isStalePair(tsFile, jsFile) {
    if (!existsSync(jsFile)) return true;
    try {
      return statSync(jsFile).mtimeMs < statSync(tsFile).mtimeMs;
    } catch {
      return true;
    }
  }

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        if (isStalePair(full, `${full.slice(0, -3)}.js`)) {
          stale = true;
          return;
        }
      } else if (entry.name.endsWith('.js') || entry.name.endsWith('.js.map')) {
        // Output for sources removed or moved elsewhere: no sibling input.
        const jsBase = entry.name.replace(/\.js(\.map)?$/, '');
        if (!existsSync(join(dir, `${jsBase}.ts`)) && !existsSync(join(dir, `${jsBase}.tsx`))) {
          stale = true;
          return;
        }
      }
    }
  }
}

function main() {
  const removed = cleanEmittedApiFiles();
  if (removed > 0) {
    console.log(`[build-api] Saída emitida anterior removida (${removed} arquivos).`);
  }
  const child = spawn(process.execPath, [TSC_BIN, '-p', 'api/tsconfig.api.json'], {
    stdio: 'inherit',
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      console.error(`[build-api] Compilação interrompida por sinal ${signal}`);
      process.exit(1);
    }
    process.exit(code ?? 1);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
