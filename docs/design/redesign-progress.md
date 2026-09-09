# Progresso do redesign Aspen Dashboard

Atualizado em 09/09/2026. Registro operacional, não contrato visual.

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

### Retro BLOCO R — 08–09/09/2026

- Critique e audit foram concluídos por avaliações independentes separadas para Foundation, Pedidos, Consulta de Orçamentos, Novo orçamento e Clientes, usando código, contrato Aspen, contexto Figma e capturas versionadas.
- Achados confirmados e corrigidos: retorno duplicado no `TopBar`, seleção em lote invisível ainda alcançável por teclado, carregamento de rota sem anúncio e região de progresso de Pedido sem nome semântico. A composição aprovada, regras, tokens, densidade, APIs e dependências foram preservados.
- Polish/craft-floor: revisão de contraste, foco, estados, overflow, responsividade e semântica nos consumidores compartilhados; a varredura final integrada dos 15 alvos alterados retornou `[]`.
- Evidências: Figma e 41 capturas versionadas para estados claro/escuro e larguras 390/1024/1280/1440; commit `115fb55`; Chromium existente em `/opt/data/.playwright` foi usado com `PLAYWRIGHT_BROWSERS_PATH=/opt/data/.playwright` e `DOTENV_CONFIG_PATH=/dev/null`. Foram aprovados 27/27 testes de Novo orçamento/Orçamentos e 17/17 de Clientes/Pedidos; o último grupo apresentou uma falha de isolamento ao rodar em paralelo e passou na repetição focada, sem mudança de código.

### BLOCO A — Catálogo — 08/09/2026

- Figma conferido: lista de produtos `14:2`, detalhe/edição/novo/duplicação `108:264`, `60:6`, `109:412`, `108:353`, preços `14:86`/`111:194`, conjunto `60:257`, biblioteca `14:284` e upload `64:55`.
- Implementação: `/catalog` é a entrada canônica com abas Produtos, Conjuntos de produtos e Mídias; `/products` renderiza o mesmo Catálogo com título legado para preservar links/testes; `/products/:sku` permanece o detalhe real. Modelos de pedido, `@modelo`, biblioteca, upload, filtro, remoção e contratos de API foram reutilizados.
- Critique independente: apontou duplicação potencial de superfície, edição indireta de conjunto, densidade e contexto de retorno. Correções aplicadas: alias para a mesma página, edição direta do conjunto escolhido, painel de mídia sob ação explícita, tabs navegáveis por teclado e contagem de mídia filtrada.
- Audit/revisão independente: encontrou exportação com estado de filtros obsoleto, campos de produto sem nome acessível, rótulo incorreto de ordenação, retorno fora da afinidade do Catálogo e perda da biblioteca quando uma remoção falhava. Correções aplicadas na fonte compartilhada de query e nas superfícies correspondentes, com regressões Playwright. Upload, paginação de mídia e simulação de preço ficaram fora por exigirem contrato/infraestrutura não autorizados.
- Polish/craft-floor: estados de loading, vazio, erro/retry, foco, overlays, long content, dark/light e larguras 390/1024/1280/1440 conferidos; detector mecânico final executado uma vez sobre os alvos alterados: `detect --json ...` → `[]`.
- Evidências: `docs/design/evidence/catalogo/` contém capturas controladas de produtos nos quatro tamanhos e temas, conjunto vazio/erro/modal e mídias/upload. Validação: `verify:fast` PASS; `tests/catalogo.spec.js` 2/2, `tests/products-core.spec.js` 16/16 e `tests/communication-ui-v2.spec.js` 5/5 com worker único.

### BLOCO B — Comercial — 08/09/2026

- Figma conferido: shell Comercial e Negócios `10:2`, Quadro `10:133`, Retornos `123:33`, Sem resposta `10:226`, Após envio `119:84`, estados `120:23`/`121:28` e referência de listas `51:9`.
- Implementação: `/crm` é a entrada Comercial com abas Negócios/Retornos; Negócios alterna Lista/Quadro e filtra etapas; Retornos separa Sem resposta de Após envio. `/follow-ups` permanece como alias legado da fila Após envio para preservar links e testes existentes.
- Dados: a Lista reutiliza o dataset real do CRM e exibe somente campos fornecidos; Sem resposta projeta a fila já disponível em `sales-dashboard`, preservando registros omitidos e sem criar valor, data, atividade ou próximo retorno.
- Critique independente: identificou fragmentação de IA, competição de ações e ambiguidade do CTA de envio. Correções aplicadas: shell único, atalho do Dashboard para Comercial, CTA `Aprovar e enviar retorno` com consequência explícita e motivo da fila visível.
- Audit/revisão independente: encontrou corrida entre Sem resposta/Após envio, tabs Lista/Quadro incompletas no teclado, retorno contextual perdido, ação Novo orçamento ausente na Lista, status cru e relação ARIA incorreta. As correções reutilizam a geração de requisição, o roteador hash e o mesmo prefill já usados nas jornadas existentes; os cenários de regressão passaram no Playwright.
- Polish/craft-floor: estados de loading, erro/retry, vazio, foco, overflow, dark/light e larguras 390/1024/1280/1440 conferidos; correção final removeu a duplicação de DOM entre os layouts responsivos sem alterar a composição visual. Detector mecânico final `detect --json ...` → `[]`.
- Evidências: `docs/design/evidence/comercial/` contém 11 capturas controladas mockadas de Negócios Lista claro/escuro (390/1024/1280/1440), Quadro escuro (1440) e Retornos Sem resposta claro/escuro (390), todas verificadas pelas dimensões PNG. A limitação inicial do logo no Vite foi resolvida na integração final com URL de módulo para `logo_branca.svg`, confirmada no bundle, DOM e novas capturas. Validação final: `npm run verify:fast` PASS; Playwright `tests/commercial.spec.js tests/crm-prune.spec.js tests/follow-ups.spec.js tests/dashboard.spec.js --workers=1` 15/15; testes unitários focados CRM/dashboard/follow-ups 12/12.

### BLOCO C — Envios — 08/09/2026

- Figma conferido: shell e lista `15:2`, tabs `15:113`, filtros/status `15:245`, histórico `126:5`/`126:532`, detalhe e resolução `127:13`/`128:14`.
- Implementação: `/whatsapp-deliveries` organiza Pendências e Histórico; a tabela exibe IDs reais, cliente, documento, estado, etapas, atualização e ação. O histórico de `/comunicacao` permanece compatível e oferece atalho para a entrada canônica.
- Dados: Pendências e Histórico são projeções diferentes da mesma outbox PostgreSQL de WhatsApp; o drawer consulta o detalhe canônico por ID e conserva aceite, entrega, leitura e fonte de conclusão sem fabricar recibos. E-mail permanece fora dessa área. Resolução e limpeza da fila permanecem nas operações já existentes.
- Critique/audit/polish: a revisão independente encontrou estado de etapa omitido, parsing permissivo do Histórico, retorno contextual perdido e tabs incompletas no teclado. Todos foram corrigidos; a busca do Histórico declara o limite real de 200 registros e nenhuma contagem adicional foi inventada sem contrato autoritativo.
- Evidências: `docs/design/evidence/envios/` contém referências Figma e capturas mockadas de Pendências, Histórico e drawer. `verify:fast` PASS; teste unitário focado de entregas 9/9; smoke manual Playwright com mocks isolados validou abas, filtros, drawer e overflow 1440px.

### BLOCO D — Configurações — 08/09/2026

- Figma conferido anteriormente pelo worker: padrões `19:2`, modelos `19:88`, HTML `19:166`, fluxos `19:221`, etapas `54:7`, `54:127`, `54:238`, empresa `19:315` e canais `75:46`. Nesta continuação, o contexto visual canônico foi preservado sem nova busca ampla.
- Implementação: `/settings` reúne Padrões, Modelos de documento, Fluxos WhatsApp, Empresa e Canais em abas com estado na URL. O sidebar mantém Configurações como destino canônico; `/comunicacao` continua acessível para compatibilidade dos consumidores existentes, sem item duplicado de navegação.
- Capacidades preservadas: padrões e seções editáveis, modelos com criação/edição/validação/prévia/versões/padrão/arquivamento, fluxos com tipos Texto/Orçamento/Mídia, ordem, intervalos, duplicação/remoção e salvamento explícito, empresa com os seis campos existentes e Canais somente leitura. Nenhum campo ou contagem foi inventado.
- Salvaguardas: troca de aba, fluxo/modelo e navegação externa preservam o guard de alterações pendentes; não há autosave. A prévia usa apenas `iframe sandbox=""` com HTML retornado pela validação; não há `dangerouslySetInnerHTML` na integração de modelos, scripts ou dados reais nas evidências.
- Acabamento manual: conferidos hierarquia, foco, estados de carregamento/erro/vazio, overflow, responsividade nos tamanhos 390/1024/1280/1440, temas claro/escuro e recolhimento de detalhes técnicos. A revisão visual final encontrou o placeholder do editor rico posicionado sobre o `TopBar`; a causa era o elemento absoluto sem bloco de referência e foi corrigida no componente compartilhado.
- Evidências: `docs/design/evidence/configuracoes/` contém capturas controladas e estabilizadas de Padrões nos quatro tamanhos e temas, abas, foco, confirmação/Escape, vazio, erro, Empresa e Canais. `tests/settings-evidence.spec.js` aguarda fontes/animações, restaura scroll e verifica a posição dos placeholders antes das capturas, sem gravação externa.
- Validação exata: `npm run verify:fast` PASS; `npm run test:unit:focused -- tests/unit/settings.test.ts tests/unit/communication-api.test.ts tests/unit/communication-send-events.test.ts` PASS, 31/31; Playwright `tests/settings.spec.js tests/settings-evidence.spec.js tests/ui-v2-settings-login-notfound.spec.js tests/communication-ui-v2.spec.js tests/communication-email-settings.spec.js --project=chromium --workers=1` PASS, 16/16, com `DOTENV_CONFIG_PATH=/dev/null PLAYWRIGHT_BROWSERS_PATH=/opt/data/.playwright`.

## Polish integrado e lane RELEASE — 09/09/2026

- A revisão independente final da cadeia de `90fe00054c395e71b7241d50d9fe97966dfc7958` ao HEAD não confirmou P0/P1. Os dois P2 concretos encontrados, teclado das abas de Resultados e edição contextual de conjunto no Catálogo, foram corrigidos antes da rodada final.
- As revisões independentes tardias por jornada revelaram bloqueadores adicionais de acessibilidade, sincronização de filtros, corrida assíncrona, retorno contextual e interpretação de entregas. Todos os P1 reproduzíveis foram corrigidos em `b9276f6`; o polish visual e a estabilização das evidências ficaram em `2a3e94b`; o isolamento determinístico das lanes com PostgreSQL e os últimos contratos E2E ficaram em `6e73678`.
- Playwright focado integrado: 75/75 PASS, worker único, Chromium em `/opt/data/.playwright`, `DOTENV_CONFIG_PATH=/dev/null`, cobrindo Catálogo, Comercial, Histórico, Pedidos, Orçamentos, Novo orçamento e Envios. `tests/settings-evidence.spec.js`: 1/1 PASS e capturas regeneradas.
- `npm run verify:fast`: PASS. Detector Impeccable final dos 16 alvos de markup alterados: `[]`.
- PostgreSQL descartável: como Docker/Podman não estavam disponíveis, PostgreSQL 17 foi desempacotado apenas em `/opt/data/cache` e iniciado localmente em porta isolada. `npm run test:postgres`: PASS, 127/127, em banco novo.
- `npm run verify:full`: PASS no HEAD integrado, com banco descartável novo, porta Playwright isolada e ambiente sem `.env`: `verify:fast`, 1182 unitários, build e 190 Playwright passaram; 1 cenário condicionado foi ignorado pela própria suíte.

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
| Fundação compartilhada      | independente 08/09 | independente 08/09 | retorno duplicado, seleção invisível e loading sem anúncio corrigidos                                        | aplicado 09/09          | `TopBar`, `BulkActionBar`, `PageLoader`; detector `[]`                               | validado |
| Pedidos                     | independente 08/09 | independente 08/09 | retorno e região de progresso corrigidos                                                                     | aplicado 09/09          | capturas `pedidos-pos-211`; regressões no lote 75/75                                 | validado |
| Consulta de Orçamentos      | independente 08/09 | independente 08/09 | retorno contextual e fixtures correntes preservados                                                          | aplicado 09/09          | capturas `orcamentos-consulta`; regressões no lote 75/75                             | validado |
| Novo orçamento              | independente 08/09 | independente 08/09 | fixtures ajustadas ao contrato corrente sem alterar a jornada aprovada                                       | preservado              | capturas `novo-orcamento`; regressões no lote 75/75                                  | validado |
| Clientes                    | independente 08/09 | independente 08/09 | retorno contextual preservado                                                                                | preservado              | capturas `clientes`; regressões no lote 75/75                                        | validado |
| Catálogo                    | independente 08/09 | independente 08/09 | exportação sincronizada, labels, contexto, erro de remoção e edição direta                                   | aplicado 09/09          | `evidence/catalogo`; detector `[]`; regressões no lote 75/75                         | validado |
| Comercial                   | independente 08/09 | independente 08/09 | corrida, teclado, contexto, prefill, status e ARIA corrigidos                                                | aplicado 09/09          | `evidence/comercial`; detector `[]`; regressões no lote 75/75                        | validado |
| Envios                      | independente 08/09 | independente 08/09 | estado de etapa, parser, contexto, teclado e limite do Histórico corrigidos                                  | aplicado 09/09          | `evidence/envios`; detector `[]`; regressões no lote 75/75                           | validado |
| Configurações               | worker + integrada | worker + integrada | placeholder, evidências, abas/URL, guards, prévia sandbox e estados                                          | aplicado 09/09          | `evidence/configuracoes`; detector `[]`; captura 1/1; Playwright 16/16               | validado |
| Resultados                  | worker + integrada | worker + integrada | estados, tabelas, gráfico real, tabs/URL, edição Meta e teclado                                              | aplicado 09/09          | `evidence/resultados-integracao`; detector `[]`; Playwright focado 12/12             | validado |
| Navegação e estados globais | integrada 09/09    | integrada 09/09    | item pai sem segunda ação, aliases, afinidade e logo empacotado                                              | aplicado 09/09          | revisão independente final; `verify:fast` PASS                                       | validado |

## Branches e ordem de integração

1. `feat/redesign-impeccable-retro`, base `origin/master@90fe000`, bloco R.
2. `feat/redesign-impeccable-catalog`, encadeada sobre o bloco R, Catálogo validado.
3. `feat/redesign-impeccable-commercial`, encadeada sobre o bloco A, Comercial validado.
4. `feat/redesign-impeccable-shipping`, encadeada sobre o bloco B, Envios validado.
5. `feat/redesign-impeccable-settings`, encadeada sobre o bloco C, Configurações validado.
6. `feat/redesign-impeccable-results`: Resultados e integração final sobre o HEAD validado do bloco anterior.

## Próxima ação

Publicar a cadeia de branches e abrir os PRs empilhados, sem merge ou deploy de produção.
