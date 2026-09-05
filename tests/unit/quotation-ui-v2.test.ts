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
    assert.match(page, /aria-label="Mensagem do cliente para extração"/);
    assert.match(page, /Cole a conversa ou uma imagem/);
    assert.match(card, /Emitir orçamento/);
    assert.match(card, /Rascunho salvo\. Continue a revisão ou emita o orçamento/);
    assert.doesNotMatch(
      card,
      /Nada será criado|Gerar orçamento|Modelo HTML|Revise cliente, itens, quantidades e preços/
    );
  });

  it('keeps manual quotation entry visibly editable and staged', () => {
    const page = read('src/features/quotations/pages/ManualOrcamentoPage.tsx');

    assert.match(page, /aria-label="Seleção de cliente"/);
    assert.match(page, /1\. Cliente/);
    assert.match(page, /2\. Itens do orçamento/);
    assert.match(page, /3\. Condições e fechamento/);
    assert.match(page, /aria-label="Emitir orçamento"/);
    assert.match(page, /Orçamento emitido/);
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
    assert.match(page, /min-w-\[680px\]/);
    assert.match(status, /Etapas entregues: \$\{delivered\} de \$\{total\}/);
    assert.match(status, /aria-busy=\{pending\}/);
    assert.match(sendPanel, /Nenhum fluxo de WhatsApp disponível/);
    assert.match(sendPanel, /focus-visible:ring-2 focus-visible:ring-primary/);
  });
});
