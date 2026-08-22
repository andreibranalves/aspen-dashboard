# Auditoria de UI/UX — Aspen Orçamento

**Data:** 2026-08-21 · **Branch:** `feat/ui-improvements` · **Escopo:** frontend (`src/`)

Método: 5 auditorias paralelas por subagentes (UI/design system, UX de fluxos,
acessibilidade, responsividade, performance) + inspeção visual de 15 capturas
reais (12 rotas em desktop 1440×900, 3 telas em modo escuro) + detector
determinístico (impeccable). Apenas leitura; nenhum arquivo de app foi alterado.

---

## Veredicto geral

Base sólida: tokens semânticos coerentes (Alpine), dark mode consistente,
skeletons bem feitos, filtros/paginação na URL, bundle saudável (~104 KB entry,
rotas code-split). Os problemas concentrados são **consistência de feedback,
terminologia pt-BR e estados mortos** (botões desabilitados sem explicação,
empty states não acionáveis, becos sem saída). Nada exige reescrita; quase tudo
é correção dirigida.

## Prioridade P0 — perda de dados / ações destrutivas

1. **Formulário manual sem persistência nem guarda de navegação**
   `ManualOrcamentoPage` mantém tudo em useState; clicar em qualquer item da
   sidebar descarta o formulário inteiro. `setNavigationGuard` existe
   (`useHashRoute.ts:52`) mas nenhuma página usa. "Limpar tudo"
   (ManualOrcamentoPage.tsx:1124) apaga sem confirmar.
2. **Fluxo Auto: "Limpar"/"Limpar lista" destroem rascunhos com 1 clique**
   AutoQuotePage.tsx:854/945 → handleReset/clearResults apagam rascunhos não
   emitidos do localStorage sem confirmação nem undo. Item de "Recentes"
   sobrescreve texto em edição sem avisar (:900).
3. **Cancelamento de edição no detalhe descarta alterações sem confirmar**
   QuotationDetailPage.tsx:1263 (`resetEditor`) — itens/preços/seções editados
   somem.

## Prioridade P1 — fluxo central travado ou confuso

4. **~20 pontos usam `confirm()`/`alert()`/`prompt()` nativos** apesar de existir
   `ConfirmDialog` (usado em só 2 telas): exclusões de orçamentos/produtos/
   clientes, emitir, arquivar em massa, motivo de perda via window.prompt
   (QuotationDetailPage.tsx:656), validações do manual (:366).
5. **"Enviar WhatsApp" desabilitado para sempre após 1º envio, sem explicação**
   SplitResultCard.tsx:650 / QuotationDetailPage.tsx:1306. Com `hideButton`,
   o aviso de fluxo inválido também some (WhatsAppSendPanel.tsx:131). Erros de
   envio aparecem no painel esquerdo, longe do botão.
6. **CRM: cards não clicáveis, conversão só por drag-and-drop** (inviável em
   touch), status crus sem acento ("Orcamento Enviado", constants.ts:2-10),
   falha de movimento silenciosa (:222), empty state "Nenhum deal no pipeline"
   (:304).
7. **Empty states não acionáveis**: orçamentos (:463), clientes (:331),
   produtos (:287), pedidos (:409 — manda "criar um novo pedido" que não existe
   em lugar nenhum da tela). Nenhum distingue base vazia de filtro sem resultado.
8. **Sem ponte lead/cliente → orçamento**: LeadDetailPage e drawer não oferecem
   "Criar orçamento para este cliente"; obriga redigir/rebuscar contato depois.
9. **Foco de teclado invisível**: `*:focus-visible { outline: none }` global
   (index.css:183-185) sem substituição universal; maioria dos botões fica sem
   indicador. ConfirmDialog compartilhado sem role=dialog/foco/Esc
   (ConfirmDialog.tsx). Linhas de tabela clicáveis só por mouse.
10. **Inbox WhatsApp expõe dado ruim**: lista dominada por "Contato sem nome /
    Telefone não identificado"; payload de extração como JSON cru
    (WhatsAppInboxPage.tsx:487); "Atualizar" vs "Sincronizar" sem diferença
    clara.

## Prioridade P2 — consistência

11. **Terminologia pt-BR instável**: mesmo estado = "Emitido"/"Enviado"/
    "Rascunho persistido" (QuotationsPage.tsx:47 vs QuotationDetailPage.tsx:43 vs
    ManualOrcamentoPage.tsx:449); "Email"/"E-mail" alternam na mesma tela;
    template × modelo × Modelo HTML; deal; status sem acento. Criar mapa único
    `STATUS_LABELS` + glossário.
12. **Navegação**: breadcrumb cru em /comunicação (Layout.tsx:31); sidebar não
    destaca seção-pai em detalhe (Sidebar.tsx:76 compara rota exata);
    "Orçamentos" em "Cadastros" embora seja o fluxo central; WhatsApp e
    Comunicação com ícone idêntico; rotas desconhecidas caem no Auto sem 404
    (App.tsx:32); três "homes" diferentes (login→/quotations, default→/auto,
    breadcrumb Início→/dashboard).
13. **Toasts improvisados**: sem sistema global; LeadDetailPage sem auto-dismiss
    (:229), ProductDetailPage com 5 s (:548); exclusões silenciosas.
14. **Tabelas**: coluna E-mail repetindo "E-mail não enviado" em toda linha
    (ruído); badges Rascunho/Enviado quase idênticos; 4 ações por linha só com
    ícones; preços de produtos quebrando em 2 linhas.
15. **Responsivo (desktop-first, baixa urgência)**: kanban sem ação alternativa
    ao drag; inbox empilha 3 blocos com scrolls aninhados abaixo de xl;
    SalesOrderDetailPage tabela sem overflow-x-auto; barra de ações da
    QuotationDetailPage sem flex-wrap; alvos de toque < 40 px (chips py-1,
    ícones p-1); excluir mídia existe só no hover.
16. **Código morto**: cluster órfão DraftReviewCard/CustomerMetadataForm/
    DraftItemTable diverge do fluxo real e tem bug latente (índice como draftIdx)
    + classe inválida `hover:bg-destructive/100/10` (5 ocorrências).

## Performance (saudável — manter)

Entry ~104 KB + vendor 189 KB, rotas lazy, ícones tree-shaken (27 KB),
polling de entregas com backoff por estado (1,5 s → 5 s → 15 s, para em
terminal), imagens da mídia com `loading="lazy"`, cache de produtos 5 min.
Único alerta do detector: fonte Inter genérica — opcional trocar por uma face
com mais personalidade mantendo pesos atuais.

## Quick wins (≤ 30 min cada)

1. `/comunicacao`: "Comunicação" no PAGE_LABELS (Layout.tsx:31).
2. Sidebar: destaque por prefixo em vez de igualdade (Sidebar.tsx:76).
3. Corrigir `hover:bg-destructive/100/10` → `/10` (5 arquivos).
4. Padronizar "E-mail".
5. Botão nos empty states (Novo Orçamento / Criar cliente).
6. title/mensagem no Enviar WhatsApp desabilitado.
7. Rótulos pt-BR acentuados no kanban (mapear PIPELINE).
8. Link "Abrir orçamento" no sucesso do manual (ManualOrcamentoPage.tsx:438).
9. Toast do LeadDetailPage com auto-dismiss de 5 s.
10. 404 simples para rotas sem match (App.tsx:32).

## Plano sugerido (ordem)

1. **Segurança de dados** (P0 1-3): persistir rascunho do manual + guarda de
   navegação + confirmações nas limpezas.
2. **Feedback unificado** (P1 4, P2 13): ConfirmDialog everywhere + toast global
   leve.
3. **Estados mortos visíveis** (P1 5,7,8 + quick wins 5-9).
4. **Glossário pt-BR + STATUS_LABELS central** (P2 11) e navegação (P2 12).
5. **A11y floor** (P1 9): ring global de focus-visible + ConfirmDialog acessível.


---

## Log de iterações (gate de 3 revisores independentes)

| Rodada | Notas (A/B/C) | Principais correções aplicadas |
|---|---|---|
| 1 | 7–8 / 4–7.5 / 6–9 | Rascunho do manual persistente + guarda de navegação; ConfirmDialog acessível + toast global; labels canônicos pt-BR; 404; navegação; migração de confirm/alert |
| 2 | 7.5–8 / 6–7 / 6.5–9.5 | Botões desabilitados legíveis; nbsp em moeda; CRM com colunas+CTAs; nowrap em células; chips unificados; 'Ativo' verde consistente; skeleton em Envios |
| 3 | — | Estado vazio exclusivo no CRM; CTA persistente; KPIs com ritmo uniforme; normalizeUom; chips semânticos no inbox; Salvar só quando dirty |

Critério: APPROVED exige 10/10 dos 3 revisores por tela. Iterações continuam até
as correções restantes serem preferência subjetiva, não defeito.
