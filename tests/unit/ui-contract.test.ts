import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');

const ROLE_TOKENS = [
  'canvas',
  'page',
  'surface',
  'surface-subtle',
  'surface-hover',
  'surface-selected',
  'border-default',
  'border-control',
  'text-primary',
  'text-secondary',
  'primary',
  'on-primary',
  'primary-soft',
  'focus',
  'success',
  'warning',
  'destructive',
  'info',
  'input-surface',
  'segment-active',
];

function tokenBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `missing ${selector} token block`);
  return css.slice(start, css.indexOf('\n  }', start));
}

function sourceFiles(): Array<{ file: string; source: string }> {
  const files: Array<{ file: string; source: string }> = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (/\.(?:css|ts|tsx)$/.test(entry.name))
        files.push({ file: path.relative(root, entryPath).replaceAll('\\', '/'), source: readFileSync(entryPath, 'utf8') });
    }
  };
  visit(path.join(root, 'src'));
  return files;
}

function offenders(pattern: RegExp, allowed: string[] = []): string[] {
  return sourceFiles()
    .filter(({ file, source }) => !allowed.includes(file) && pattern.test(source))
    .map(({ file }) => file);
}

describe('Aspen UI contract', () => {
  it('defines every role token in the dark base and overrides theme colors for light', () => {
    const css = read('src/index.css');
    const dark = tokenBlock(css, ':root');
    const light = tokenBlock(css, ":root[data-theme='light']");
    for (const token of ROLE_TOKENS) {
      assert.match(dark, new RegExp(`--${token}:`), `dark --${token}`);
    }
    for (const token of ['page', 'surface', 'text-primary', 'focus', 'segment-active']) {
      assert.match(light, new RegExp(`--${token}:`), `light --${token}`);
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

  it('draws focus once, globally, from the focus token', () => {
    const css = read('src/index.css');
    assert.match(css, /\*:focus-visible \{\s*outline: 2px solid rgb\(var\(--focus\)\);/);
    assert.deepEqual(offenders(/focus-visible:ring-|focus-visible:outline-none/), []);
  });

  it('builds every modal on the shared Dialog/Drawer', () => {
    assert.deepEqual(offenders(/role="(?:alert)?dialog"|<dialog\b/, ['src/components/ui/dialog.tsx']), []);
  });

  it('builds every tab strip on the shared Tabs', () => {
    assert.deepEqual(offenders(/role="tab(?:list|panel)?"(?![\w-])/, ['src/components/ui/tabs.tsx']).filter(
      // Panels wired through TabBar's idPrefix are allowed to declare role="tabpanel".
      (file) => /role="tab(?:list)?"(?![\w-])/.test(read(file))
    ), []);
  });

  it('uses the shared Select for every select', () => {
    assert.deepEqual(offenders(/<select\b/, ['src/components/ui/select.tsx']), []);
  });

  it('keeps the page header and breadcrumb in normal flow', () => {
    const header = read('src/components/shared/PageHeader.tsx');
    const topBar = read('src/components/layout/TopBar.tsx');
    assert.doesNotMatch(header, /absolute/);
    assert.doesNotMatch(topBar, /xl:absolute|xl:sr-only/);
    assert.match(header, /<h1/);
  });

  it('keeps foundation primitive dimensions aligned with the contract', () => {
    const button = read('src/components/ui/button.tsx');
    const input = read('src/components/ui/input.tsx');
    const select = read('src/components/ui/select.tsx');
    assert.match(button, /default: 'h-10/);
    assert.match(button, /sm: 'h-8/);
    assert.match(button, /rounded-control/);
    assert.match(input, /h-10/);
    assert.match(select, /h-10/);
    assert.match(read('src/components/ui/badge.tsx'), /rounded-badge[^']*text-2xs/);
  });

  it('ships the shared state compositions', () => {
    for (const file of [
      'src/components/shared/EmptyState.tsx',
      'src/components/shared/ErrorState.tsx',
      'src/components/shared/InlineAlert.tsx',
      'src/components/ui/stat-card.tsx',
      'src/components/ui/search-field.tsx',
      'DESIGN.md',
    ]) {
      assert.equal(existsSync(path.join(root, file)), true, file);
    }
    assert.match(read('src/components/ui/stat-card.tsx'), /loading/);
  });

  it('ships the revamp foundation and wires Field into every form control', () => {
    for (const file of [
      'src/components/ui/card.tsx',
      'src/components/ui/text.tsx',
      'src/components/ui/field.tsx',
      'src/components/ui/money-input.tsx',
      'src/components/shared/StatusFilterBar.tsx',
      'src/components/shared/DataList.tsx',
      'src/components/shared/MobileActionBar.tsx',
      'src/components/shared/StickySaveBar.tsx',
    ]) {
      assert.equal(existsSync(path.join(root, file)), true, file);
    }
    for (const control of ['input', 'select', 'textarea']) {
      assert.match(read(`src/components/ui/${control}.tsx`), /useFieldControl\(/, control);
    }
    assert.match(read('eslint.config.js'), /ui: \['@\/components\/ui', '@\/components\/shared'\]/);
  });

  it('announces lazy route loading', () => {
    const pageLoader = read('src/components/shared/PageLoader.tsx');
    assert.match(pageLoader, /role="status"/);
    assert.match(pageLoader, /Carregando página/);
  });

  it('keeps checkbox table cells flush with the checkbox column', () => {
    const table = read('src/components/ui/table.tsx');
    const tableCell = table.match(/const TableCell[\s\S]*?TableCell\.displayName/)?.[0];
    assert.ok(tableCell, 'missing TableCell implementation');
    assert.match(tableCell, /\[&:has\(\[role=checkbox\]\)\]:pr-0/);
  });

  it('keeps the manual quotation issue action named', () => {
    assert.match(read('src/features/quotations/pages/NewQuotationPage.tsx'), /aria-label="Emitir orçamento"/);
  });
});
