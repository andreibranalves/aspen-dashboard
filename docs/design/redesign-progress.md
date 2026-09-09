# Progresso do redesign Aspen Dashboard

Atualizado em 08/09/2026. Registro operacional, não contrato visual.

## Base e checkpoint

- Base verificada: `origin/master` em `90fe00054c395e71b7241d50d9fe97966dfc7958`, merge do PR #216.
- Branch atual: `feat/redesign-impeccable-results`, encadeada sobre o bloco D.
- Trabalho anterior não relacionado preservado na branch `fix/quotation-stuck-issuing`, checkpoint local `7d61db6`.
- Alteração local de Andrei em `/opt/data/aspen-dashboard/.gitignore` permanece intocada.
- Goal vigente: `/opt/data/cache/documents/doc_25d697b60cf0_GOAL-ASPEN-DASHBOARD-REDESIGN-COM-IMPECCABLE.md`.
- Relatório corrente consultado: `/opt/data/cache/documents/doc_5052fff59ee7_aspen-revisao-design.md`, revisão de 07/09/2026.

## Impeccable

- Origem: skill disponível no agente em `/opt/data/home/.agents/skills/impeccable/SKILL.md`.
- Versão declarada pela skill: `4.2.3`.
- Acionamento disponível: launcher `/opt/data/home/.agents/skills/impeccable/scripts/impeccable`; comandos `/impeccable <comando> <alvo>` tratados como instruções do agente.
- `impeccable context --target src` executado no projeto em 08/09/2026.
- `PRODUCT.md` foi carregado; o launcher não encontrou `DESIGN.md` na raiz. A fonte visual canônica foi carregada diretamente de `docs/design/DESIGN-aspen.md`, sem executar `init` ou `document` e sem criar contrato concorrente.
- Detector mecânico final executado uma vez após a correção responsiva sobre os 7 alvos UI alterados: `detect --json src/app/routes.tsx src/components/layout/Layout.tsx src/features/commercial/pages/CommercialPage.tsx src/features/crm/pages/CrmKanbanPage.tsx src/features/dashboard/pages/DashboardPage.tsx src/features/follow-ups/pages/FollowUpsPage.tsx src/features/follow-ups/components/FollowUpReviewDrawer.tsx` → `[]`.
- Detector mecânico final do BLOCO C executado uma vez após o acabamento: `detect --json src/features/quotations/pages/WhatsAppDeliveriesPage.tsx src/features/communication/components/SendHistoryTab.tsx src/features/communication/pages/ComunicacaoPage.tsx src/features/quotations/pages/QuotationDetailPage.tsx src/lib/api/quotationDeliveryApi.ts` → `[]`.
- Contexto obrigatório: plataforma web, aplicação operacional interna em pt-BR, operador único experiente, modo **Operate**; priorizar densidade útil, previsibilidade, leitura de dados, estados claros e navegação estável. Preservar identidade e fluxos aprovados.

### Retro BLOCO R — 08/09/2026

- Critique e audit foram feitos como passagem manual única, em contexto reduzido e sem subagente disponível, usando o código atual, a fonte visual `docs/design/DESIGN-aspen.md`, os contextos Figma do arquivo `N8BOVUvLkQImveVtThA5CV` e as capturas versionadas em `docs/design/evidence/`.
- Achado confirmado: `TopBar` mostrava o `BackButton` e mantinha o item pai da trilha como uma segunda ação para o mesmo retorno nas páginas de detalhe.
- Correção mínima: preservar o botão contextual, tornar o item pai da trilha informativo e manter os demais itens navegáveis. Nenhuma mudança de tokens, densidade, copy, contrato de rota, backend ou dependência.
- Polish/craft-floor: revisão de contraste, foco, estados, overflow e responsividade nos consumidores compartilhados; detector mecânico executado uma vez após o acabamento: `detect --json src/components/layout/TopBar.tsx` → `[]`.
- Evidências: Figma e 41 capturas versionadas para estados claro/escuro e larguras 390/1024/1280/1440; commit `115fb55`; Chromium existente em `/opt/data/.playwright` foi usado com `PLAYWRIGHT_BROWSERS_PATH=/opt/data/.playwright` e `DOTENV_CONFIG_PATH=/dev/null`. Foram aprovados 27/27 testes de Novo orçamento/Orçamentos e 17/17 de Clientes/Pedidos; o último grupo apresentou uma falha de isolamento ao rodar em paralelo e passou na repetição focada, sem mudança de código.

### BLOCO A — Catálogo — 08/09/2026

- Figma conferido: lista de produtos `14:2`, detalhe/edição/novo/duplicação `108:264`, `60:6`, `109:412`, `108:353`, preços `14:86`/`111:194`, conjunto `60:257`, biblioteca `14:284` e upload `64:55`.
- Implementação: `/catalog` é a entrada canônica com abas Produtos, Conjuntos de produtos e Mídias; `/products` renderiza o mesmo Catálogo com título legado para preservar links/testes; `/products/:sku` permanece o detalhe real. Modelos de pedido, `@modelo`, biblioteca, upload, filtro, remoção e contratos de API foram reutilizados.
- Critique independente: apontou duplicação potencial de superfície, edição indireta de conjunto, densidade e contexto de retorno. Correções aplicadas: alias para a mesma página, painel de mídia sob ação explícita, tabs navegáveis por teclado e contagem de mídia filtrada.
- Audit independente: apontou exportação sem filtros, contraste dos links de produto e SKU malformado. Correções aplicadas: exportações refletem `search/status/order_by` da URL, links usam token `primary-text` e decode de SKU é tolerante a valor inválido. Upload, paginação de mídia e simulação de preço ficaram fora por exigirem contrato/infraestrutura não autorizados.
- Polish/craft-floor: estados de loading, vazio, erro/retry, foco, overlays, long content, dark/light e larguras 390/1024/1280/1440 conferidos; detector mecânico final executado uma vez sobre os alvos alterados: `detect --json ...` → `[]`.
- Evidências: `docs/design/evidence/catalogo/` contém capturas controladas de produtos nos quatro tamanhos e temas, conjunto vazio/erro/modal e mídias/upload. Validação: `verify:fast` PASS; `tests/catalogo.spec.js` 2/2, `tests/products-core.spec.js` 16/16 e `tests/communication-ui-v2.spec.js` 5/5 com worker único.

### BLOCO B — Comercial — 08/09/2026

- Figma conferido: shell Comercial e Negócios `10:2`, Quadro `10:133`, Retornos `123:33`, Sem resposta `10:226`, Após envio `119:84`, estados `120:23`/`121:28` e referência de listas `51:9`.
- Implementação: `/crm` é a entrada Comercial com abas Negócios/Retornos; Negócios alterna Lista/Quadro e filtra etapas; Retornos separa Sem resposta de Após envio. `/follow-ups` permanece como alias legado da fila Após envio para preservar links e testes existentes.
- Dados: a Lista reutiliza o dataset real do CRM e exibe somente campos fornecidos; Sem resposta projeta a fila já disponível em `sales-dashboard`, preservando registros omitidos e sem criar valor, data, atividade ou próximo retorno.
- Critique independente: identificou fragmentação de IA, competição de ações e ambiguidade do CTA de envio. Correções aplicadas: shell único, atalho do Dashboard para Comercial, CTA `Aprovar e enviar retorno` com consequência explícita e motivo da fila visível.
- Audit independente: identificou risco de respostas malformadas, contexto de breadcrumb e ARIA incompleta. Correções aplicadas: validação de envelopes CRM/prune, retorno contextual para Comercial e referências/seleção ARIA nas abas.
- Polish/craft-floor: estados de loading, erro/retry, vazio, foco, overflow, dark/light e larguras 390/1024/1280/1440 conferidos; correção final removeu a duplicação de DOM entre os layouts responsivos sem alterar a composição visual. Detector mecânico final `detect --json ...` → `[]`.
- Evidências: `docs/design/evidence/comercial/` contém 11 capturas controladas mockadas de Negócios Lista claro/escuro (390/1024/1280/1440), Quadro escuro (1440) e Retornos Sem resposta claro/escuro (390), todas verificadas pelas dimensões PNG. No servidor Vite de desenvolvimento, o logo expandido não é servido porque `vite.config.js` aponta `publicDir: static` sem esse diretório; limitação preexistente, fora do diff e sem alteração em `public/`. Validação final: `npm run verify:fast` PASS; Playwright `tests/commercial.spec.js tests/crm-prune.spec.js tests/follow-ups.spec.js tests/dashboard.spec.js --workers=1` 15/15; testes unitários focados CRM/dashboard/follow-ups 12/12.

### BLOCO C — Envios — 08/09/2026

- Figma conferido: shell e lista `15:2`, tabs `15:113`, filtros/status `15:245`, histórico `126:5`/`126:532`, detalhe e resolução `127:13`/`128:14`.
- Implementação: `/whatsapp-deliveries` organiza Pendências e Histórico; a tabela exibe IDs reais, cliente, documento, estado, etapas, atualização e ação. O histórico de `/comunicacao` permanece compatível e oferece atalho para a entrada canônica.
- Dados: histórico e entregas continuam fontes distintas; o drawer consulta o detalhe canônico por ID e conserva aceite, entrega, leitura e fonte de conclusão sem fabricar recibos. Resolução e limpeza da fila permanecem nas operações já existentes.
- Critique/audit/polish: conferidos hierarquia, estados, foco, overflow, responsive, filtros e separação de fontes; o detalhe foi empilhado para evitar colisão entre resolução e etapas.
- Evidências: `docs/design/evidence/envios/` contém referências Figma e capturas mockadas de Pendências, Histórico e drawer. `verify:fast` PASS; teste unitário focado de entregas 9/9; smoke manual Playwright com mocks isolados validou abas, filtros, drawer e overflow 1440px.

### BLOCO D — Configurações — 08/09/2026

- Figma conferido anteriormente pelo worker: padrões `19:2`, modelos `19:88`, HTML `19:166`, fluxos `19:221`, etapas `54:7`, `54:127`, `54:238`, empresa `19:315` e canais `75:46`. Nesta continuação, o contexto visual canônico foi preservado sem nova busca ampla.
- Implementação: `/settings` reúne Padrões, Modelos de documento, Fluxos WhatsApp, Empresa e Canais em abas com estado na URL. O sidebar mantém Configurações como destino canônico; `/comunicacao` continua acessível para compatibilidade dos consumidores existentes, sem item duplicado de navegação.
- Capacidades preservadas: padrões e seções editáveis, modelos com criação/edição/validação/prévia/versões/padrão/arquivamento, fluxos com tipos Texto/Orçamento/Mídia, ordem, intervalos, duplicação/remoção e salvamento explícito, empresa com os seis campos existentes e Canais somente leitura. Nenhum campo ou contagem foi inventado.
- Salvaguardas: troca de aba, fluxo/modelo e navegação externa preservam o guard de alterações pendentes; não há autosave. A prévia usa apenas `iframe sandbox=""` com HTML retornado pela validação; não há `dangerouslySetInnerHTML` na integração de modelos, scripts ou dados reais nas evidências.
- Acabamento manual único: conferidos hierarquia, foco, estados de carregamento/erro/vazio, overflow, responsividade nos tamanhos 390/1024/1280/1440, temas claro/escuro e recolhimento de detalhes técnicos. O detector final foi executado uma vez: `/opt/data/home/.agents/skills/impeccable/scripts/impeccable detect --json src/app/routes.tsx src/features/settings/pages/SettingsPage.tsx src/features/communication/components/ChannelsTab.tsx src/features/communication/components/FlowEditorTab.tsx src/features/quotations/components/QuotationTemplateManager.tsx` → `[]`.
- Evidências: `docs/design/evidence/configuracoes/` contém capturas controladas de Padrões nos quatro tamanhos e temas, abas, foco, confirmação/Escape, vazio, erro, Empresa e Canais. `tests/settings-evidence.spec.js` recriou/confirmou essas capturas com APIs mockadas e sem gravação externa.
- Validação exata: `npm run verify:fast` PASS; `npm run test:unit:focused -- tests/unit/settings.test.ts tests/unit/communication-api.test.ts tests/unit/communication-send-events.test.ts` PASS, 31/31; Playwright `tests/settings.spec.js tests/settings-evidence.spec.js tests/ui-v2-settings-login-notfound.spec.js tests/communication-ui-v2.spec.js tests/communication-email-settings.spec.js --project=chromium --workers=1` PASS, 16/16, com `DOTENV_CONFIG_PATH=/dev/null PLAYWRIGHT_BROWSERS_PATH=/opt/data/.playwright`.

## Inventário curto

| Bloco            | Rotas/superfícies atuais                                                                             | Destino                                      | Capacidades/dependências principais                                         | Estado   |
| ---------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------- | -------- |
| R Fundação       | `Layout`, sidebar, topbar, primitivos e compartilhados                                               | Fundação Aspen v2 existente                  | tokens, temas, responsividade, overlays e consumidores reais                | validado |
| R Pedidos        | `/sales-orders`, `/sales-orders/:id`                                                                 | Pedidos                                      | filtros, exportações, paginação, detalhe, entrega e faturamento             | validado |
| R Orçamentos     | `/quotations`, `/quotations/:id`                                                                     | Orçamentos                                   | ações de linha/lote, revisões, itens, histórico e diálogos                  | validado |
| R Novo orçamento | `/novo-orcamento`, aliases `/auto` e `/manual`                                                       | Novo orçamento global                        | modos conversa/manual, rascunhos, prefill, recuperação, validação e emissão | validado |
| R Clientes       | `/leads`, `/leads/:tipo/:id`                                                                         | Clientes                                     | lista, quick view, ficha, manutenção, exportação e arquivamento             | validado |
| A Catálogo       | `/catalog`, alias `/products`, `/products/:sku`; uso de mídias em `/comunicacao` e modelos de pedido | Catálogo: Produtos, Conjuntos, Mídias        | CRUD real, preços, modelos de pedido, biblioteca/upload                     | validado |
| B Comercial      | `/crm`, alias `/follow-ups`; atalho em `/dashboard`                                                  | Comercial: Negócios, Retornos                | lista/quadro, etapas, duas filas e estados pós-envio                        | validado |
| C Envios         | `/whatsapp-deliveries`; histórico em `/comunicacao`; detalhe de orçamento                            | Envios: Pendências, Histórico                | fontes/IDs, etapas, recibos, resolução, manual e retry                      | validado |
| D Configurações  | `/settings`; fluxos/canais em `/comunicacao`                                                         | Configurações                                | padrões, modelos, fluxos, empresa e canais                                  | validado |
| E Resultados     | `/dashboard`                                                                                         | Resultados                                   | período, indicadores, produtos, clientes, financeiro e gasto Meta           | validado |
| Integração       | `src/app/routes.tsx`, `Layout`, sidebar, breadcrumbs                                                 | navegação final com 8 destinos + ação global | aliases, retorno contextual, guards e estados globais                       | validado |

## Cobertura Impeccable e validação

Registrar por jornada: comando realmente executado, alvo/estados, achados, decisão, correção, SHA e evidência. Estados permitidos: pendente, avaliado, em correção, validado, bloqueado.

| Jornada                     | Critique           | Audit              | Comandos corretivos                                                                                          | Polish                  | Evidência/SHA                                                                        | Estado   |
| --------------------------- | ------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------ | -------- |
| Fundação compartilhada      | manual 08/09       | manual 08/09       | nenhum além do shell                                                                                         | preservado              | `TopBar.tsx`; detector `[]`                                                          | validado |
| Pedidos                     | manual 08/09       | manual 08/09       | retorno duplicado corrigido                                                                                  | preservado              | capturas `pedidos-pos-211`; Playwright retro 17/17                                   | validado |
| Consulta de Orçamentos      | manual 08/09       | manual 08/09       | retorno contextual preservado                                                                                | preservado              | capturas `orcamentos-consulta`; Playwright retro 27/27                               | validado |
| Novo orçamento              | manual 08/09       | manual 08/09       | nenhum                                                                                                       | preservado              | capturas `novo-orcamento`; Playwright retro 27/27                                    | validado |
| Clientes                    | manual 08/09       | manual 08/09       | retorno contextual preservado                                                                                | preservado              | capturas `clientes`; Playwright retro 17/17                                          | validado |
| Catálogo                    | independente 08/09 | independente 08/09 | alias único, foco/tabs, exportações filtradas, tabela de preços                                              | preservado              | `evidence/catalogo`; detector `[]`; `verify:fast`                                    | validado |
| Comercial                   | independente 08/09 | independente 08/09 | shell único, lista/quadro, filas, CTA explícito, validação de envelopes, layout responsivo sem DOM duplicado | preservado              | `evidence/comercial`; detector `[]`; `verify:fast`; smoke 15/15; unit 12/12          | validado |
| Envios                      | independente 08/09 | independente 08/09 | tabs, tabela densa, histórico por fonte, drawer e timestamps                                                 | aplicado 08/09          | `evidence/envios`; `verify:fast`; unit 9/9; smoke mockado                            | validado |
| Configurações               | manual 08/09       | manual 08/09       | abas/URL, guards, prévia sandbox, estados e capacidades preservadas                                          | acabamento manual 08/09 | `evidence/configuracoes`; detector `[]`; `verify:fast`; unit 31/31; Playwright 16/16 | validado |
| Resultados                  | avaliado 08/09     | avaliado 08/09     | estados, tabelas, gráfico real, tabs/URL, edição Meta, adapt/responsive                                      | aplicado 08/09          | `evidence/resultados-integracao`; detector `[]`; Playwright focado 12/12             | validado |
| Navegação e estados globais | manual 08/09       | manual 08/09       | item pai sem segunda ação                                                                                    | preservado              | `TopBar.tsx`; `verify:fast` PASS                                                     | validado |

## Branches e ordem de integração

1. `feat/redesign-impeccable-retro`, base `origin/master@90fe000`, bloco R.
2. `feat/redesign-impeccable-catalog`, encadeada sobre o bloco R, Catálogo validado.
3. `feat/redesign-impeccable-commercial`, encadeada sobre o bloco A, Comercial validado.
4. `feat/redesign-impeccable-shipping`, encadeada sobre o bloco B, Envios validado.
5. `feat/redesign-impeccable-settings`, encadeada sobre o bloco C, Configurações validado.
6. `feat/redesign-impeccable-results`: Resultados e integração final sobre o HEAD validado do bloco anterior.

## Próxima ação

Executar revisão independente integrada e a rodada RELEASE única (`verify:full` com PostgreSQL descartável quando aplicável); corrigir apenas defeitos concretos antes de preparar os PRs.
