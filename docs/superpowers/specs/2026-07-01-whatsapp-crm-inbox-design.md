# Design: Inbox Comercial de WhatsApp para Orçamentos

**Data:** 2026-07-01  
**Status:** Proposto  
**Branch:** `spec/whatsapp-crm-inbox`  
**Produto:** Aspen Dashboard — WhatsApp + CRM + Orçamentos

## 1. Resumo

Criar uma tela de **Inbox Comercial de WhatsApp** dentro do Aspen Dashboard para transformar conversas em ações comerciais: identificar leads, consultar dados no CRM/ERPNext, extrair pedidos de orçamento da conversa e encaminhar o fluxo para pré-orçamento ou orçamento.

O objetivo inicial não é substituir WhatsApp Web, Chatwoot, Trengo ou um helpdesk completo. O MVP deve ser um cockpit de vendas/orçamentos: conversa à esquerda, histórico no centro e dados/ações comerciais à direita.

## 2. Contexto atual do projeto

O projeto já tem bases importantes para essa feature:

- `api/_functions/whatsapp-leads.ts`: busca conversas/leads recentes via Evolution API, resolve telefone, nome, e-mail e cruza com dados de quotation.
- `src/pages/AutoQuotePage.tsx`: já usa uma lista lateral de leads WhatsApp no fluxo de auto-orçamento.
- `api/_functions/send-whatsapp-flow.ts`: envia fluxos/mensagens e PDF por WhatsApp.
- `api/_functions/whatsapp-flows.ts`: configura fluxos de mensagem.
- `docs/pre-orcamentos-inbox.md`: já prevê `whatsapp` como fonte futura de pré-orçamentos.
- `api/_functions/lib/quote-leads-store.ts`: armazena leads de pré-orçamento.

Documentação atual da Meta confirma que a WhatsApp Business Platform usa webhooks para mensagens recebidas e status de mensagens enviadas, com possíveis duplicidades/retries. Portanto, o app deve persistir mensagens/eventos de forma idempotente em vez de depender apenas de chamadas ao vivo.

## 3. Problema

Hoje a conversa comercial acontece fora do Dashboard. Isso cria atrito:

1. A atendente alterna entre WhatsApp, Dashboard e ERPNext/CRM.
2. O pedido do cliente fica em texto livre, sem estrutura.
3. Informações de lead, orçamento e deal ficam separadas da conversa.
4. Leads que perguntaram preço podem não virar pré-orçamento.
5. Follow-ups dependem de memória/manualidade.

## 4. Objetivos

### MVP

1. Exibir uma lista de conversas WhatsApp relevantes para venda/orçamento.
2. Permitir abrir uma conversa e ver as mensagens recentes.
3. Mostrar um painel lateral com dados comerciais vinculados:
   - contato/lead encontrado por telefone/e-mail;
   - últimos orçamentos;
   - status de pré-orçamento/deal quando disponível;
   - lacunas de informação.
4. Permitir criar ou atualizar um pré-orçamento a partir da conversa.
5. Permitir executar uma ação de IA: **Extrair orçamento da conversa**.
6. Enviar o resultado extraído para o fluxo existente de pré-orçamentos ou auto-orçamento.
7. Registrar vínculo entre conversa, lead e orçamento quando criado.

### Objetivos de negócio

- Reduzir tempo entre mensagem recebida e orçamento enviado.
- Diminuir perda de leads vindos do WhatsApp.
- Dar contexto comercial completo antes de responder ao cliente.
- Criar base para follow-up e automações futuras.

## 5. Não objetivos do MVP

O MVP não deve incluir:

1. Inbox multiatendente completa.
2. Sistema avançado de atribuição, SLA ou filas.
3. Substituição integral do WhatsApp Web.
4. Bot conversacional completo.
5. Editor visual de automações.
6. Analytics avançado.
7. Sincronização retroativa ilimitada de todo histórico antigo.
8. Envio de templates oficiais com aprovação Meta, salvo se já estiver disponível na integração existente.

Esses pontos podem entrar em fases futuras, mas não devem bloquear o MVP.

## 6. Usuários

### Atendente comercial

Precisa ver rapidamente quem é o cliente, o que ele pediu, se já existe orçamento e qual o próximo passo.

### Gestor/operação

Precisa garantir que leads do WhatsApp não sejam perdidos, que orçamentos sejam criados mais rápido e que follow-ups fiquem rastreáveis.

## 7. Abordagens consideradas

### Opção A — Renderizar WhatsApp completo

Criar uma tela parecida com WhatsApp Web, com todas as conversas e envio completo.

**Prós:** experiência familiar.  
**Contras:** escopo grande; vira produto de atendimento; exige tratar muitos casos periféricos antes de gerar valor comercial.

### Opção B — Inbox Comercial de Orçamentos

Criar uma inbox focada em conversas que geram ações comerciais: extrair pedido, criar lead, vincular CRM e gerar orçamento.

**Prós:** encaixa no app atual; entrega valor rápido; aproveita endpoints existentes; evita construir um helpdesk completo.  
**Contras:** não substitui todas as funções do WhatsApp Web no início.

### Opção C — Assistente de extração sem inbox

Permitir colar ou selecionar conversa e apenas extrair orçamento.

**Prós:** menor escopo.  
**Contras:** menos integrado; perde contexto e histórico; menor diferencial de CRM.

### Decisão recomendada

Seguir a **Opção B — Inbox Comercial de Orçamentos**.

## 8. Experiência do usuário

Nova rota sugerida: `#/whatsapp` ou `#/whatsapp-inbox`.

Layout sugerido em três colunas:

1. **Lista de conversas**
   - nome/telefone;
   - última mensagem;
   - horário;
   - badges: `Novo`, `Pedido detectado`, `Pré-orçamento`, `Orçamento enviado`, `Sem CRM`.

2. **Conversa**
   - mensagens recentes em ordem cronológica;
   - indicação de mensagens recebidas/enviadas;
   - anexos básicos quando disponíveis;
   - botão para atualizar/sincronizar.

3. **Painel comercial**
   - dados do contato;
   - lead/deal/quotation encontrados;
   - campos extraídos pela IA;
   - ações:
     - `Extrair orçamento`;
     - `Criar pré-orçamento`;
     - `Abrir no auto-orçamento`;
     - `Vincular lead existente`;
     - `Enviar fluxo/PDF` quando aplicável.

## 9. Dados e persistência

### Entidades mínimas

#### `whatsapp_conversation`

Representa uma conversa rastreada pelo dashboard.

Campos sugeridos:

- `id`
- `remoteJid`
- `phone`
- `displayName`
- `lastMessageAt`
- `lastMessagePreview`
- `source`: `evolution`
- `linkedLeadId`
- `linkedDealId`
- `linkedQuotationId`
- `status`: `new`, `needs_quote`, `quote_created`, `waiting_customer`, `closed`, `ignored`
- `createdAt`
- `updatedAt`

#### `whatsapp_message`

Representa mensagens sincronizadas.

Campos sugeridos:

- `id`
- `conversationId`
- `providerMessageId`
- `direction`: `inbound` ou `outbound`
- `type`: `text`, `image`, `document`, `audio`, `unknown`
- `body`
- `mediaUrl`
- `timestamp`
- `raw`

#### `whatsapp_quote_extraction`

Registro da última extração feita pela IA.

Campos sugeridos:

- `id`
- `conversationId`
- `inputMessageIds`
- `extractedPayload`
- `confidence`
- `missingFields`
- `quoteLeadId`
- `quotationId`
- `createdAt`

### Storage recomendado para MVP

Usar Vercel KV ou o storage já usado por `quote-leads-store`, desde que suporte:

- upsert por `remoteJid`;
- deduplicação por `providerMessageId`;
- busca por conversas recentes;
- busca por mensagens de uma conversa.

Se o volume crescer, migrar essa parte para banco relacional/Supabase/Postgres.

## 10. Backend/API

Endpoints sugeridos:

### `GET /api/whatsapp-conversations`

Lista conversas recentes com metadados comerciais.

Filtros opcionais:

- `status`
- `q`
- `hasQuoteRequest`
- `limit`

### `GET /api/whatsapp-conversations/:id/messages`

Retorna mensagens recentes da conversa.

### `POST /api/whatsapp-conversations/sync`

Sincroniza conversas/mensagens recentes da Evolution API. Deve ser idempotente.

### `POST /api/whatsapp-conversations/:id/extract-quote`

Envia as mensagens recentes para o pipeline de extração e retorna dados estruturados.

Deve reaproveitar ao máximo o contrato atual de extração/orçamento para evitar dois modelos de dados.

### `POST /api/whatsapp-conversations/:id/create-quote-lead`

Cria ou atualiza um pré-orçamento com `source: "whatsapp"`.

### `PATCH /api/whatsapp-conversations/:id`

Atualiza status, vínculos e metadados manuais.

## 11. Integrações

### Evolution API

Usar como fonte inicial para conversas/mensagens, porque o projeto já depende dela.

Requisitos:

- manter chaves no backend;
- normalizar formatos de chat/mensagem;
- ignorar grupos por padrão;
- deduplicar mensagens;
- tratar `@lid`, `senderPn` e variações já vistas no endpoint atual.

### ERPNext/CRM

Resolver dados comerciais por telefone/e-mail:

1. procurar lead/contato/deal por telefone normalizado;
2. procurar quotations recentes por telefone/e-mail;
3. exibir dados canônicos no painel lateral;
4. permitir vínculo manual quando a resolução automática falhar.

### Pré-orçamentos

Ao criar pré-orçamento, preencher:

- `source: "whatsapp"`;
- nome, telefone e e-mail quando disponíveis;
- texto original da conversa;
- payload extraído;
- status inicial `ready` ou `incomplete` conforme campos obrigatórios.

## 12. Extração de orçamento

A ação **Extrair orçamento** deve:

1. coletar as últimas mensagens relevantes da conversa;
2. ignorar ruído comum: saudações, confirmações curtas, mensagens antigas sem relação;
3. extrair campos já compatíveis com o pipeline atual:
   - nome;
   - telefone;
   - e-mail;
   - produto;
   - quantidade;
   - cores/tamanhos;
   - prazo/urgência;
   - observações;
   - anexos mencionados;
4. retornar campos faltantes;
5. permitir revisão humana antes de criar orçamento.

A IA não deve criar orçamento final sem revisão humana no MVP.

## 13. Estados da conversa

Estados sugeridos:

- `new`: conversa nova ainda não triada;
- `needs_quote`: há intenção de orçamento detectada;
- `incomplete`: faltam dados para orçamento;
- `quote_lead_created`: pré-orçamento criado;
- `quotation_created`: orçamento ERPNext criado;
- `waiting_customer`: aguardando resposta;
- `closed`: encerrada;
- `ignored`: não relevante.

## 14. Erros e casos especiais

- Se a Evolution API falhar, mostrar erro amigável e manter dados já sincronizados.
- Se a conversa não tiver telefone resolvido, permitir exibir mas bloquear criação de CRM até resolver contato.
- Se houver múltiplos leads para o mesmo telefone, pedir escolha manual.
- Se a IA tiver baixa confiança, criar pré-orçamento como `incomplete`.
- Se mensagens chegarem duplicadas por webhook/retry, deduplicar por ID do provider.
- Grupos devem ficar ocultos por padrão.

Todas as mensagens de erro para usuário devem seguir o padrão do projeto: português brasileiro, sem stack trace ou erro cru do provider.

## 15. Segurança e privacidade

- Não expor `EVOLUTION_API_KEY` no frontend.
- Não expor payload bruto completo se contiver dados sensíveis desnecessários.
- Guardar `raw` apenas se necessário para debug, preferencialmente com limite de retenção.
- Evitar sincronização ilimitada de histórico antigo.
- Registrar ações importantes: extração, criação de pré-orçamento, vínculo manual e envio de PDF/fluxo.

## 16. Plano de entrega por fases

### Fase 1 — Inbox somente leitura + CRM lateral

- Criar rota/página.
- Listar conversas recentes.
- Abrir conversa.
- Mostrar dados comerciais resolvidos por telefone/e-mail.
- Sem responder pelo dashboard.

### Fase 2 — Extração e pré-orçamento

- Botão `Extrair orçamento`.
- Revisão dos dados extraídos.
- Criar pré-orçamento `source: whatsapp`.
- Link para abrir no fluxo de auto-orçamento.

### Fase 3 — Ações comerciais

- Marcar status da conversa.
- Enviar PDF/fluxo existente quando já houver orçamento.
- Criar follow-up simples.

### Fase 4 — Atendimento avançado opcional

- Responder pelo dashboard.
- Templates/respostas rápidas.
- Atribuição de atendente.
- Filtros e métricas.

## 17. Testes

### Backend

- Normalização de telefone/JID.
- Filtro de grupos.
- Deduplicação de mensagens.
- Resolução de contato/quotation por telefone/e-mail.
- Criação de pré-orçamento com `source: whatsapp`.
- Erros da Evolution API convertidos para resposta segura.

### Frontend

- Lista vazia.
- Lista com conversas.
- Conversa sem CRM vinculado.
- Conversa com lead/orçamento encontrado.
- Extração com campos completos.
- Extração com campos faltantes.
- Falha de sync/extraction.

### Integração manual

- Sincronizar conversa real.
- Extrair um pedido real.
- Criar pré-orçamento.
- Abrir no fluxo existente e gerar orçamento.

## 18. Métricas de sucesso

- Tempo médio entre mensagem recebida e pré-orçamento criado.
- Número de conversas WhatsApp convertidas em pré-orçamentos.
- Percentual de extrações que exigem poucos ajustes manuais.
- Número de leads sem follow-up após orçamento enviado.

## 19. Decisões do MVP

1. Usar rota `#/whatsapp-inbox`, com label de navegação `WhatsApp`.
2. Reaproveitar o storage atual usado por pré-orçamentos no MVP;
   migrar para banco relacional apenas se volume/consulta exigir.
3. Sincronizar conversas recentes e até 50 mensagens por conversa,
   acompanhando o padrão já usado em `whatsapp-leads`.
4. Começar com sync on-demand/manual via Evolution API na etapa 1;
   adicionar persistência por webhook quando a inbox precisar ficar em tempo real.

## 20. Recomendação final

Construir primeiro uma **Inbox de WhatsApp focada em Orçamentos**,
não um clone completo do WhatsApp.

O menor produto útil é: listar conversas, abrir conversa, cruzar com CRM,
extrair pedido e criar pré-orçamento. Isso aproveita o que o Aspen Dashboard
já tem e adiciona valor de vendas direto sem transformar o projeto em uma
plataforma genérica de atendimento.
