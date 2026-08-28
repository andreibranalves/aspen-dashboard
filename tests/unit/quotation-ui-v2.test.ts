import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');

describe('quotation Aspen v2 surfaces', () => {
  it('keeps auto quotations in an understood, review, and creation hierarchy', () => {
    const page = read('src/features/quotations/pages/AutoQuotePage.tsx');
    const card = read('src/features/quotations/components/SplitResultCard.tsx');

    assert.match(page, />Pedido do cliente</);
    assert.match(page, />Resultado</);
    assert.match(card, /Confirme cliente, itens, quantidades e preços/);
    assert.match(page, /aria-label="Mensagem do cliente para extração"/);
  });

  it('keeps manual quotation entry visibly editable and staged', () => {
    const page = read('src/features/quotations/pages/ManualOrcamentoPage.tsx');

    assert.match(page, /aria-label="Seleção de cliente"/);
    assert.match(page, /1\. Cliente/);
    assert.match(page, /2\. Itens do orçamento/);
    assert.match(page, /3\. Condições e fechamento/);
    assert.doesNotMatch(page, /section[^>]+shadow-sm/);
  });

  it('exposes delivery loading, recovery, semantic status, and incomplete progress states', () => {
    const page = read('src/features/quotations/pages/WhatsAppDeliveriesPage.tsx');
    const status = read('src/features/quotations/components/QuotationDeliveryStatus.tsx');
    const sendPanel = read('src/features/quotations/components/WhatsAppSendPanel.tsx');

    assert.match(page, /aria-label="Carregando entregas"/);
    assert.match(page, /Tentar novamente/);
    assert.match(page, /Sem etapas/);
    assert.match(page, /aria-label=\{`Estado: \$\{projection\.label\}[^`]+`\}/);
    assert.match(page, /min-w-\[760px\]/);
    assert.match(status, /Etapas entregues: \$\{delivered\} de \$\{total\}/);
    assert.match(status, /aria-busy=\{pending\}/);
    assert.match(sendPanel, /Nenhum fluxo de WhatsApp disponível/);
    // O foco visível do seletor vem da primitiva Select (anel padrão Aspen).
    assert.match(sendPanel, /import \{ Select \} from '@\/components\/ui\/select'/);
    assert.match(sendPanel, /<Select/);
  });
});
