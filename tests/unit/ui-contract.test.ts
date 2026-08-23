import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');

const canonicalLight = {
  page: '255 255 255',
  surface: '255 255 255',
  'surface-subtle': '250 250 250',
  'surface-hover': '247 247 248',
  'surface-selected': '244 247 252',
  'border-subtle': '237 237 237',
  'border-default': '226 226 229',
  'border-strong': '209 209 214',
  'text-primary': '24 24 27',
  'text-secondary': '82 82 91',
  'text-tertiary': '113 113 122',
  'text-disabled': '161 161 170',
  primary: '22 92 216',
  'on-primary': '255 255 255',
  success: '26 122 76',
  warning: '154 91 19',
  destructive: '184 58 57',
  info: '22 92 216',
};

const canonicalDark = {
  page: '15 20 32',
  surface: '20 26 38',
  'surface-subtle': '26 34 48',
  'surface-hover': '32 42 58',
  'surface-selected': '29 45 74',
  'border-subtle': '37 47 64',
  'border-default': '51 64 86',
  'border-strong': '70 84 108',
  'text-primary': '242 245 250',
  'text-secondary': '180 191 208',
  'text-tertiary': '142 157 181',
  'text-disabled': '102 116 138',
  primary: '47 111 219',
  'on-primary': '255 255 255',
  success: '52 199 126',
  warning: '240 168 87',
  destructive: '226 105 106',
  info: '111 156 236',
};

function readThemeDeclarations(css: string, selector: string): Record<string, string> {
  const block = css.match(new RegExp(`${selector.replace('.', '\\.') }\\s*\\{([\\s\\S]*?)\\n  \\}`))?.[1];
  assert.ok(block, `missing ${selector} token block`);
  return Object.fromEntries(
    [...block.matchAll(/^\s*--([\w-]+):\s*([^;]+);/gm)].map(([, name, value]) => [name, value.trim()]),
  );
}

describe('Aspen UI v2 visual contract', () => {
  it('defines the approved light and dark semantic colors exactly', () => {
    const css = read('src/index.css');
    const light = readThemeDeclarations(css, ':root');
    const dark = readThemeDeclarations(css, '.dark');

    for (const [name, value] of Object.entries(canonicalLight)) {
      assert.equal(light[name], value, `light --${name}`);
    }
    for (const [name, value] of Object.entries(canonicalDark)) {
      assert.equal(dark[name], value, `dark --${name}`);
    }
  });

  it('keeps compatibility aliases pointed at the canonical semantic tokens', () => {
    const css = read('src/index.css');
    for (const [alias, canonical] of [
      ['surface-muted', 'surface-subtle'],
      ['line', 'border-default'],
      ['fg', 'text-primary'],
      ['fg-muted', 'text-secondary'],
      ['on-solid', 'on-primary'],
    ]) {
      assert.match(css, new RegExp(`--${alias}:\\s*var\\(--${canonical}\\)`));
    }
  });

  it('uses only the canonical radius names and keeps the reference docs versioned', () => {
    const tailwind = read('tailwind.config.js');
    const source = read('src/index.css');
    assert.match(tailwind, /borderRadius:\s*\{[\s\S]*xs:[^\n]*4px[\s\S]*sm:[^\n]*6px[\s\S]*md:[^\n]*8px[\s\S]*lg:[^\n]*12px[\s\S]*full:[^\n]*9999px/);
    assert.doesNotMatch(tailwind, /(?:xl|2xl|3xl|pill):/);
    assert.doesNotMatch(`${source}\n${readSourceFiles()}`, /rounded-(?:xl|2xl|3xl|pill)|rounded-\[[^\]]+\]/);
    assert.equal(existsSync(path.join(root, 'docs/design/DESIGN-aspen.md')), true);
    assert.equal(existsSync(path.join(root, 'docs/design/DESIGN-supabase.md')), true);
  });

  it('keeps foundation primitive contracts aligned with the approved dimensions', () => {
    const button = read('src/components/ui/button.tsx');
    const input = read('src/components/ui/input.tsx');
    const select = read('src/components/ui/select.tsx');
    const table = read('src/components/ui/table.tsx');
    const emptyState = read('src/components/shared/EmptyState.tsx');

    assert.match(button, /rounded-sm/);
    assert.match(button, /h-7/);
    assert.match(button, /h-8/);
    assert.match(button, /h-9/);
    assert.match(button, /h-10/);
    assert.match(button, /md: 'h-9/);
    assert.match(input, /h-9/);
    assert.match(input, /rounded-sm/);
    assert.match(select, /h-9/);
    assert.match(select, /rounded-sm/);
    assert.doesNotMatch(table, /shadow-sm/);
    assert.match(emptyState, /export (?:default|function|interface)/);
  });
});

function readSourceFiles(): string {
  return [
    read('src/components/ui/button.tsx'),
    read('src/components/ui/input.tsx'),
    read('src/components/ui/select.tsx'),
    read('src/components/ui/table.tsx'),
    read('src/components/shared/EmptyState.tsx'),
  ].join('\n');
}
