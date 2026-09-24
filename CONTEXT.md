# Aspen Orçamento

Operação comercial e de produção da Aspen Estamparia: do orçamento enviado ao cliente até o pedido entregue.

## Venda

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

**Tarefa**:
Algo que o operador precisa fazer e que não pertence a uma oportunidade, com data e vínculo a pedido ou cliente opcionais.
_Avoid_: Ticket, lembrete, próxima ação

**Próxima ação**:
O próximo passo combinado de uma oportunidade no Comercial. Não é uma tarefa.
_Avoid_: Tarefa, follow-up
