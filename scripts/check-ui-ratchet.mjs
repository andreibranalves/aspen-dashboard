// Catraca de UI: contagens que só podem cair. Ao reduzir, atualize o limite no mesmo PR.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src/features', 'src/app'];
const RATCHETS = [
  {
    name: 'margem vertical em filhos (prefira gap/space-y no pai)',
    pattern: /(?<![\w:-])-?m[tby]-(?!auto\b)[\d.]+(?![\w.-])/g,
    limit: 270,
  },
  {
    name: 'superfície de card montada à mão (use Card)',
    pattern: /(?<![\w-])rounded-card(?![\w-])/g,
    limit: 72,
  },
  {
    name: '<label> cru (use Field)',
    pattern: /<label\b/g,
    limit: 128,
  },
  {
    name: 'valor arbitrário do Tailwind (use tokens de layout)',
    pattern: /(?<![\w:-])[\w:-]*[a-z]-\[[^\]\s]+\](?!:)/g,
    limit: 105,
  },
  {
    name: 'text-xs solto (use Text ou Field)',
    pattern: /(?<![\w:-])text-xs(?![\w-])/g,
    limit: 278,
  },
];

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (path.endsWith('.tsx')) yield path;
  }
}

const sources = ROOTS.flatMap((root) => [...files(root)].map((path) => readFileSync(path, 'utf8')));
let failed = false;
for (const { name, pattern, limit } of RATCHETS) {
  const count = sources.reduce((sum, source) => sum + (source.match(pattern)?.length ?? 0), 0);
  if (count > limit) {
    console.error(`FAIL ${name}: ${count} > limite ${limit}.`);
    failed = true;
  } else if (count < limit) {
    console.error(`FAIL ${name}: caiu para ${count}; baixe o limite em scripts/check-ui-ratchet.mjs.`);
    failed = true;
  } else {
    console.log(`PASS ${name}: ${count}`);
  }
}
process.exitCode = failed ? 1 : 0;
