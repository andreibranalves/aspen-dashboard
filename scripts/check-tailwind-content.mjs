import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

const configText = await readFile(new URL('../tailwind.config.js', import.meta.url), 'utf8');
const contentMatch = configText.match(/content\s*:\s*\[([\s\S]*?)\]/m);

assert.ok(contentMatch, 'tailwind.config.js must define a content array');

const content = contentMatch[1];

assert.match(content, /src/, 'tailwind.config.js content must scan src/');
assert.match(content, /tsx/, 'tailwind.config.js content must include tsx files');
assert.match(content, /ts/, 'tailwind.config.js content must include ts files');

console.log('✓ Tailwind content config scans TypeScript source files');
