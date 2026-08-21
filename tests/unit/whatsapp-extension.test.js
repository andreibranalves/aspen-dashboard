import { readFile } from 'node:fs/promises';
/* global URL */
import vm from 'node:vm';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

async function loadAdapter() {
  const source = await readFile(new URL('../../extensions/whatsapp-context/contact-adapter.js', import.meta.url), 'utf8');
  const sandbox = { globalThis: {} };
  vm.runInNewContext(source, sandbox, { filename: 'contact-adapter.js' });
  return sandbox.globalThis.AspenWhatsAppContactAdapter;
}

describe('WhatsApp Web contact adapter', () => {
  it('extracts an individual contact from visible header data', async () => {
    const adapter = await loadAdapter();
    const result = adapter.extractContactSnapshot({
      headerText: 'Maria Silva\n+55 11 99999-9999',
      titleTexts: ['Maria Silva'],
      linkHrefs: ['https://wa.me/5511999999999'],
    });

    assert.equal(result.status, 'ready');
    assert.equal(result.displayName, 'Maria Silva');
    assert.equal(result.phone, '5511999999999');
  });

  it('fails closed for groups and headers without trustworthy phones', async () => {
    const adapter = await loadAdapter();
    assert.equal(
      adapter.extractContactSnapshot({
        headerText: 'Grupo da empresa',
        group: true,
      }).status,
      'unsupported'
    );
    assert.equal(
      adapter.extractContactSnapshot({
        headerText: 'Maria Silva',
        titleTexts: ['Maria Silva'],
      }).status,
      'unsupported'
    );
  });

  it('does not treat arbitrary long numbers in unrelated text as contact identity', async () => {
    const adapter = await loadAdapter();
    const result = adapter.extractContactSnapshot({
      headerText: 'Maria Silva\n3 mensagens\nPedido 20260001',
      titleTexts: ['Maria Silva'],
      linkHrefs: [],
    });

    assert.equal(result.status, 'unsupported');
  });
});
