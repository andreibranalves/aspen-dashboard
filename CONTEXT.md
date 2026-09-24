# Aspen Orçamento

Operação comercial e de produção da Aspen Estamparia: do orçamento enviado ao cliente até o pedido entregue.

## Orçamento

**Orçamento**:
Proposta de preço para um cliente, com número próprio e status rascunho, emitido, aprovado ou perdido.
_Avoid_: Cotação, proposta, quote

**Revisão**:
Versão numerada do conteúdo de um orçamento: itens, preços, modelo de documento e dados da empresa. Só uma revisão emitida origina uma nova revisão.
_Avoid_: Versão

**Rascunho**:
Revisão ainda editável, antes da emissão.

**Emissão**:
Momento em que a revisão fica fixa, ganha validade e passa a poder ser enviada.
_Avoid_: Geração do PDF

**Envio**:
Entrega de uma revisão emitida ao cliente por WhatsApp ou e-mail. Depois do envio, mudar o destinatário exige nova revisão.
_Avoid_: Entrega, disparo

**Retorno**:
Contato de acompanhamento com o cliente que ainda não respondeu a um orçamento enviado.
_Avoid_: Follow-up, cobrança

**Modelo de documento**:
Layout versionado do documento do orçamento. A revisão guarda a versão usada.
_Avoid_: Template

**Modelo de pedido**:
Conjunto salvo de itens para montar um orçamento recorrente.
_Avoid_: Template, kit

## Venda

**Cliente**:
Pessoa ou empresa cadastrada, com quem se fecha orçamento e pedido.
_Avoid_: Contato

**Lead**:
Demanda captada pelo site ou pelo WhatsApp antes de haver cliente cadastrado.
_Avoid_: Cliente, prospect

**Oportunidade**:
Negociação com um cliente antes da venda, acompanhada no Comercial.
_Avoid_: Pedido, deal

**Pedido**:
Venda confirmada, nascida da revisão aprovada de um orçamento. Todo pedido fechado nasce no app.
_Avoid_: Oportunidade, venda, sales order

## Produção

**Etapa do pedido**:
Onde o pedido está depois da venda, em sequência fixa que só avança: aguardando entrada, aguardando arte, em produção, pronto, entregue. Cada etapa vale para o pedido inteiro, não por item.
_Avoid_: Status, coluna

**Entrada**:
Pagamento parcial que libera o pedido para a arte; na maioria dos pedidos é 50% do total.
_Avoid_: Sinal, pagamento

**Saldo**:
O que falta receber do pedido depois da entrada. Entregar com saldo em aberto é permitido, mas é exceção.
_Avoid_: Restante, faturamento

**Arte aprovada**:
Aprovação da arte pelo cliente, sempre depois da entrada. É o início da contagem do prazo de produção.
_Avoid_: Aprovação

**Prazo de produção**:
Quantidade de dias úteis entre a arte aprovada e o pedido pronto. O padrão é 20 dias úteis.
_Avoid_: Prazo de entrega, faixa de prazo

**Prazo comunicado**:
O texto de prazo que o cliente lê no orçamento, sempre derivado do prazo de produção: "N−5 a N dias úteis", ou "até N dias úteis" em prazos curtos. Não é usado para contar prazo.
_Avoid_: Prazo de produção

**Prazo especial**:
Prazo de produção diferente do padrão, negociado no orçamento. Não aplica acréscimo sozinho.
_Avoid_: Urgente, urgência

**Acréscimo**:
Percentual que o operador decide cobrar num orçamento, embutido nos preços automáticos. Começa em zero e não depende do prazo.
_Avoid_: Taxa de urgência, +30%

**Prazo pedido**:
Trecho da conversa em que o cliente menciona um prazo ou uma data, destacado no rascunho. É um sinal para o operador, sem efeito em preço ou prazo.
_Avoid_: Urgente

**Prazo final**:
Data em que o prazo de produção termina: arte aprovada mais o prazo de produção, pulando fins de semana e feriados nacionais. Carnaval e Corpus Christi contam como dia útil. Pode ser ajustada à mão.
_Avoid_: Entrega prevista, data de entrega

**Em risco**:
Pedido não pronto que já consumiu os últimos 25% do prazo de produção.

**Atrasado**:
Pedido não pronto cujo prazo final já passou.
_Avoid_: Vencido

**Pronto**:
Produção concluída e pedido disponível para entrega ou retirada. Encerra a contagem do prazo de produção.
_Avoid_: Enviado, finalizado

**Anotação**:
Registro datado no histórico de um pedido. As mudanças de etapa entram no mesmo histórico.
_Avoid_: Observação, comentário

## Operação

**Atendimento**:
Tela de conversas do WhatsApp, onde o operador lê, responde e inicia orçamentos.
_Avoid_: Inbox, chat

**Tarefa**:
Algo que o operador precisa fazer e que não pertence a uma oportunidade, com data e vínculo a pedido ou cliente opcionais.
_Avoid_: Ticket, lembrete, próxima ação

**Próxima ação**:
O próximo passo combinado de uma oportunidade no Comercial. Não é uma tarefa.
_Avoid_: Tarefa, follow-up

## Resultados

**Faturamento**:
Soma dos pedidos no período, no calendário de São Paulo.
_Avoid_: Receita, vendas

**Lucro**:
Faturamento menos custo dos produtos vendidos, anúncios e imposto. Não é DRE (ADR 0005).
_Avoid_: Margem, resultado

## Nomes no código

O código guarda nomes anteriores ao glossário. Use o termo do glossário em texto e issues; não renomeie tabelas por isso.

| Termo | No código |
| --- | --- |
| Orçamento | `quotations`, `quotation_*`, `quote_*` |
| Revisão | `quote_revisions`, `quote_revision_items` |
| Envio | `quotation_deliveries`, `quotation_email_deliveries` |
| Retorno | `quotation_follow_ups` |
| Modelo de documento | `quotation_templates`, `quotation_template_versions` |
| Modelo de pedido | `order_templates` |
| Lead | `quote_leads` |
| Oportunidade | `crm_deals`, `opportunity_*` |
| Pedido | `sales_orders`, `sales_order_*` |
| Tarefa | `operator_tasks` |
| Atendimento | `whatsapp_conversations`, `whatsapp_messages`, `src/features/attendance/` |
| Resultados | rota `/dashboard` |
