import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderQuotationHtml } from '../../api/_functions/lib/quotation-html.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('oculta o banner de ações do Frappe na renderização de PDF', async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes('/printview?')) {
      return {
        ok: true,
        text: async () => `<!doctype html><html><head></head><body>
          <div class="action-banner print-hide">
            <a>Imprimir</a><a>Obter PDF</a>
          </div>
          <div class="print-format-gutter"><main>Orçamento</main></div>
        </body></html>`,
      };
    }

    return {
      ok: true,
      json: async () => ({
        data: { customer_name: 'Cliente', party_name: 'Cliente', quotation_to: 'Customer' },
      }),
    };
  };

  const { html } = await renderQuotationHtml('Q-0001', {
    forPdf: true,
    includePrintButton: false,
  });

  assert.match(html, /\.action-banner,[\s\S]*?\{\s*display:\s*none\s*!important;\s*\}/);
});
