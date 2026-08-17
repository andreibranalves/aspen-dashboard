# Caixa de Saída Durável para Entregas por WhatsApp

## Status

Design aprovado em conversa em 17 de agosto de 2026.

Este documento especializa e substitui as regras de entrega das seções "Entrega WhatsApp", "Idempotência da Entrega", "Histórico de Entrega" e "Interface de Entrega" de `2026-08-13-ciclo-emissao-entrega-orcamento-design.md`.

As demais decisões daquele documento permanecem válidas.

## Problema

O sistema atual protege contra cliques duplicados, mas não oferece uma operação de entrega observável e recuperável.

A tela `/auto` mantém o estado de envio principalmente em memória e não consulta o estado durável depois de uma resposta ambígua.

A tela de detalhe consulta o estado apenas ao carregar.

O endpoint de status permite resolução manual, mas nenhuma tela apresenta essa capacidade.

O PostgreSQL permite somente uma entrega por revisão, enquanto a interface trata revisão e fluxo como uma identidade independente.

A conclusão atual representa aceitação pela Evolution, não entrega ao aparelho do cliente.

Uma única tentativa pode terminar em `reconciling` sem fila visível, acompanhamento automático ou ação operacional clara.

## Objetivos

- Tornar PostgreSQL a fonte de verdade para toda entrega de orçamento por WhatsApp.
- Iniciar o envio imediatamente após o clique e recuperar interrupções por job periódico.
- Impedir duplicidade entre cliques, abas, processos e workers.
- Confirmar sucesso somente após todos os passos obrigatórios serem entregues ao aparelho.
- Repetir automaticamente somente falhas comprovadamente anteriores ao transporte.
- Manter resultados ambíguos visíveis e bloqueados contra reenvio automático.
- Expor o mesmo estado no orçamento e em uma Caixa de saída global.
- Permitir resolução humana explícita, auditável e segura.
- Preservar CRM, revisões, histórico e dados existentes.

## Não objetivos

- Não recriar a interface de Pré-orçamentos.
- Não apagar `quote_leads`, CRM ou histórico legado.
- Não introduzir Redis, BullMQ, SQS ou outra fila externa.
- Não confirmar leitura como requisito de sucesso.
- Não inferir entrega por telefone, horário ou conteúdo semelhante.
- Não armazenar novamente o binário do PDF.
- Não executar envio real automático em testes de staging com orçamento fictício.

## Linguagem do domínio

**Entrega** é a operação durável que envia uma revisão por um fluxo para um telefone.

**Passo** é uma mensagem individual do fluxo, como texto, mídia ou PDF.

**Aceito pelo provedor** significa que a Evolution devolveu um identificador de mensagem ou emitiu recibo equivalente.

**Entregue** significa que a Evolution emitiu `DELIVERY_ACK` ou `READ` para o passo.

**Reconciliação** é o período em que o transporte pode ter ocorrido, mas ainda não existe prova suficiente.

**Revisão necessária** é o estado em que a reconciliação automática terminou sem resultado seguro.

**Retry seguro** é uma nova tentativa permitida somente quando há prova de que o transporte anterior não foi aceito.

## Princípios

PostgreSQL detém a correção.

Locks no navegador e Redis podem ser otimizações, mas não participam da garantia de unicidade ou retomada.

Nenhuma transação PostgreSQL permanece aberta durante chamadas externas.

Cada transição é idempotente e monotônica.

Um passo aceito nunca é reenviado automaticamente.

Um estado ambíguo nunca é convertido em falha retryable por simples expiração.

Estado comercial do orçamento permanece separado do estado de entrega.

## Arquitetura

A entrega fica atrás de um módulo profundo com a seguinte interface conceitual:

```ts
interface QuotationDeliveryModule {
  enqueue(input: EnqueueDeliveryInput): Promise<DeliveryView>;
  process(deliveryId: string): Promise<DeliveryView>;
  applyEvolutionEvent(event: EvolutionMessageEvent): Promise<DeliveryView | null>;
  get(deliveryId: string): Promise<DeliveryView | null>;
  list(filters: DeliveryFilters): Promise<DeliveryPage>;
  resolve(input: ResolveDeliveryInput): Promise<DeliveryView>;
}
```

Callers não conhecem leases, SQL, payloads da Evolution, CAS ou regras de retry.

O mesmo método `process` atende a tentativa imediata e o job periódico.

`send-whatsapp-flow` permanece temporariamente como adapter de compatibilidade.

`whatsapp-send-status` permanece temporariamente como adapter de leitura e resolução.

## Fluxo principal

1. O usuário clica em **Enviar WhatsApp**.
2. O backend valida revisão emitida, telefone e fluxo.
3. O backend renderiza e congela os passos do fluxo.
4. Uma transação cria ou recupera a entrega por `revision_id + flow_id` e cria os passos ausentes.
5. O backend tenta reivindicar e processar a entrega imediatamente.
6. A interface começa a consultar o estado durável, independentemente da resposta da tentativa imediata.
7. Cada resposta aceita da Evolution associa `provider_message_id` ao passo correspondente.
8. O webhook `MESSAGES_UPDATE` aplica `SERVER_ACK`, `DELIVERY_ACK`, `READ` ou `ERROR` ao passo.
9. A entrega vira `delivered` somente quando todos os passos obrigatórios estão em `delivered` ou `read`.
10. Um job periódico recupera leases vencidos, executa retries seguros e promove ambiguidades vencidas para revisão humana.

O fechamento do navegador não interrompe a recuperação.

## Processamento dos passos

Passos são processados na ordem congelada do fluxo.

O próximo passo pode começar após o passo anterior receber confirmação explícita de aceitação com identificador.

Não é necessário aguardar `DELIVERY_ACK` entre passos.

Se um passo ficar ambíguo, os passos seguintes permanecem na fila.

Se um passo receber falha segura antes do transporte, somente esse passo é reagendado.

Passos já aceitos ou entregues nunca são reconstruídos nem retransmitidos automaticamente.

Delays configurados no fluxo continuam válidos, mas são representados por `next_attempt_at` em vez de espera mantida em memória.

## Modelo de dados

### `quotation_deliveries`

Uma linha representa uma entrega de uma revisão por um fluxo.

Campos principais:

- `id uuid primary key`
- `revision_id uuid not null`
- `flow_id text not null`
- `phone text not null`
- `state text not null`
- `attempt_count integer not null default 0`
- `next_attempt_at timestamptz`
- `lease_token uuid`
- `lease_until timestamptz`
- `reconciliation_deadline timestamptz`
- `public_error text`
- `completion_source text`
- `resolved_by text`
- `resolved_at timestamptz`
- `resolution_note text`
- `delivered_at timestamptz`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

A restrição única passa de `revision_id` para `(revision_id, flow_id)`.

`completion_source` aceita `provider_receipt`, `operator` ou `legacy_provider_ack`.

Estados da entrega:

```text
queued
processing
provider_accepted
reconciling
retry_scheduled
needs_review
delivered
failed
```

### `quotation_delivery_steps`

Uma linha representa um passo congelado.

Campos principais:

- `id uuid primary key`
- `delivery_id uuid not null`
- `position integer not null`
- `type text not null`
- `payload_snapshot jsonb not null`
- `state text not null`
- `provider_message_id text`
- `attempt_count integer not null default 0`
- `next_attempt_at timestamptz`
- `reconciliation_deadline timestamptz`
- `public_error text`
- `accepted_at timestamptz`
- `delivered_at timestamptz`
- `read_at timestamptz`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

A tabela possui unicidade em `(delivery_id, position)`.

`provider_message_id` é único quando presente.

Estados do passo:

```text
queued
sending
server_ack
reconciling
retry_scheduled
needs_review
delivered
read
failed
```

`payload_snapshot` contém apenas dados necessários para repetir com segurança um passo ainda não aceito.

O snapshot não contém credenciais, resposta bruta da Evolution nem binário do PDF.

O PDF é regenerado da revisão imutável.

Links públicos são emitidos novamente quando necessário.

## Máquina de estados

Transições normais da entrega:

```text
queued -> processing
processing -> provider_accepted
processing -> retry_scheduled
processing -> reconciling
provider_accepted -> delivered
reconciling -> provider_accepted
reconciling -> needs_review
retry_scheduled -> processing
needs_review -> processing          por decisão humana de reenviar
needs_review -> delivered           por confirmação humana de recebimento
processing -> failed                por falha terminal explícita
retry_scheduled -> failed           após limite de retries seguros
```

Transições normais do passo:

```text
queued -> sending
sending -> server_ack
sending -> retry_scheduled
sending -> reconciling
server_ack -> delivered
server_ack -> read
delivered -> read
reconciling -> server_ack
reconciling -> delivered
reconciling -> needs_review
retry_scheduled -> sending
needs_review -> sending             por decisão humana de reenviar
needs_review -> delivered           por confirmação humana de recebimento
```

Eventos atrasados podem avançar estados, mas nunca regredi-los.

`READ` conta como prova de entrega.

`provider_accepted` sem `DELIVERY_ACK` permanece aceito.

Após 24 horas, a interface sinaliza atraso sem autorizar reenvio automático.

## Classificação de falhas

Falhas transitórias comprovadamente anteriores ao transporte permitem retry automático.

Exemplos:

- falha transitória ao gerar ou carregar o PDF;
- rate limit com rejeição explícita antes da aceitação;
- indisponibilidade comprovada por preflight anterior ao envio.

Falhas permanentes anteriores ao transporte terminam em `failed` sem retry.

Exemplos:

- telefone inválido;
- revisão vencida;
- configuração obrigatória ausente;
- payload rejeitado por validação.

Resultados com possibilidade de aceitação entram em reconciliação.

Exemplos:

- timeout;
- conexão encerrada durante a chamada;
- HTTP 5xx;
- HTTP 2xx sem confirmação explícita;
- resposta inválida;
- falha de persistência depois da aceitação.

A implementação não tenta deduzir se `fetch` transmitiu ou não o corpo.

Sem prova de rejeição, não há retry automático.

Se existir `provider_message_id`, recibos podem reconciliar automaticamente.

Sem identificador, a Evolution não oferece correlação segura com a entrega local.

Após o prazo de reconciliação, o estado vira `needs_review`.

## Retry seguro

Retries usam `next_attempt_at` e backoff persistido.

O limite inicial é de três retries após a tentativa inicial por passo.

Os intervalos iniciais são 1 minuto, 5 minutos e 15 minutos.

O job executa somente linhas cujo `next_attempt_at` venceu.

Atingir o limite move a entrega para `failed` com erro público seguro.

Alterar limite ou intervalos exige evidência operacional, não configuração especulativa na interface.

## Concorrência e retomada

O worker reivindica trabalho em uma transação curta.

A seleção usa locking equivalente a `FOR UPDATE SKIP LOCKED`.

A transação grava `lease_token`, `lease_until` e estado `processing`, depois encerra.

Chamadas à Evolution ocorrem fora da transação.

A conclusão compara o lease antes de aplicar a transição.

Lease vencido permite retomada pelo job seguinte.

Um passo com `provider_message_id` não volta para `sending` automaticamente.

Clique repetido retorna a entrega existente.

Duas abas e dois workers continuam produzindo uma única entrega por revisão e fluxo.

## Webhook da Evolution

A instância assina pelo menos `MESSAGES_UPDATE`.

O endpoint recebe o envelope oficial com `event`, `instance` e `data`.

O evento de mensagem usa `keyId`, `remoteJid`, `fromMe` e `status`.

Estados reconhecidos são `ERROR`, `PENDING`, `SERVER_ACK`, `DELIVERY_ACK`, `READ` e `PLAYED`.

Somente eventos `fromMe` associados a `provider_message_id` conhecido alteram uma entrega.

Eventos desconhecidos retornam sucesso neutro para evitar retries inúteis do provedor.

Eventos duplicados retornam sucesso sem nova transição.

`PLAYED` conta como leitura quando aplicável.

## Segurança e privacidade

A configuração do webhook inclui header `Authorization: Bearer <secret>`.

O backend compara o segredo antes de ler ou processar o evento.

O backend valida a instância esperada e permite somente eventos conhecidos.

O campo `apikey` recebido no corpo não autentica o webhook.

O endpoint aplica limite de corpo e rejeita formatos inválidos.

O worker exige `Authorization: Bearer ${CRON_SECRET}`.

A Vercel envia esse header ao cron configurado.

A Vercel não repete automaticamente execuções de cron com falha.

Por isso, cada execução é idempotente e o cron seguinte recupera trabalho pendente.

Logs estruturados incluem somente IDs internos, estado, código de erro e duração.

Logs não incluem telefone, nome, conteúdo, PDF, token, segredo ou payload bruto.

Erros HTTP públicos permanecem em português e não expõem detalhes de banco ou provedor.

## Resolução humana

Ações manuais existem somente em `needs_review` ou em entrega aceita sinalizada como atrasada.

A interface oferece duas decisões:

- **Cliente confirmou recebimento**;
- **Confirmado que não recebeu, reenviar**.

A primeira marca a entrega como `delivered` com `completion_source = operator`.

A segunda cria uma nova tentativa explícita somente para passos não entregues.

A segunda ação mostra aviso de que uma confirmação humana incorreta pode gerar duplicidade.

Toda resolução exige confirmação, usuário autenticado e justificativa curta.

O backend grava decisão, usuário e horário.

Não existe ação genérica de retry em estado ambíguo.

## Interface HTTP

### Criar ou recuperar entrega

```http
POST /api/send-whatsapp-flow
```

O endpoint mantém o payload atual durante a migração.

A resposta inclui `delivery_id`, `state`, `steps`, `created_at` e `updated_at`.

Uma entrega ainda não confirmada retorna estado atual, não mensagem falsa de sucesso.

### Listar entregas

```http
GET /api/quotation-deliveries?state=needs_review&search=ORC-20260001&page=1
```

Filtros suportados:

- estado;
- revisão ou número comercial;
- cliente;
- telefone;
- período;
- atrasadas;
- requer ação.

### Consultar entrega

```http
GET /api/quotation-deliveries?id=<delivery-id>
```

A resposta inclui passos, progresso agregado, horários e ações permitidas.

### Resolver entrega

```http
PATCH /api/quotation-deliveries?id=<delivery-id>
```

Payload permitido:

```json
{
  "decision": "confirmed_received | confirmed_not_received",
  "note": "Confirmação obtida com o cliente"
}
```

O usuário vem da autenticação, nunca do corpo.

### Receber webhook

```http
POST /api/evolution-webhook
```

### Executar recuperação

```http
POST /api/quotation-delivery-worker
```

O job processa lote limitado e encerra antes do limite da função.

Trabalho restante fica para a próxima execução.

## Experiência no Auto Orçamento e no Detalhe

Após o clique, a interface exibe:

```text
Na fila -> Enviando -> Aceito pela Evolution -> Entregue
```

Estados alternativos são:

```text
Nova tentativa agendada
Reconciliação em andamento
Revisão necessária
Falhou
```

O estado sempre vem do backend.

A interface consulta rapidamente enquanto a entrega está ativa e aumenta o intervalo gradualmente.

Recarregar ou trocar de navegador recupera o mesmo estado.

O detalhe mostra progresso e estado de cada passo.

O botão de envio fica indisponível enquanto a entrega não permite nova ação.

A interface mostra `Entregue` somente após todos os passos obrigatórios estarem entregues ou lidos.

## Caixa de saída global

A navegação recebe a página **Envios WhatsApp**.

A visão padrão mostra:

- requer ação;
- em processamento;
- retry agendado.

Filtros adicionais mostram entregues, falhos e atrasados.

Cada linha exibe:

- orçamento;
- cliente;
- telefone formatado;
- fluxo;
- progresso dos passos;
- estado;
- última atualização;
- ação permitida.

A tela não mostra payload bruto, credenciais ou diagnóstico interno.

A tela não cria leads nem orçamentos.

## Migração

A migração não altera arquivos históricos existentes em `drizzle/`.

Uma nova migração:

1. amplia a máquina de estados de `quotation_deliveries`;
2. adiciona os campos operacionais e de resolução;
3. substitui unicidade em `revision_id` por `(revision_id, flow_id)`;
4. cria `quotation_delivery_steps`;
5. converte estados existentes;
6. preserva IDs, revisão, telefone, fluxo e timestamps atuais.

Mapeamento legado:

```text
pending -> needs_review
transporting -> needs_review
accepted_partial -> needs_review
completed -> provider_accepted
retryable -> needs_review
reconciling -> needs_review
```

A migração nunca agenda transporte de um registro antigo automaticamente.

Registros `completed` antigos recebem `completion_source = legacy_provider_ack`.

Eles não ganham recibo de entrega inventado.

Entregas legadas sem passos aparecem como **Aceito pela Evolution, confirmação de entrega indisponível**.

A migração não cria mensagens nem executa transporte.

## Observabilidade

A Caixa de saída é a superfície operacional principal.

Contadores mínimos:

- ativos;
- requer ação;
- retry agendado;
- atrasados;
- entregues nas últimas 24 horas.

Logs estruturados permitem localizar uma operação por `delivery_id`, `revision_id` e `provider_message_id`.

Alertas externos e dashboard de métricas ficam fora do primeiro incremento.

Eles devem ser adicionados quando volume ou incidentes justificarem.

## Testes

### Unitários

- transições válidas e inválidas;
- monotonicidade de recibos;
- agregação de todos os passos;
- classificação de falhas;
- retry permitido e proibido;
- backoff e limite de tentativas;
- webhook duplicado e fora de ordem;
- autenticação do webhook e worker;
- projeções públicas sem dados sensíveis.

### PostgreSQL

- unicidade por revisão e fluxo;
- criação idempotente da entrega e dos passos;
- dois workers disputando o mesmo claim;
- retomada de lease vencido;
- atualização protegida pelo lease;
- passo aceito não retorna para envio;
- resolução humana auditável;
- migração dos estados existentes.

### E2E local

- clique único aparece no orçamento e na Caixa de saída;
- clique duplo produz uma entrega;
- reload preserva estado;
- fechamento da página não elimina entrega;
- entrega parcial continua pendente;
- todos os `DELIVERY_ACK` concluem;
- evento `READ` conclui o passo;
- ambiguidade entra em reconciliação e depois revisão;
- retry seguro acontece sem repetir passos aceitos;
- resolução manual exige confirmação;
- fluxo diferente possui identidade independente.

### Staging

- validar autenticação e assinatura do webhook;
- validar `SERVER_ACK`, `DELIVERY_ACK` e `READ` com envio real controlado;
- validar timeout, HTTP 5xx e resposta inválida por injeção controlada;
- validar crash entre passos e retomada por lease;
- validar webhook duplicado;
- não criar orçamento fictício automaticamente.

## Implantação

1. Aplicar migração compatível com o código atual.
2. Publicar módulo de entrega e adapters antigos.
3. Configurar segredo e webhook `MESSAGES_UPDATE` na Evolution.
4. Configurar `CRON_SECRET` e cron do worker.
5. Publicar polling no Auto Orçamento e no Detalhe.
6. Publicar Caixa de saída e resolução humana.
7. Validar envio real controlado.
8. Remover dependência de reservas Redis somente depois da validação.

Não haverá flag de rollout permanente nem provider fallback.

Adapters antigos são temporários e removidos após migração dos callers.

## Critérios de aceite

1. Um clique cria uma entrega durável e visível nas duas superfícies.
2. Fechar o navegador não interrompe processamento ou recuperação.
3. Cliques, abas e workers concorrentes não duplicam entrega.
4. Fluxos diferentes usam identidades independentes para a mesma revisão.
5. O sistema não mostra sucesso antes de todos os passos obrigatórios receberem confirmação de entrega.
6. Passos aceitos nunca são reenviados automaticamente.
7. Falha transitória comprovadamente anterior ao transporte recebe retry automático.
8. Resultado ambíguo nunca recebe retry automático.
9. Ambiguidade não resolvida aparece na Caixa de saída com ações explícitas.
10. Estado mostrado no Auto Orçamento, Detalhe e Caixa de saída é consistente.
11. Webhooks duplicados ou fora de ordem não corrompem estado.
12. Migração preserva histórico, CRM, revisões e entregas existentes.
13. Logs e respostas não expõem dados pessoais, segredos ou detalhes internos.
14. Testes locais não enviam mensagens reais nem dependem de staging.
