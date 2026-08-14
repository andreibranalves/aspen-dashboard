# Ciclo de Emissão e Entrega de Orçamento

**Status:** Desenho aprovado para planejamento.

## Objetivo

Separar preparação, emissão documental e entrega por WhatsApp.

A página `/auto` deve permitir preparar e visualizar um orçamento sem persistência comercial.
O operador deve emitir uma revisão imutável com **Gerar orçamento** e, depois, entregar essa revisão com **Enviar WhatsApp**.
Falhas de PDF ou transporte devem ter estados claros, idempotentes e auditáveis.

## Princípios

Rascunho local não é orçamento.

Prévia não é emissão.

PDF não define estado comercial.

Emissão não significa entrega.

Aceitação pelo provedor não significa entrega no aparelho.

Uma revisão emitida nunca muda.

Retry nunca cria outro número, outra revisão ou outra mensagem sem decisão explícita do operador.

## Linguagem do Domínio

O vocabulário canônico está em [`CONTEXT.md`](../../../CONTEXT.md).

Os estados comerciais canônicos são `rascunho`, `emitido`, `aprovado` e `perdido`.
O termo legado `enviado` deixa de ser estado comercial canônico porque conflita com entrega por WhatsApp.

## Ciclo Comercial

### Rascunho local

O rascunho local existe somente no navegador.
Ele contém cliente, contato, itens, valores exibidos, frete, urgência, template, seções e lead de origem.
Ele permanece editável e não possui número comercial, revisão, validade ou link público.

A aplicação deve persistir o conjunto de rascunhos em `localStorage` e restaurá-lo no reload.
A restauração deve validar versão e formato antes de aceitar os dados.
Conteúdo inválido deve ser descartado sem quebrar a página.

### Prévia

**Visualizar PDF** deve enviar o conteúdo atual para o renderer oficial e devolver um PDF real.
A prévia deve usar os mesmos cálculos de apresentação, template e política de segurança do documento emitido.

A prévia não grava cliente, orçamento, revisão, número, atividade, lead convertido ou token público.
O documento deve exibir **Pré-visualização** em vez de número comercial.

### Emissão

**Gerar orçamento** deve criar uma revisão comercial imutável.
A emissão deve:

1. registrar ou recuperar a tentativa idempotente sem criar entidade comercial;
2. validar cliente, itens, template, pagamento e demais termos obrigatórios;
3. recalcular preços e totais no servidor;
4. comparar os valores autoritativos com os valores vistos pelo operador;
5. montar o snapshot imutável;
6. iniciar a transação comercial e reservar um número candidato sob o lock de escrita existente;
7. renderizar e validar um PDF real do snapshot com esse número;
8. persistir orçamento, revisão, itens, atividade, conversão do lead e conclusão idempotente na mesma transação;
9. reverter número e escritas comerciais se o PDF ou qualquer escrita falhar.

O renderer pode manter a transação aberta por alguns segundos, mas não pode executar transporte WhatsApp ou outra chamada externa dentro dela.

Telefone, fluxo WhatsApp e configuração Evolution não são requisitos de emissão.

A validade comercial começa na emissão.
A prévia não inicia validade.

Se preço, frete ou outro valor autoritativo divergir, a emissão deve retornar HTTP 409 com os valores corrigidos.
A interface deve atualizar o rascunho, destacar as diferenças e exigir novo clique.
Nenhum registro comercial deve ser criado nesse caso.

Se o PDF falhar, nenhum orçamento emitido, revisão ou número deve permanecer.
O rascunho local deve continuar editável.

### Revisões

A primeira emissão cria revisão 1 e um número comercial.

Editar uma revisão emitida deve criar uma cópia local editável.
A emissão dessa cópia deve criar a próxima revisão sob o mesmo número comercial.
A revisão anterior permanece imutável e acessível.

Uma nova revisão não deve alterar nem invalidar o histórico de entrega das revisões anteriores.

### Estados comerciais

O fluxo normal é:

```text
rascunho legado → emitido → aprovado
                         ↘ perdido
```

Novos rascunhos do `/auto` não entram no PostgreSQL.
O estado `rascunho` permanece para registros legados e edição pela tela de detalhe.

Orçamento emitido não pode ser excluído.
Ele pode ser marcado como `perdido`, com motivo auditável.

Orçamento vencido não pode ser entregue por WhatsApp.
O operador deve criar e emitir nova revisão.

## Idempotência da Emissão

O frontend deve gerar uma chave UUID antes da primeira tentativa de emissão e guardá-la com o rascunho local.

A emissão deve associar a chave a um fingerprint canônico do conteúdo solicitado.

Mesma chave e mesmo fingerprint devem devolver a emissão existente.
Mesma chave e fingerprint diferente devem retornar HTTP 409.

Duplo clique, timeout ou perda da resposta não podem reservar outro número nem criar outra revisão.

Alterar conteúdo após uma falha segura deve gerar nova chave antes da próxima tentativa.

Uma tentativa em processamento deve possuir lease finito para não ficar bloqueada após encerramento abrupto da Function.
A retomada da lease deve exigir a mesma chave e o mesmo fingerprint.

## Modelo de Dados

### Tentativas de emissão

`quotation_issue_requests` deve armazenar chave idempotente única, fingerprint canônico, estado, lease, erro público seguro, orçamento e revisão concluídos, criação e atualização.

Estados permitidos devem ser `processing`, `retryable` e `completed`.
A tabela não é entidade comercial e pode existir após falha de validação ou PDF sem consumir número.

A conclusão da tentativa e a persistência da revisão devem ocorrer na mesma transação.
Isso impede o estado em que a revisão existe, mas o replay idempotente não consegue encontrá-la.

### Emissão e validade

`quotations` e `quote_revisions` devem representar emissão com `issued_at` explícito.
A validade deve ser derivada de `issued_at + validade_dias`, e não de `created_at` do rascunho legado.

`quotations` deve aceitar `loss_reason` somente quando o estado for `perdido`.

### Entregas

`quotation_deliveries` deve armazenar uma linha por revisão, com unicidade em `revision_id`.
Ela deve conter telefone normalizado, fluxo congelado, estado público, timestamps, resumo neutro de aceitação, erro público seguro e prazo de retenção diagnóstica.

A reserva KV continua sendo a lease atômica de transporte.
O PostgreSQL é a fonte permanente do resumo comercial e da recuperação da UI.
A conclusão de transporte deve atualizar o resumo PostgreSQL sem copiar payload bruto ou credenciais da Evolution.

## Interface de Emissão

A emissão deve ficar atrás de uma interface pequena:

```ts
interface QuotationIssueInput {
  idempotencyKey: string;
  draft: QuotationDraftInput;
  sourceLeadId?: string;
  sourceQuotationId?: string;
  sourceRevisionId?: string;
}

interface QuotationIssueResult {
  quotationId: string;
  businessNumber: string;
  revisionId: string;
  revisionNumber: number;
  status: 'emitido';
  validUntil: string;
  pdfUrl: string;
}

issueQuotation(input: QuotationIssueInput): Promise<QuotationIssueResult>;
```

A implementação deve esconder validação comercial, pricing, locks, numeração, snapshots, PDF, persistência e conversão de lead.
Callers não devem conhecer transações ou tabelas.

## Interface HTTP

Um endpoint explícito deve emitir a revisão:

```http
POST /api/quotation-issues
Idempotency-Key: <uuid>
Content-Type: application/json
```

O endpoint deve aceitar o rascunho completo e identificadores opcionais de lead ou revisão de origem.

O mesmo recurso deve oferecer consulta read-only para recuperação após reload:

```http
GET /api/quotation-issues?idempotency_key=<uuid>
```

A consulta deve retornar `processing`, `retryable`, `completed` ou 404 sem reiniciar trabalho.

Resposta de sucesso:

```json
{
  "quotation_id": "ORC-20260001",
  "quotation_uuid": "uuid",
  "revision_id": "uuid",
  "revision_number": 1,
  "status": "emitido",
  "valid_until": "2026-08-28",
  "pdf_url": "/api/quotation-preview?id=uuid&format=pdf"
}
```

`/api/orcamento` deve permanecer temporariamente compatível para consumidores legados que criam rascunho persistido.
A página `/auto` deve deixar de usá-lo.

## Documento PDF

O PDF não deve ser armazenado como Blob.

Revisão, itens, cliente, template e seções imutáveis devem ser a fonte do documento.
**Abrir PDF** e a entrega WhatsApp devem re-renderizar dessa fonte.
A UI não deve abrir PDF automaticamente após emissão, evitando pop-up bloqueado e navegação inesperada.

A emissão valida que o snapshot produz PDF válido.
Re-renderizações posteriores devem produzir o mesmo conteúdo comercial, embora bytes possam variar por metadados do renderer.

Se a re-renderização falhar durante WhatsApp, a revisão permanece emitida.
A interface deve mostrar **PDF indisponível. Tentar novamente**.

## Entrega WhatsApp

A entrega aceita somente revisão `emitido`, `aprovado` ou alias legado equivalente.

Antes do transporte, o backend deve validar:

- validade comercial;
- telefone normalizado;
- existência e configuração do fluxo;
- configuração Evolution;
- disponibilidade do PDF;
- limite temporal do fluxo.

O fluxo deve conter exatamente uma etapa de documento `quotation_pdf`.
A entrega deve incluir esse PDF e um link público vinculado à mesma revisão.

O token público deve expirar junto com a validade comercial, limitado a 30 dias.

O fluxo deve caber em orçamento estimado de 45 segundos.
Configuração cuja soma máxima de delays e etapas exceda esse limite deve ser rejeitada antes do transporte.
A Vercel Function permanece com limite de 60 segundos.

Não haverá worker, cron, fila, Blob ou nova dependência para esse fluxo.

## Idempotência da Entrega

A reserva KV atual deve continuar protegendo o transporte por orçamento, revisão e fluxo.

A operação deve congelar revisão, telefone, fluxo e quantidade de etapas antes do primeiro transporte.
Retry seguro deve reutilizar os mesmos dados.

Uma revisão pode ter somente uma operação de entrega.
Outro telefone ou fluxo exige nova revisão.

Antes de qualquer aceitação do provedor, falha segura pode oferecer **Tentar novamente** durante 30 dias.

Após possível aceitação do provedor, retry automático ou manual de transporte deve ficar bloqueado.
O estado deve ser **Reconciliação necessária** até o operador confirmar o resultado.

A UI deve usar **Envio aceito** quando houver apenas aceitação de transporte.
Ela não deve afirmar **Entregue** sem evidência do provedor.

## Histórico de Entrega

Resumo comercial da entrega deve ser permanente no PostgreSQL e vinculado à revisão.
Ele deve incluir destinatário normalizado, fluxo, estado público, timestamps e identificadores neutros de aceitação.

Detalhes técnicos e erro seguro do provedor podem ficar disponíveis por 90 dias.
Dados técnicos vencidos devem ser ocultados ou removidos de forma oportunística, sem cron.

Operação incompleta pode ser retomada por 30 dias.
Depois disso, ela fica somente leitura e exige nova revisão para novo envio.

## Interface de Entrega

A entrega deve ficar atrás de uma interface pequena:

```ts
interface DeliverQuotationInput {
  revisionId: string;
  phone: string;
  flowId: string;
}

interface DeliveryResult {
  status: 'completed' | 'retryable' | 'reconciling' | 'accepted_partial';
  message: string;
  publicLink?: string;
}

deliverQuotation(input: DeliverQuotationInput): Promise<DeliveryResult>;
```

A implementação pode reutilizar o handler e a reserva atuais, mas a interface não deve expor KV, Evolution ou detalhes de CAS ao frontend.

## Experiência no `/auto`

### Antes da emissão

O card mostra:

- **Visualizar PDF**;
- **Gerar orçamento**;
- edição de cliente, itens, valores, template e seções;
- extração adicional.

O botão **Criar orçamento** deixa de existir nesse fluxo.

### Após a emissão

O card fica congelado e mostra:

- selo **Emitido**;
- número comercial e revisão;
- validade;
- **Abrir PDF**;
- seletor de fluxo, com **Já estou em contato** como padrão;
- **Enviar WhatsApp**;
- **Nova revisão**.

Enviar não pede modal adicional.
O clique é ato explícito de entrega de documento já revisado.

O card permanece visível após sucesso como **Emitido · Envio aceito**.

### Recuperação

Reload deve restaurar rascunhos locais válidos.

Rascunho com chave de emissão deve consultar o endpoint idempotente para recuperar eventual emissão concluída.

Card emitido deve consultar o estado de entrega existente para mostrar retry, sucesso ou reconciliação sem duplicar transporte.

## Experiência na Tela de Detalhe

Rascunho legado mantém edição, **Visualizar PDF** e **Emitir orçamento**.

A emissão manual deve usar o mesmo módulo de emissão e as mesmas validações documentais.

Revisão emitida mostra **Abrir PDF**, seletor de fluxo, **Enviar WhatsApp** e **Nova revisão**.

Emissão e entrega permanecem ações separadas.

A exclusão deve ficar disponível somente para rascunho.
Emitido pode ser marcado como `perdido` com motivo.

## Leads e CRM

Lead selecionado no `/auto` deve virar `converted` somente após emissão confirmada.

Falha posterior de PDF durante re-renderização ou de WhatsApp não desfaz emissão nem conversão.

O vínculo com orçamento e revisão deve ser gravado na mesma operação comercial da emissão quando possível.

## Migração de Status

Uma migration nova deve:

1. atualizar `quotations.status = 'enviado'` para `emitido`;
2. atualizar `quote_revisions.status = 'enviado'` para `emitido`;
3. substituir check constraints para aceitar `rascunho`, `emitido`, `aprovado` e `perdido`;
4. preservar IDs, números, versões, datas e histórico.

Leituras devem aceitar `enviado` como alias temporário durante o corte.
Novas escritas nunca devem persistir `enviado`.

A migration não deve emitir rascunhos, criar revisões, remover dados ou alterar conteúdo comercial.

## Compatibilidade

Rascunhos PostgreSQL existentes permanecem editáveis.
Eles não devem ser emitidos, excluídos ou migrados automaticamente.

Endpoints existentes de listagem, detalhe, preview, PDF e link público devem continuar aceitando identificadores atuais.

O endpoint legado `/api/orcamento` permanece durante a transição.
Sua remoção futura exige inventário separado de consumidores.

## Configuração Operacional

Novas emissões devem falhar com mensagem clara enquanto `pagamento` ou outro termo obrigatório estiver ausente.

A configuração Production atual de `pagamento` deve ser corrigida em atividade operacional separada.
Essa configuração não faz parte da alteração de código.

Staging deve continuar com provedores externos desativados e egress bloqueado.

Nenhum deploy, migration, configuração, envio real, commit ou push faz parte da implementação sem autorização separada.

## Segurança e Privacidade

Respostas públicas não devem expor stack traces, configuração Evolution, tokens, payloads do provedor ou erros internos.

Erros de entrega persistidos devem usar mensagens seguras.

Links públicos devem permanecer vinculados a uma revisão e ter TTL finito.

Telefone deve ser normalizado e validado no trust boundary antes de qualquer transporte.

Templates continuam sujeitos à política HTML e Handlebars existente.

## Testes

### Unitários

Cobrir:

- validação e restauração de rascunho local;
- fingerprint canônico;
- replay idempotente e conflito de chave;
- divergência de pricing;
- ausência de pagamento;
- PDF inválido sem persistência;
- validade iniciada na emissão;
- revisão imutável e próxima versão;
- aliases de status;
- exclusão restrita a rascunho;
- fluxo com PDF ausente ou duplicado;
- orçamento de 45 segundos;
- validade e TTL do link;
- retry seguro e reconciliação.

### Integração PostgreSQL

Cobrir:

- primeira emissão;
- concorrência com mesma chave;
- concorrência com chaves diferentes;
- emissão derivada sob mesmo número;
- rollback quando PDF falha;
- conversão de lead;
- migration `enviado` para `emitido`;
- preservação de rascunhos legados.

### E2E

Cobrir no `/auto`:

1. extrair e editar rascunho;
2. recarregar e restaurar estado;
3. visualizar PDF sem persistência;
4. gerar revisão emitida;
5. recuperar emissão após resposta perdida;
6. abrir PDF;
7. enviar por WhatsApp em dry-run/fake;
8. mostrar estado aceito;
9. criar nova revisão local.

Cobrir na tela de detalhe:

1. emitir rascunho legado;
2. impedir edição e exclusão do emitido;
3. enviar revisão emitida;
4. bloquear vencido;
5. marcar `perdido` com motivo.

### Verificação operacional

Staging deve usar provider fake ou dry-run e manter egress bloqueado.

Production deve validar somente emissão e dry-run até autorização de envio controlado.

Canários devem comprovar ausência de duplicação em duplo clique, timeout simulado e reload.

## Critérios de Aceite

O `/auto` não persiste orçamento antes de **Gerar orçamento**.

**Visualizar PDF** não cria número, revisão, cliente ou lead convertido.

**Gerar orçamento** somente confirma emissão depois de PDF válido.

Emissão repetida com a mesma chave nunca duplica número ou revisão.

Card emitido é imutável e permite abrir PDF, enviar WhatsApp e iniciar nova revisão.

Entrega WhatsApp não altera estado comercial.

Status comercial canônico é `emitido`, não `enviado`.

Orçamento vencido, sem pagamento ou com fluxo incompatível não é enviado.

Aceitação incerta nunca causa retry automático.

Rascunhos existentes e contratos legados permanecem funcionais durante a transição.
