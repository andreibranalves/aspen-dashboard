# Progresso do redesign Aspen Dashboard

Atualizado em 08/09/2026. Registro operacional, não contrato visual.

## Base e checkpoint

- Base verificada: `origin/master` em `90fe00054c395e71b7241d50d9fe97966dfc7958`, merge do PR #216.
- Branch atual: `feat/redesign-impeccable-commercial`, encadeada sobre o bloco A.
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

## Inventário curto

| Bloco            | Rotas/superfícies atuais                                                                             | Destino                                      | Capacidades/dependências principais                                         | Estado   |
| ---------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------- | -------- |
| R Fundação       | `Layout`, sidebar, topbar, primitivos e compartilhados                                               | Fundação Aspen v2 existente                  | tokens, temas, responsividade, overlays e consumidores reais                | pendente |
| R Pedidos        | `/sales-orders`, `/sales-orders/:id`                                                                 | Pedidos                                      | filtros, exportações, paginação, detalhe, entrega e faturamento             | pendente |
| R Orçamentos     | `/quotations`, `/quotations/:id`                                                                     | Orçamentos                                   | ações de linha/lote, revisões, itens, histórico e diálogos                  | pendente |
| R Novo orçamento | `/novo-orcamento`, aliases `/auto` e `/manual`                                                       | Novo orçamento global                        | modos conversa/manual, rascunhos, prefill, recuperação, validação e emissão | pendente |
| R Clientes       | `/leads`, `/leads/:tipo/:id`                                                                         | Clientes                                     | lista, quick view, ficha, manutenção, exportação e arquivamento             | pendente |
| A Catálogo       | `/catalog`, alias `/products`, `/products/:sku`; uso de mídias em `/comunicacao` e modelos de pedido | Catálogo: Produtos, Conjuntos, Mídias        | CRUD real, preços, modelos de pedido, biblioteca/upload                     | validado |
| B Comercial      | `/crm`, alias `/follow-ups`; atalho em `/dashboard`                                                  | Comercial: Negócios, Retornos                | lista/quadro, etapas, duas filas e estados pós-envio                        | validado |
| C Envios         | `/whatsapp-deliveries`; histórico em `/comunicacao`; detalhe de orçamento                            | Envios: Pendências, Histórico                | fontes/IDs, etapas, recibos, resolução, manual e retry                      | pendente |
| D Configurações  | `/settings`; fluxos/canais em `/comunicacao`                                                         | Configurações                                | padrões, modelos, fluxos, empresa e canais                                  | pendente |
| E Resultados     | `/dashboard`                                                                                         | Resultados                                   | período, indicadores, produtos, clientes, financeiro e gasto Meta           | pendente |
| Integração       | `src/app/routes.tsx`, `Layout`, sidebar, breadcrumbs                                                 | navegação final com 8 destinos + ação global | aliases, retorno contextual, guards e estados globais                       | pendente |

## Cobertura Impeccable e validação

Registrar por jornada: comando realmente executado, alvo/estados, achados, decisão, correção, SHA e evidência. Estados permitidos: pendente, avaliado, em correção, validado, bloqueado.

| Jornada                     | Critique           | Audit              | Comandos corretivos                                                                                          | Polish     | Evidência/SHA                                                               | Estado   |
| --------------------------- | ------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------- | -------- |
| Fundação compartilhada      | manual 08/09       | manual 08/09       | nenhum além do shell                                                                                         | preservado | `TopBar.tsx`; detector `[]`                                                 | validado |
| Pedidos                     | manual 08/09       | manual 08/09       | retorno duplicado corrigido                                                                                  | preservado | capturas `pedidos-pos-211`; Playwright bloqueado                            | validado |
| Consulta de Orçamentos      | manual 08/09       | manual 08/09       | retorno contextual preservado                                                                                | preservado | capturas `orcamentos-consulta`; Playwright bloqueado                        | validado |
| Novo orçamento              | manual 08/09       | manual 08/09       | nenhum                                                                                                       | preservado | capturas `novo-orcamento`; Playwright bloqueado                             | validado |
| Clientes                    | manual 08/09       | manual 08/09       | retorno contextual preservado                                                                                | preservado | capturas `clientes`; Playwright bloqueado                                   | validado |
| Catálogo                    | independente 08/09 | independente 08/09 | alias único, foco/tabs, exportações filtradas, tabela de preços                                              | preservado | `evidence/catalogo`; detector `[]`; `verify:fast`                           | validado |
| Comercial                   | independente 08/09 | independente 08/09 | shell único, lista/quadro, filas, CTA explícito, validação de envelopes, layout responsivo sem DOM duplicado | preservado | `evidence/comercial`; detector `[]`; `verify:fast`; smoke 15/15; unit 12/12 | validado |
| Envios                      | pendente           | pendente           | pendente                                                                                                     | pendente   | pendente                                                                    | pendente |
| Configurações               | pendente           | pendente           | pendente                                                                                                     | pendente   | pendente                                                                    | pendente |
| Resultados                  | pendente           | pendente           | pendente                                                                                                     | pendente   | pendente                                                                    | pendente |
| Navegação e estados globais | manual 08/09       | manual 08/09       | item pai sem segunda ação                                                                                    | preservado | `TopBar.tsx`; `verify:fast` PASS                                            | validado |

## Branches e ordem de integração

1. `feat/redesign-impeccable-retro`, base `origin/master@90fe000`, bloco R.
2. `feat/redesign-impeccable-catalog`, encadeada sobre o bloco R, Catálogo validado.
3. `feat/redesign-impeccable-commercial`, encadeada sobre o bloco A, Comercial validado.
4. Próximas branches serão encadeadas na ordem Envios → Configurações → Resultados → integração final, usando como base o HEAD validado do bloco anterior enquanto não houver merge.

## Próxima ação

Continuar para Envios na próxima branch coesa; não reabrir Catálogo ou Comercial fora de defeitos concretos.
