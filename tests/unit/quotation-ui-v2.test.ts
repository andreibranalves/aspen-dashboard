import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');

describe('quotation Aspen v2 surfaces', () => {
  it('keeps auto quotations in an understood, review, and creation hierarchy', () => {
    const page = read('src/features/quotations/pages/NewQuotationPage.tsx');
    const card = read('src/features/quotations/components/SplitResultCard.tsx');

    assert.match(page, /Comece com o pedido do cliente/);
    assert.match(page, />Resultado</);
    assert.match(page, /aria-label="Mensagem do cliente para extração"/);
    assert.match(page, /Cole aqui a mensagem do cliente/);
    assert.match(card, /Emitir orçamento/);
    assert.match(card, /<Check size=\{10\} \/> Rascunho salvo/);
    assert.doesNotMatch(
      card,
      /Nada será criado|Gerar orçamento|Modelo HTML|Revise cliente, itens, quantidades e preços/
    );
  });

  it('keeps manual quotation entry visibly editable and staged', () => {
    const page = read('src/features/quotations/pages/NewQuotationPage.tsx');

    assert.match(page, /aria-label="Itens do orçamento"/);
    assert.match(page, /Condições e fechamento/);
    assert.match(page, /aria-label="Emitir orçamento"/);
    assert.doesNotMatch(page, /Enviar orçamento|Orçamento enviado com sucesso|Modelo HTML/);
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
    assert.match(page, /min-w-\[720px\]/);
    assert.match(status, /aria-busy=\{pending\}/);
    assert.match(sendPanel, /Nenhum fluxo de WhatsApp disponível/);
    assert.doesNotMatch(sendPanel, /focus-visible:ring-/);
  });
});
