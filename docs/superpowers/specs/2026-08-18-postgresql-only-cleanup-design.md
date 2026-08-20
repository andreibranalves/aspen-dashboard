# Limpeza PostgreSQL-only

**Status:** Desenho aprovado para planejamento.

## Contexto

O cutover PostgreSQL-only já foi concluído e validado em staging e Production.

O runtime ativo não depende mais de Frappe ou ERPNext, mas o repositório ainda contém superfícies desativadas, adapters antigos, configuração sem uso, testes exclusivos desses caminhos e documentação operacional obsoleta.

A limpeza não pode tratar toda referência histórica ou todo nome legado como código morto.

A tabela `quote_leads` e parte do seu repositório continuam participando de vínculos do CRM, conversas WhatsApp e conversão transacional de orçamento.

As migrations e snapshots Drizzle registram o histórico aplicado do banco e são imutáveis.

## Objetivo

Remover código e configuração legados comprovadamente mortos sem alterar dados, schema, contratos internos ainda usados ou o histórico técnico do projeto.

Ao final, cada item pesquisado deverá estar classificado como removido, preservado por dependência viva ou preservado como histórico.

## Decisões confirmadas

A remoção será orientada por evidência, não por busca textual cega.

As rotas públicas `typebot-lead-capture` e `quote-leads` serão removidas somente depois da confirmação operacional de que não possuem consumidores externos ativos.

O runtime morto de Typebot será removido.

A tabela `quote_leads`, seus dados e o contrato interno mínimo ainda usado serão preservados.

Não haverá migration, alteração de schema, backfill, deleção de dados ou renomeação de tabela nesta fase.

Migrations e snapshots históricos sob `drizzle/` não serão editados, removidos, copiados ou renomeados.

Specs, planos e relatórios históricos serão preservados.

Referências obsoletas serão removidas apenas da documentação operacional vigente.

As flags `STAGING_*` ficam fora desta fase e serão tratadas na Fase 18.

Não serão adicionadas dependências, adapters de compatibilidade, endpoints-túmulo ou novos fallbacks.

## Princípio de prova

Cada candidato deverá receber uma das seguintes classificações antes de qualquer edição:

- **Remover:** não possui entrada ativa, consumidor interno, consumidor externo conhecido, obrigação operacional ou dependência de dados.
- **Preservar vivo:** participa de um fluxo atual ou protege uma invariável atual.
- **Preservar histórico:** registra decisões, evidências ou estado aplicado que não participa do runtime.

A evidência deverá citar arquivos, símbolos, rotas, configuração ou confirmação operacional verificável.

A matriz final e suas evidências serão versionadas em `docs/superpowers/reports/2026-08-18-postgresql-only-cleanup-acceptance.md`.

Um nome antigo, isoladamente, não prova que o item está morto.

A ausência de referência estática também não basta para entradas dinâmicas, webhooks ou consumidores externos.

## Escopo

### Inventário obrigatório

A implementação deverá pesquisar e classificar referências relacionadas a:

- Frappe e ERPNext;
- providers e fallbacks legados;
- `quote_leads` e `quote-leads`;
- Typebot;
- adapters de KV ou compatibilidade antigos;
- variáveis de ambiente antigas;
- rotas e UI de Pré-orçamentos;
- documentação operacional obsoleta;
- testes exclusivos de caminhos removidos.

O inventário deverá cobrir `api/`, `src/`, `scripts/`, `tests/`, `.github/`, `.env.example`, `package.json` e documentação operacional vigente.

Diretórios gerados e artefatos ignorados não serão usados como fonte de verdade.

### Candidatos conhecidos para remoção

Os seguintes itens são candidatos iniciais, sujeitos às provas definidas nesta spec:

- registro das rotas `typebot-lead-capture` e `quote-leads` em `api/_app/routes.ts`;
- handler `api/_modules/typebot-lead-capture.ts`;
- handler HTTP `api/_modules/quote-leads.ts`;
- adapter KV antigo `api/_modules/quote-leads-store.ts`;
- integração Meta CAPI se permanecer consumida apenas pela captura Typebot;
- branches de autenticação e rate limiting exclusivas dessas rotas;
- `TYPEBOT_LEAD_WEBHOOK_TOKEN` e `TYPEBOT_LEAD_CAPTURE_ENABLED`;
- variáveis Meta exclusivas da integração removida, se existirem nos ambientes operacionais;
- testes que validam apenas os módulos removidos;
- documentação operacional que afirma ou orienta uso das superfícies removidas.

Arquivos órfãos descobertos durante a análise poderão ser incluídos somente quando a mesma prova de morte for registrada.

### Itens preservados vivos

A tabela `quote_leads` continuará no schema.

Os dados existentes em `quote_leads` não serão alterados.

O repositório PostgreSQL de leads será reduzido somente se a remoção deixar métodos sem consumidores.

As operações usadas por conversas WhatsApp, CRM e emissão ou conversão de orçamento permanecerão disponíveis.

`convertQuoteLeadInTransaction` e o vínculo transacional usado pela emissão de orçamento serão preservados enquanto tiverem consumidores.

As funções puras de normalização, identidade e merge de leads serão preservadas enquanto sustentarem o repositório PostgreSQL vivo.

A Evolution API continuará como único transporte WhatsApp.

O guard `check-no-legacy-provider` continuará impedindo reintrodução de Frappe e ERPNext.

### Itens preservados históricos

Todo o diretório `drizzle/` será preservado sem alterações.

Specs, planos e relatórios sob `docs/superpowers/` serão preservados mesmo quando mencionarem tecnologias removidas.

Relatórios de cutover e aceitação continuarão disponíveis como trilha de auditoria.

### Fora de escopo

Esta fase não removerá a tabela `quote_leads`.

Esta fase não apagará registros antigos.

Esta fase não condensará flags `STAGING_*`.

Esta fase não reorganizará módulos ativos por domínio.

Esta fase não modificará a estratégia de migrations.

Esta fase não fará deploy, migration, alteração de Vercel, alteração de Typebot, push ou operação externa sem autorização explícita.

Esta fase não fará uma refatoração geral do scanner `check-no-legacy-provider`.

## Precondição operacional

Antes de remover as rotas públicas, a execução deverá obter evidência read-only de que:

- `TYPEBOT_LEAD_CAPTURE_ENABLED` está ausente ou desativada nos ambientes aplicáveis;
- o webhook Typebot está desligado ou seu proprietário confirmou que não aponta mais para a aplicação;
- não existe consumidor externo conhecido de `quote-leads`;
- os logs disponíveis não mostram uso válido dessas rotas durante a janela de retenção acessível;
- a tela de Pré-orçamentos e sua navegação continuam ausentes do frontend.

A inspeção não deverá exibir valores de segredos, credenciais, payloads ou dados pessoais.

Ausência de logs acessíveis não será tratada como prova de inatividade e exigirá confirmação explícita do responsável operacional.

Se qualquer consumidor ativo for encontrado, a remoção correspondente será interrompida e o item será reclassificado como preservado vivo.

Qualquer mutação de configuração externa exigirá autorização separada do usuário.

## Arquitetura após a limpeza

O dispatcher da API não registrará `typebot-lead-capture` nem `quote-leads`.

Chamadas a esses nomes seguirão o comportamento 404 padrão já usado para rotas desconhecidas.

Não haverá handler-túmulo, alias ou resposta de compatibilidade.

A criação interna de lead a partir de WhatsApp continuará chamando diretamente o repositório PostgreSQL.

A emissão de orçamento continuará convertendo o lead vinculado dentro da transação existente.

O repositório de leads conterá apenas operações necessárias a esses fluxos internos.

Nenhum caminho removido poderá reativar KV, Typebot, Meta CAPI, Frappe ou ERPNext como persistência ou provider alternativo.

## Sequência de implementação

### 1. Registrar a linha de base

Executar a suíte local vigente e registrar o estado Git antes das alterações.

Gerar a matriz de inventário com classificação e evidência.

Confirmar as precondições operacionais sem alterar serviços externos.

### 2. Fixar o comportamento esperado

Adicionar ou ajustar um teste estrutural mínimo que falhe enquanto as rotas e variáveis removidas estiverem presentes.

Manter testes dos fluxos internos que dependem de `quote_leads` antes de podar o repositório.

Não criar um scanner genérico novo.

### 3. Remover as entradas mortas

Remover as rotas públicas aprovadas, seus handlers e a configuração exclusiva.

Remover integrações e adapters que ficarem sem consumidores.

Remover testes exclusivos do comportamento eliminado.

### 4. Podar sem redesenhar

Remover exports e métodos que ficarem órfãos.

Preservar nomes e contratos internos ainda usados quando renomeá-los não trouxer benefício para esta fase.

Não introduzir interfaces, factories ou camadas novas para substituir código apagado.

### 5. Atualizar documentação operacional

Atualizar `docs/pre-orcamentos-inbox.md` ou substituí-lo por uma descrição vigente da retenção histórica de dados.

Remover instruções operacionais de Typebot e providers antigos dos documentos ativos.

Não reescrever documentos históricos.

### 6. Validar

Executar verificações estáticas, testes focados, suíte rápida e suíte completa.

Confirmar que nenhum arquivo gerado em `public/` foi versionado.

Confirmar que `drizzle/` permaneceu byte a byte inalterado no diff.

## Tratamento de erros

A ausência das rotas removidas deverá produzir o 404 padrão do dispatcher.

Nenhum detalhe de banco, integração, stack trace, segredo ou dado pessoal será adicionado a respostas ou logs.

Falhas dos fluxos internos preservados continuarão usando mensagens públicas em português brasileiro.

A descoberta de uso operacional ativo é uma condição de parada, não um motivo para adicionar fallback.

## Estratégia de testes

### Testes estruturais

Um teste pequeno deverá verificar que `api/_app/routes.ts` não registra nem importa os handlers removidos.

O mesmo teste, ou uma verificação existente adequada, deverá garantir ausência de `TYPEBOT_*` em código ativo e `.env.example`.

A guarda existente continuará verificando ausência de Frappe e ERPNext no escopo ativo.

Documentos históricos e migrations continuarão fora das proibições textuais aplicadas ao runtime.

### Regressões internas

Testes deverão cobrir a criação de lead por WhatsApp, busca por identidade externa e vínculo com CRM.

Testes deverão cobrir a conversão de lead durante a emissão de orçamento.

Testes deverão confirmar preservação do histórico já vinculado.

Não serão mantidos testes de endpoints deliberadamente removidos além da verificação do 404 padrão, se ela ainda não estiver coberta pelo dispatcher.

### Verificação final

A conclusão exige, no mínimo:

```bash
npm run verify:fast
npm run verify:full
node scripts/check-no-legacy-provider.mjs
git diff --check
```

LSP e lens diagnostics deverão estar limpos nos arquivos alterados.

Testes focados dos fluxos WhatsApp, CRM e emissão de orçamento deverão passar antes da suíte completa.

## Critérios de aceite

As rotas `typebot-lead-capture` e `quote-leads` não estão registradas.

Os módulos mortos de Typebot, HTTP de quote leads, KV e Meta CAPI foram removidos quando comprovadamente órfãos.

As variáveis `TYPEBOT_*` não existem no runtime ativo nem em `.env.example`.

Nenhum consumidor vivo foi removido.

WhatsApp ainda pode criar e reencontrar leads locais.

CRM e emissão de orçamento preservam seus vínculos com leads históricos.

A tabela `quote_leads`, seus dados e o schema correspondente permanecem intactos.

Nenhuma migration histórica foi alterada.

Frappe e ERPNext continuam ausentes do runtime ativo.

Documentação operacional descreve o estado atual sem apagar a trilha histórica.

Não há dependência nova, fallback novo, endpoint-túmulo ou abstração especulativa.

`verify:fast` e `verify:full` terminam com código zero.

`git diff --check`, LSP e lens diagnostics não apresentam erros bloqueantes.

Não há alteração versionada em `public/`.

## Condições de parada

A implementação deverá parar e pedir decisão se encontrar consumidor externo ativo de qualquer rota candidata.

A implementação deverá parar e pedir decisão antes de criar migration ou alterar schema.

A implementação deverá parar e pedir decisão se preservar os fluxos internos exigir um adapter novo ou mudança de contrato público não descrita nesta spec.

A implementação deverá parar antes de qualquer alteração externa sem autorização explícita.
