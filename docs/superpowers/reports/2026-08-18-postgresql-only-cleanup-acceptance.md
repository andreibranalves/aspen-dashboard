# PostgreSQL-only Cleanup Acceptance

## Resultado

- Status final: `PASS`.
- A guarda estrutural, `verify:fast`, `verify:full`, o build web, os E2E locais e as invariantes de diff passaram.
- A busca literal de referências retorna somente quatro asserções de regressão aprovadas em testes, documentadas abaixo, e não encontra referências ativas em runtime ou configuração.
- Commit de baseline da Task 5: `9d6bd23790a0e72101b91d6591c8fdb0a33a9343`.
- Commits anteriores aceitos: `cf97089fd0880c8aa35245a961bc261e9ed8a22a`, `1481ff47af66dc3e9083e3872f44540bdae323c1`, `3d5dfc3331a09185376b8410e8c88603bc328324` e `9d6bd23790a0e72101b91d6591c8fdb0a33a9343`.
- Último commit de código: `9d6bd23` (`9d6bd23790a0e72101b91d6591c8fdb0a33a9343`).
- Commit ativo de correção dos documentos operacionais: `df7b5a0018a49e84f0caedf9e8c652e933eb6326` (`docs: align operational cutoff procedure`); é docs-only, e `docs/operational-cutoff-procedure.md` é o documento operacional ativo e atualizado.
- Este relatório é o artefato final de aceite, committed after validation; o SHA exato do commit do relatório está registrado no handoff da Task 5 (`.superpowers/sdd/2026-08-18-postgresql-only-cleanup/task-5-report.md`).
- O worktree pós-commit foi verificado limpo e sem arquivos staged.

## Gate operacional

- `TYPEBOT_LEAD_CAPTURE_ENABLED`: `disabled`, conforme a confirmação operacional aprovada; o preflight local não expõe o valor desta chave.
- Webhook Typebot: o responsável pelo sistema confirmou que o Typebot está totalmente desativado há meses e não aponta para `/api/typebot-lead-capture`.
- Consumidores externos de `quote-leads`: o responsável pelo sistema confirmou que não existe consumidor externo conhecido.
- Data da confirmação: registro operacional associado ao plano de `2026-08-18`; o timestamp exato foi redigido.
- Responsável: solicitante ou responsável pelo sistema, identidade redigida.
- Vercel MCP: a consulta foi somente leitura e agrupada por `requestPath` em janelas de 90 e 180 dias para as duas rotas aposentadas.
- O retorno do MCP não trouxe linhas de histórico, inclusive na busca geral, portanto o resultado vazio não é tratado como prova independente de ausência de chamadas.
- A confirmação explícita do responsável foi usada como evidência alternativa autorizada, sem copiar payload, segredo, URL completa ou dado pessoal.

## Matriz de classificação

| Candidato                              | Classificação       | Evidência estática                                                                            | Evidência operacional | Ação/verificação                               |
| -------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------- |
| Rotas Typebot e `quote-leads`          | remover             | `api/_app/routes.ts` não registra as rotas                                                    | gate aprovado         | regressões autenticadas retornam 404           |
| Handlers HTTP aposentados              | remover             | fontes removidas e sem importadores vivos                                                     | gate aprovado         | arquivos removidos nas Tasks 2 e 3             |
| Adapter KV                             | remover             | sem importadores vivos                                                                        | não aplicável         | arquivo removido na Task 3                     |
| Meta CAPI                              | remover             | sem referências ativas a `meta-capi` ou `sendMetaLeadEvent`                                   | não aplicável         | módulo removido na Task 3                      |
| `quote-leads-pure.ts`                  | preservar vivo      | repository e cobertura pura importam a lógica                                                 | não aplicável         | 7 testes focados passaram                      |
| `quote-leads-repository.ts`            | preservar vivo      | WhatsApp e conversão de cotação usam o repository PostgreSQL; CRM mantém cobertura PostgreSQL | não aplicável         | testes focados e regressões completas passaram |
| `drizzle/`                             | preservar histórico | migration `0018_postgres_only_domains.sql` mantém tabela, vínculos e restrições               | não aplicável         | diff vazio                                     |
| `docs/superpowers/`                    | preservar histórico | decisões, briefs e relatórios anteriores permanecem intactos                                  | não aplicável         | nenhum arquivo histórico alterado              |
| `docs/pre-orcamentos-inbox.md`         | atualizar vigente   | descreve a remoção das superfícies e a preservação PostgreSQL                                 | não aplicável         | atualizado na Task 4                           |
| `docs/operational-cutoff-procedure.md` | atualizar vigente   | documento operacional ativo                                                                   | `df7b5a0` docs-only   | atualizado e corrente                          |

## Invariantes `quote_leads` preservadas

- `api/_infrastructure/db/schema.ts:475-515` permanece inalterado desde a base do plano.
- A tabela mantém chave de identidade única e checks para identidade não vazia, e-mail minúsculo, telefone numérico e status permitido.
- `drizzle/0018_postgres_only_domains.sql` permanece inalterada, incluindo as foreign keys de CRM, cotação e `quote_leads`.
- `quote-leads-repository.ts` permanece inalterado e continua exportando `createPostgresQuoteLeadRepository` e `convertQuoteLeadInTransaction`.
- `quote-leads-pure.ts` permanece vivo e é a dependência compartilhada da lógica pura e do repository PostgreSQL.
- `whatsapp-conversations.ts` continua importando o repository PostgreSQL para leitura por external ID e upsert.
- `quotation-issue-repository.ts` continua importando `convertQuoteLeadInTransaction` para conversão transacional.
- A cobertura PostgreSQL e CRM permanece presente; nenhum adapter KV ou fallback de persistência foi reintroduzido.
- Nenhuma migration, snapshot histórico, schema ou dado externo foi alterado.

## Verificações

| Comando                                                                                                                                                                                                                                 | Resultado                                      | Evidência redigida                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/check-no-legacy-provider.mjs`                                                                                                                                                                                             | passed, exit 0                                 | nenhuma saída; nenhum segredo, payload ou PII                                                                                                                                                                                    |
| `npm run verify:fast`                                                                                                                                                                                                                   | passed, exit 0                                 | 741 testes; 713 passed; 28 skipped; 0 failed; 48 suites                                                                                                                                                                          |
| `npm run verify:full`                                                                                                                                                                                                                   | passed, exit 0                                 | verify:fast verde; build web transformou 1756 módulos; 89 E2E passed                                                                                                                                                             |
| `TZ=UTC node --test tests/unit/quote-leads-pure.test.ts tests/unit/quote-leads-postgres.test.ts tests/unit/whatsapp-crm-match.test.ts tests/unit/whatsapp-crm-postgres.test.ts tests/unit/whatsapp-conversations-postgres-only.test.ts` | passed, exit 0                                 | 40 testes; 34 passed; 6 skipped por ausência de `TEST_DATABASE_URL`; 0 failed                                                                                                                                                    |
| `git diff --check`                                                                                                                                                                                                                      | passed, exit 0                                 | nenhum erro de whitespace                                                                                                                                                                                                        |
| `test -z "$(git diff --name-only -- drizzle)"`                                                                                                                                                                                          | passed, exit 0                                 | nenhuma alteração em `drizzle/`                                                                                                                                                                                                  |
| `test -z "$(git diff --name-only -- public)"`                                                                                                                                                                                           | passed, exit 0                                 | nenhuma alteração rastreada em `public/`                                                                                                                                                                                         |
| busca runtime/config sem testes para `TYPEBOT_`, `typebot-lead-capture`, `quote-leads-store`, `meta-capi` e `sendMetaLeadEvent`                                                                                                         | passed, exit 0                                 | nenhuma referência ativa                                                                                                                                                                                                         |
| busca literal da brief incluindo `tests`                                                                                                                                                                                                | passed with approved exception, command exit 1 | somente quatro asserções intencionais em `tests/unit/handle-request.test.ts:99`, `tests/unit/quote-leads-postgres.test.ts:49`, `tests/unit/routes.test.ts:15` e `tests/unit/routes.test.ts:26`; nenhum consumidor runtime/config |
| verificação direcionada de artefatos gerados                                                                                                                                                                                            | passed, exit 0                                 | oito caminhos de JavaScript/source map dos módulos deletados ausentes; saídas de `quote-leads-pure` e `quote-leads-repository` preservadas                                                                                       |
| `npx prettier --check docs/superpowers/reports/2026-08-18-postgresql-only-cleanup-acceptance.md`                                                                                                                                        | passed, exit 0                                 | relatório formatado                                                                                                                                                                                                              |
| diagnósticos de repositório via `npm run lint` e `npm run typecheck`                                                                                                                                                                    | passed, exit 0                                 | incluídos em `verify:fast` e `verify:full`                                                                                                                                                                                       |
| `lsp_diagnostics` nos 28 caminhos alterados                                                                                                                                                                                             | passed, 19 existentes limpos                   | 8 caminhos deletados ausentes; `.env.example` sem servidor LSP                                                                                                                                                                   |
| `lens_diagnostics full` nos 28 caminhos alterados                                                                                                                                                                                       | passed, 0 bloqueantes                          | 20 existentes diagnosticados; 8 deletados ignorados; somente três avisos não bloqueantes em `scripts/postgres-only-canary.mjs`                                                                                                   |

A especificação exige zero erros bloqueantes. O `lsp_diagnostics` recebeu estes 28 caminhos nomeados:

- 19 arquivos existentes e limpos: `api/_app/routes.ts`, `api/_shared/auth.ts`, `api/_shared/external-writes.ts`, `api/_shared/rate-limit.ts`, `docs/operational-cutoff-procedure.md`, `docs/pre-orcamentos-inbox.md`, `docs/superpowers/reports/2026-08-18-postgresql-only-cleanup-acceptance.md`, `scripts/postgres-only-canary.mjs`, `tests/orcamento.spec.js`, `tests/task-8-fix-r1.spec.js`, `tests/task-8-fix-r4.spec.js`, `tests/unit/auth.test.ts`, `tests/unit/external-writes.test.ts`, `tests/unit/handle-request.test.ts`, `tests/unit/postgres-only-canary.test.js`, `tests/unit/pre-quote-fixtures.ts`, `tests/unit/quote-leads-postgres.test.ts`, `tests/unit/quote-leads-pure.test.ts` e `tests/unit/routes.test.ts`.
- 8 caminhos de fonte/teste deletados e ausentes: `api/_infrastructure/integrations/meta-capi/meta-capi.ts`, `api/_modules/quote-leads-store.ts`, `api/_modules/quote-leads.ts`, `api/_modules/typebot-lead-capture.ts`, `tests/unit/meta-capi.test.ts`, `tests/unit/quote-leads-store.test.ts`, `tests/unit/quote-leads.test.ts` e `tests/unit/typebot-lead-capture.test.ts`.
- `.env.example`: unsupported, porque não há servidor LSP disponível para este tipo de arquivo.

O `lens_diagnostics full` diagnosticou os 20 caminhos existentes, pulou os 8 caminhos deletados e encontrou zero achados bloqueantes. Reportou somente três avisos não bloqueantes em `scripts/postgres-only-canary.mjs`: a lista de marcadores exportada não usada e duas advertências das regras existentes para `console.log`. Esses avisos são divulgados com precisão e não violam o gate da especificação, que exige zero erros bloqueantes.

A busca literal não foi corrigida porque as quatro ocorrências são asserções aprovadas que comprovam a ausência das superfícies aposentadas.
Nenhum arquivo de teste foi alterado na Task 5.

## Artefatos gerados

- Os caminhos direcionados para `quote-leads.js`, `quote-leads-store.js`, `typebot-lead-capture.js` e `meta-capi.js`, com seus source maps, estavam ausentes após todos os testes.
- Nenhuma limpeza adicional foi necessária.
- Os artefatos gerados dos módulos vivos `quote-leads-pure` e `quote-leads-repository` foram preservados.
- Nenhum arquivo gerado de `public/` foi incluído no diff.

## Operações não executadas

- migrations contra bancos reais ou externos;
- preflight contra banco real;
- E2E staging;
- deploy;
- push;
- alteração de Vercel, Typebot, PostgreSQL ou qualquer provedor;
- mensagens reais de provider;
- mutações externas.

Os testes PostgreSQL aplicaram as migrations versionadas somente dentro do container local descartável para criar o schema de teste.

## Verificação suplementar do banco de testes

Após a aceitação inicial, foi provisionado um PostgreSQL local descartável em container Docker, exposto somente em loopback, com dados em `tmpfs` e sem volume persistente.

A conexão foi fornecida somente por `TEST_DATABASE_URL` e nunca foi gravada no repositório, no relatório ou no chat.

O teste de duplicação foi executado usando somente `TEST_DATABASE_URL`, sem depender de `TEST_DUPLICATE_DATABASE_URL`.

`npm run verify:fast` passou com 741 testes, 741 pass, 0 skipped, 0 falhas e 48 suites.

`npm run verify:full` passou com os mesmos 741 testes, build web verde e 89 E2E pass.

O runner unitário passou a usar `--test-concurrency=1`, evitando interferência entre fixtures PostgreSQL que compartilham a base de teste.

O follow-up corrigiu fixtures que ainda persistiam o status legado `enviado` após a migration canônica para `emitido`, o fallback de templates estáticos quando outro template já existe, a limpeza de atividades de produto no teste de duplicação, a capitalização esperada no teste de PDF e um seletor E2E ambíguo.

O container e os logs temporários foram removidos ao final da verificação.

`lsp_diagnostics` de follow-up cobriu os 8 arquivos de código/teste alterados e retornou zero diagnostics.

`lens_diagnostics` de follow-up cobriu esses 8 arquivos, `package.json` e este relatório, retornando zero achados bloqueantes e mantendo apenas warnings não bloqueantes já existentes.

## Riscos residuais

- O retorno sem linhas do Vercel MCP não disponibiliza histórico de logs e não substitui observabilidade independente.
- A ausência de consumidores externos e o desligamento do webhook dependem da confirmação operacional redigida do responsável.
- Quatro asserções de teste mantêm nomes aposentados por finalidade de regressão e fazem a busca literal da brief retornar código 1.
- `lens_diagnostics full` mantém três avisos não bloqueantes em `scripts/postgres-only-canary.mjs`: lista de marcadores exportada não usada e duas advertências existentes de `console.log`; não há erros bloqueantes.
- `.env.example` não possui servidor LSP disponível e, por isso, foi reportado como unsupported pelo `lsp_diagnostics`.

## Conclusão

O cleanup PostgreSQL-only foi aceito sem ampliar escopo.
As superfícies aposentadas foram removidas nas Tasks 2 e 3, os mocks e a documentação vigente foram alinhados na Task 4, e a Task 5 registrou as verificações finais.
A tabela `quote_leads`, seu schema, migrations, repository PostgreSQL, vínculos CRM, WhatsApp e conversão transacional permanecem preservados.
