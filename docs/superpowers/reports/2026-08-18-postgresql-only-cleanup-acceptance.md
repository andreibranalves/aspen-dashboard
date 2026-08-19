# PostgreSQL-only Cleanup Acceptance

## Resultado

- Status final: `PASS`.
- A guarda estrutural, `verify:fast`, `verify:full`, o build web, os E2E locais e as invariantes de diff passaram.
- A busca literal de referências retorna somente quatro asserções de regressão aprovadas em testes, documentadas abaixo, e não encontra referências ativas em runtime ou configuração.
- Commit de baseline da Task 5: `9d6bd23790a0e72101b91d6591c8fdb0a33a9343`.
- Commits anteriores aceitos: `cf97089fd0880c8aa35245a961bc261e9ed8a22a`, `1481ff47af66dc3e9083e3872f44540bdae323c1`, `3d5dfc3331a09185376b8410e8c88603bc328324` e `9d6bd23790a0e72101b91d6591c8fdb0a33a9343`.
- Último commit de código antes do aceite: `9d6bd23790a0e72101b91d6591c8fdb0a33a9343`.
- This report is the final acceptance artifact and is committed; o SHA exato do commit do relatório está registrado no handoff da Task 5 (`.superpowers/sdd/2026-08-18-postgresql-only-cleanup/task-5-report.md`).
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

| Candidato                      | Classificação       | Evidência estática                                                                            | Evidência operacional | Ação/verificação                               |
| ------------------------------ | ------------------- | --------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------- |
| Rotas Typebot e `quote-leads`  | remover             | `api/_app/routes.ts` não registra as rotas                                                    | gate aprovado         | regressões autenticadas retornam 404           |
| Handlers HTTP aposentados      | remover             | fontes removidas e sem importadores vivos                                                     | gate aprovado         | arquivos removidos nas Tasks 2 e 3             |
| Adapter KV                     | remover             | sem importadores vivos                                                                        | não aplicável         | arquivo removido na Task 3                     |
| Meta CAPI                      | remover             | sem referências ativas a `meta-capi` ou `sendMetaLeadEvent`                                   | não aplicável         | módulo removido na Task 3                      |
| `quote-leads-pure.ts`          | preservar vivo      | repository e cobertura pura importam a lógica                                                 | não aplicável         | 7 testes focados passaram                      |
| `quote-leads-repository.ts`    | preservar vivo      | WhatsApp e conversão de cotação usam o repository PostgreSQL; CRM mantém cobertura PostgreSQL | não aplicável         | testes focados e regressões completas passaram |
| `drizzle/`                     | preservar histórico | migration `0018_postgres_only_domains.sql` mantém tabela, vínculos e restrições               | não aplicável         | diff vazio                                     |
| `docs/superpowers/`            | preservar histórico | decisões, briefs e relatórios anteriores permanecem intactos                                  | não aplicável         | nenhum arquivo histórico alterado              |
| `docs/pre-orcamentos-inbox.md` | atualizar vigente   | descreve a remoção das superfícies e a preservação PostgreSQL                                 | não aplicável         | atualizado na Task 4                           |

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
| `lsp_diagnostics` nos dois arquivos de relatório                                                                                                                                                                                        | passed, 0 diagnostics                          | `.superpowers/sdd/2026-08-18-postgresql-only-cleanup/task-5-report.md` e `docs/superpowers/reports/2026-08-18-postgresql-only-cleanup-acceptance.md` retornaram 0 diagnostics                                                    |
| `lens_diagnostics full` no relatório de aceite                                                                                                                                                                                          | passed, 0 primary findings                     | no issues / 0 primary findings                                                                                                                                                                                                   |

A busca literal não foi corrigida porque as quatro ocorrências são asserções aprovadas que comprovam a ausência das superfícies aposentadas.
Nenhum arquivo de teste foi alterado na Task 5.

## Artefatos gerados

- Os caminhos direcionados para `quote-leads.js`, `quote-leads-store.js`, `typebot-lead-capture.js` e `meta-capi.js`, com seus source maps, estavam ausentes após todos os testes.
- Nenhuma limpeza adicional foi necessária.
- Os artefatos gerados dos módulos vivos `quote-leads-pure` e `quote-leads-repository` foram preservados.
- Nenhum arquivo gerado de `public/` foi incluído no diff.

## Operações não executadas

- migrations;
- preflight contra banco real;
- E2E staging;
- deploy;
- push;
- alteração de Vercel, Typebot, PostgreSQL ou qualquer provedor;
- mensagens reais de provider;
- mutações externas.

## Riscos residuais

- 28 testes de `verify:fast` e `verify:full` permanecem skipped porque `TEST_DATABASE_URL` não está configurada neste workspace.
- O retorno sem linhas do Vercel MCP não disponibiliza histórico de logs e não substitui observabilidade independente.
- A ausência de consumidores externos e o desligamento do webhook dependem da confirmação operacional redigida do responsável.
- Quatro asserções de teste mantêm nomes aposentados por finalidade de regressão e fazem a busca literal da brief retornar código 1.

## Conclusão

O cleanup PostgreSQL-only foi aceito sem ampliar escopo.
As superfícies aposentadas foram removidas nas Tasks 2 e 3, os mocks e a documentação vigente foram alinhados na Task 4, e a Task 5 registrou as verificações finais.
A tabela `quote_leads`, seu schema, migrations, repository PostgreSQL, vínculos CRM, WhatsApp e conversão transacional permanecem preservados.
