# Progresso do redesign Aspen Dashboard

Atualizado em 08/09/2026. Registro operacional, não contrato visual.

## Base e checkpoint

- Base verificada: `origin/master` em `90fe00054c395e71b7241d50d9fe97966dfc7958`, merge do PR #216.
- Branch atual: `feat/redesign-impeccable-retro`, criada diretamente dessa base.
- Trabalho anterior não relacionado preservado na branch `fix/quotation-stuck-issuing`, checkpoint local `7d61db6`.
- Alteração local de Andrei em `/opt/data/aspen-dashboard/.gitignore` permanece intocada.
- Goal vigente: `/opt/data/cache/documents/doc_25d697b60cf0_GOAL-ASPEN-DASHBOARD-REDESIGN-COM-IMPECCABLE.md`.
- Relatório corrente consultado: `/opt/data/cache/documents/doc_5052fff59ee7_aspen-revisao-design.md`, revisão de 07/09/2026.

## Impeccable

- Origem: skill global Hermes em `/opt/data/skills/impeccable/SKILL.md`.
- Versão declarada pela skill: `4.2.3`.
- Acionamento disponível: mecanismo de skills do Hermes, com launcher `/opt/data/skills/impeccable/scripts/impeccable` e comandos `/impeccable <comando> <alvo>` tratados como instruções do agente.
- `impeccable context --target src` executado no projeto em 08/09/2026.
- `PRODUCT.md` foi carregado; o launcher não encontrou `DESIGN.md` na raiz. A fonte visual canônica foi carregada diretamente de `docs/design/DESIGN-aspen.md`, sem executar `init` ou `document` e sem criar contrato concorrente.
- Detector automático não está ativo nesta sessão. O detector mecânico deverá ser executado uma vez sobre os alvos alterados após cada acabamento coeso.
- Contexto obrigatório: plataforma web, aplicação operacional interna em pt-BR, operador único experiente, modo **Operate**; priorizar densidade útil, previsibilidade, leitura de dados, estados claros e navegação estável. Preservar identidade e fluxos aprovados.

### Retro BLOCO R — 08/09/2026

- Critique e audit foram feitos como passagem manual única, em contexto reduzido e sem subagente disponível, usando o código atual, a fonte visual `docs/design/DESIGN-aspen.md`, os contextos Figma do arquivo `N8BOVUvLkQImveVtThA5CV` e as capturas versionadas em `docs/design/evidence/`.
- Achado confirmado: `TopBar` mostrava o `BackButton` e mantinha o item pai da trilha como uma segunda ação para o mesmo retorno nas páginas de detalhe.
- Correção mínima: preservar o botão contextual, tornar o item pai da trilha informativo e manter os demais itens navegáveis. Nenhuma mudança de tokens, densidade, copy, contrato de rota, backend ou dependência.
- Polish/craft-floor: revisão de contraste, foco, estados, overflow e responsividade nos consumidores compartilhados; detector mecânico executado uma vez após o acabamento: `detect --json src/components/layout/TopBar.tsx` → `[]`.
- Evidências: Figma e capturas existentes para os estados claro/escuro e larguras 390/1024/1280/1440; tentativa de Playwright permanece bloqueada porque o executável Chromium não existe neste ambiente e não deve ser instalado.

## Inventário curto

| Bloco            | Rotas/superfícies atuais                                                    | Destino                                      | Capacidades/dependências principais                                         | Estado   |
| ---------------- | --------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------- | -------- |
| R Fundação       | `Layout`, sidebar, topbar, primitivos e compartilhados                      | Fundação Aspen v2 existente                  | tokens, temas, responsividade, overlays e consumidores reais                | pendente |
| R Pedidos        | `/sales-orders`, `/sales-orders/:id`                                        | Pedidos                                      | filtros, exportações, paginação, detalhe, entrega e faturamento             | pendente |
| R Orçamentos     | `/quotations`, `/quotations/:id`                                            | Orçamentos                                   | ações de linha/lote, revisões, itens, histórico e diálogos                  | pendente |
| R Novo orçamento | `/novo-orcamento`, aliases `/auto` e `/manual`                              | Novo orçamento global                        | modos conversa/manual, rascunhos, prefill, recuperação, validação e emissão | pendente |
| R Clientes       | `/leads`, `/leads/:tipo/:id`                                                | Clientes                                     | lista, quick view, ficha, manutenção, exportação e arquivamento             | pendente |
| A Catálogo       | `/products`, `/products/:sku`; partes de `/comunicacao` e modelos de pedido | Catálogo: Produtos, Conjuntos, Mídias        | CRUD real, preços, modelos de pedido, biblioteca/upload                     | pendente |
| B Comercial      | `/crm`, `/follow-ups`; pendências em `/dashboard`                           | Comercial: Negócios, Retornos                | lista/quadro, etapas, duas filas e estados pós-envio                        | pendente |
| C Envios         | `/whatsapp-deliveries`; histórico em `/comunicacao`; detalhe de orçamento   | Envios: Pendências, Histórico                | fontes/IDs, etapas, recibos, resolução, manual e retry                      | pendente |
| D Configurações  | `/settings`; fluxos/canais em `/comunicacao`                                | Configurações                                | padrões, modelos, fluxos, empresa e canais                                  | pendente |
| E Resultados     | `/dashboard`                                                                | Resultados                                   | período, indicadores, produtos, clientes, financeiro e gasto Meta           | pendente |
| Integração       | `src/app/routes.tsx`, `Layout`, sidebar, breadcrumbs                        | navegação final com 8 destinos + ação global | aliases, retorno contextual, guards e estados globais                       | pendente |

## Cobertura Impeccable e validação

Registrar por jornada: comando realmente executado, alvo/estados, achados, decisão, correção, SHA e evidência. Estados permitidos: pendente, avaliado, em correção, validado, bloqueado.

| Jornada                     | Critique     | Audit        | Comandos corretivos           | Polish     | Evidência/SHA                                        | Estado   |
| --------------------------- | ------------ | ------------ | ----------------------------- | ---------- | ---------------------------------------------------- | -------- |
| Fundação compartilhada      | manual 08/09 | manual 08/09 | nenhum além do shell          | preservado | `TopBar.tsx`; detector `[]`                          | validado |
| Pedidos                     | manual 08/09 | manual 08/09 | retorno duplicado corrigido   | preservado | capturas `pedidos-pos-211`; Playwright bloqueado     | validado |
| Consulta de Orçamentos      | manual 08/09 | manual 08/09 | retorno contextual preservado | preservado | capturas `orcamentos-consulta`; Playwright bloqueado | validado |
| Novo orçamento              | manual 08/09 | manual 08/09 | nenhum                        | preservado | capturas `novo-orcamento`; Playwright bloqueado      | validado |
| Clientes                    | manual 08/09 | manual 08/09 | retorno contextual preservado | preservado | capturas `clientes`; Playwright bloqueado            | validado |
| Catálogo                    | pendente     | pendente     | pendente                      | pendente   | pendente                                             | pendente |
| Comercial                   | pendente     | pendente     | pendente                      | pendente   | pendente                                             | pendente |
| Envios                      | pendente     | pendente     | pendente                      | pendente   | pendente                                             | pendente |
| Configurações               | pendente     | pendente     | pendente                      | pendente   | pendente                                             | pendente |
| Resultados                  | pendente     | pendente     | pendente                      | pendente   | pendente                                             | pendente |
| Navegação e estados globais | manual 08/09 | manual 08/09 | item pai sem segunda ação     | preservado | `TopBar.tsx`; `verify:fast` PASS                     | validado |

## Branches e ordem de integração

1. `feat/redesign-impeccable-retro`, base `origin/master@90fe000`, bloco R.
2. Próximas branches serão encadeadas na ordem Catálogo → Comercial → Envios → Configurações → Resultados → integração final, usando como base o HEAD validado do bloco anterior enquanto não houver merge.

## Próxima ação

Registrar o SHA do commit desta revisão após os checks e continuar para Catálogo sem reiniciar entregas concluídas. A validação visual automatizada fica pendente até haver um Chromium disponível.
