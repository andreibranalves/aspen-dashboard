import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');

const canonicalLight = {
  page: '247 248 250',
  surface: '255 255 255',
  'surface-subtle': '250 250 250',
  'surface-hover': '247 247 248',
  'surface-selected': '231 240 255',
  'border-subtle': '237 237 237',
  'border-default': '226 226 229',
  'border-strong': '209 209 214',
  'text-primary': '24 24 27',
  'text-secondary': '82 82 91',
  'text-tertiary': '102 102 111',
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
  'text-primary': '255 255 255',
  'text-secondary': '181 191 206',
  'text-tertiary': '146 158 176',
  'text-disabled': '102 116 138',
  primary: '47 111 219',
  'on-primary': '255 255 255',
  success: '52 199 126',
  warning: '240 168 87',
  destructive: '226 105 106',
  info: '111 156 236',
};

function readThemeDeclarations(css: string, selector: string): Record<string, string> {
  const block = css.match(
    new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\n  \\}`)
  )?.[1];
  assert.ok(block, `missing ${selector} token block`);
  return Object.fromEntries(
    [...block.matchAll(/^\s*--([\w-]+):\s*([^;]+);/gm)].map(([, name, value]) => [
      name,
      value.trim(),
    ])
  );
}

function relativeLuminance(rgb: string): number {
  const channels = rgb.split(' ').map((channel) => Number(channel) / 255);
  return channels
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
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

  it('keeps shell chrome on the approved dark foundation in both themes', () => {
    const css = read('src/index.css');
    assert.match(css, /--shell:\s*15 20 32/);
    assert.doesNotMatch(css, /--shell:\s*var\(--surface\)/);
  });

  it('uses only the canonical radius names and keeps the reference docs versioned', () => {
    const tailwind = read('tailwind.config.js');
    const source = read('src/index.css');
    assert.match(
      tailwind,
      /borderRadius:\s*\{[\s\S]*xs:[^\n]*4px[\s\S]*sm:[^\n]*6px[\s\S]*md:[^\n]*8px[\s\S]*lg:[^\n]*12px[\s\S]*full:[^\n]*9999px/
    );
    assert.doesNotMatch(tailwind, /(?:xl|2xl|3xl|pill):/);
    assert.doesNotMatch(
      `${source}\n${readSourceFiles()}`,
      /rounded(?:-[trblse]{1,2})?-(?:xl|2xl|3xl|pill|\[[^\]]+\])/
    );
    assert.equal(existsSync(path.join(root, 'docs/design/DESIGN-aspen.md')), true);
    assert.equal(existsSync(path.join(root, 'docs/design/DESIGN-supabase.md')), true);
  });

  it('keeps shared floating action chrome within the canonical radius scale', () => {
    const bulkActionBar = read('src/components/shared/BulkActionBar.tsx');
    assert.match(bulkActionBar, /rounded-t-lg/);
    assert.doesNotMatch(bulkActionBar, /rounded-t-(?:xl|2xl|3xl|pill|\[[^\]]+\])/);
  });

  it('keeps semantic action labels and focus indicators at the canonical contrast floor', () => {
    const button = read('src/components/ui/button.tsx');
    const input = read('src/components/ui/input.tsx');
    const select = read('src/components/ui/select.tsx');
    const css = read('src/index.css');
    const uiSource = readSourceFiles();

    assert.match(button, /bg-success text-on-solid dark:text-page/);
    assert.match(button, /bg-destructive text-on-solid dark:text-page/);
    assert.ok(contrastRatio(canonicalDark.success, canonicalDark.page) >= 4.5);
    assert.ok(contrastRatio(canonicalDark.destructive, canonicalDark.page) >= 4.5);

    assert.match(css, /\*:focus-visible \{[\s\S]*outline: 2px solid rgb\(var\(--primary\)\);/);
    for (const source of [button, input, select]) {
      assert.match(source, /focus-visible:ring-\d+ focus-visible:ring-primary(?:\s|['"])/);
      assert.doesNotMatch(source, /focus-visible:ring-primary\/\d+/);
    }
    assert.doesNotMatch(uiSource, /focus-visible:ring-primary\/\d+/);
    assert.ok(contrastRatio(canonicalLight.primary, canonicalLight.page) >= 3);
    assert.ok(contrastRatio(canonicalDark.primary, canonicalDark.page) >= 3);
  });

  it('keeps LoginPage branding on canonical semantic tokens', () => {
    const loginPage = read('src/app/LoginPage.tsx');
    const tailwind = read('tailwind.config.js');
    assert.match(loginPage, /bg-primary/);
    assert.match(loginPage, /text-primary-foreground/);
    assert.doesNotMatch(loginPage, /text-on-primary/);
    assert.match(tailwind, /primary:\s*\{[\s\S]*foreground:\s*'rgb\(var\(--on-primary\)\)'/);
    assert.doesNotMatch(loginPage, /accent-(?:ice|twilight)/);
  });

  it('keeps hand-styled native selects on the canonical 6px radius', () => {
    const offenders = readNativeSelectConsumers()
      .map(({ file, source }) => ({
        file,
        radii: [...source.matchAll(/(?:^|\s)(rounded(?:-[^\s'"`})]+)?)/g)].map(
          ([, radius]) => radius,
        ),
      }))
      .filter(({ radii }) => radii.length !== 1 || radii[0] !== 'rounded-sm')
      .map(({ file, radii }) => `${file}: ${radii.join(', ') || 'missing'}`);
    assert.deepEqual(offenders, []);
  });

  it('keeps checkbox table cells flush with the checkbox column', () => {
    const table = read('src/components/ui/table.tsx');
    const tableCell = table.match(/const TableCell[\s\S]*?TableCell\.displayName/)?.[0];

    assert.ok(tableCell, 'missing TableCell implementation');
    assert.match(tableCell, /\[&:has\(\[role=checkbox\]\)\]:pr-0/);
  });

  it('keeps manual quotation success color contrast available', () => {
    const quotationPage = read('src/features/quotations/pages/NewQuotationPage.tsx');
    assert.match(quotationPage, /aria-label="Emitir orçamento"/);
    assert.ok(contrastRatio(canonicalDark.success, canonicalDark.page) >= 4.5);
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
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (/\.(?:css|js|jsx|ts|tsx)$/.test(entry.name))
        files.push(readFileSync(entryPath, 'utf8'));
    }
  };
  visit(path.join(root, 'src'));
  return files.join('\n');
}

function readNativeSelectConsumers(): Array<{ file: string; source: string }> {
  const consumers: Array<{ file: string; source: string }> = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.name.endsWith('.tsx')) {
        const source = readFileSync(entryPath, 'utf8');
        for (const match of source.matchAll(/<select\b[\s\S]*?<\/select>/g)) {
          consumers.push({ file: path.relative(root, entryPath), source: match[0] });
        }
      }
    }
  };
  visit(path.join(root, 'src'));
  return consumers;
}
