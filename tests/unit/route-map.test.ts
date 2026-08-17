import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROUTE_MAP_FILES = [
  '../../api/[...path].ts',
  '../../scripts/app-server.mjs',
  '../../scripts/dev-api-server.mjs',
] as const;

function routeNamesFromSource(relativePath: string): Set<string> {
  const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
  const mapStart = source.indexOf('const ROUTES');
  assert.notEqual(mapStart, -1, `ROUTES map not found in ${relativePath}`);
  const bodyStart = source.indexOf('{', mapStart);
  const bodyEnd = source.indexOf('\n};', bodyStart);
  assert.notEqual(bodyStart, -1, `ROUTES map opening brace not found in ${relativePath}`);
  assert.notEqual(bodyEnd, -1, `ROUTES map closing brace not found in ${relativePath}`);

  const names = new Set<string>();
  for (const line of source.slice(bodyStart + 1, bodyEnd).split('\n')) {
    const match = line.match(/^\s*(?:'([^']+)'|([A-Za-z][\w-]*))\s*(?::|,)/);
    if (match) names.add(match[1] || match[2]);
  }
  return names;
}

function describeDifference(expected: Set<string>, actual: Set<string>): string {
  const missing = [...expected].filter((name) => !actual.has(name));
  const unexpected = [...actual].filter((name) => !expected.has(name));
  return `missing=[${missing.join(', ')}] unexpected=[${unexpected.join(', ')}]`;
}

test('Vercel and local route maps expose the same 45 route names', () => {
  const maps = ROUTE_MAP_FILES.map((file) => [file, routeNamesFromSource(file)] as const);
  const expected = maps[0][1];

  assert.equal(expected.size, 45, `${maps[0][0]}: expected 45 routes, found ${expected.size}`);
  for (const [file, routes] of maps.slice(1)) {
    assert.equal(routes.size, 45, `${file}: expected 45 routes, found ${routes.size}`);
    assert.equal(
      routes.size,
      expected.size,
      `${file}: route count differs (${describeDifference(expected, routes)})`
    );
    assert.deepEqual(
      [...routes].sort(),
      [...expected].sort(),
      `${file}: route set differs (${describeDifference(expected, routes)})`
    );
  }

  for (const route of [
    'quotations',
    'quotation-preview',
    'quotation-issues',
    'public-quotation',
    'quotation-templates',
    'orcamento',
    'view',
    'pdf',
    'send-whatsapp',
    'send-quotation-email',
    'sales-order-from-quotation',
    'sales-orders',
    'sales-dashboard',
  ]) {
    assert.ok(expected.has(route), `required quotation route missing: ${route}`);
  }
});
