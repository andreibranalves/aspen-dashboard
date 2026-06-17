// migrate-tokens.mjs — bulk replace framer/shadcn token classes → Alpine vocabulary
import { readFileSync, writeFileSync } from 'fs';
import { walk } from './scripts/walk.mjs' ;
import { join, dirname } from 'path';

const root = 'src';

// Simple recursive walk for .jsx/.js files
function walkDir(dir) {
  const fs = await import('fs');
  // inline version
  const out = [];
  const { readdirSync, statSync } = await import('fs');
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkDir(p));
    else if (/\.(js|jsx)$/.test(ent.name)) out.push(p);
  }
  return out;
}
