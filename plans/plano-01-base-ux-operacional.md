# Plano 01 — Base UX Operacional

> **Origem:** derivado de `plans/prd-erpnext-app-operational-gap-roadmap.md`.
>
> **Para Hermes:** este é um plano de execução documental. Implementar em branch própria e validar localmente antes de commit/push/deploy. Não modificar ERPNext nem criar automações sem confirmação explícita.

## Objetivo

Criar a base reutilizável para drill-down operacional no Aspen Orçamento: drawer lateral, badges de qualidade, ações contextuais e links seguros para ERPNext.

Este bloco prepara os demais planos. Ele deve ser pequeno, sem dependências novas e sem alterar comportamento de negócio.

## Resultado esperado

Ao final deste plano, o app terá componentes/padrões reutilizáveis para:

- abrir detalhes em drawer desktop/mobile;
- exibir pendências como badges compactos;
- agrupar ações contextuais como WhatsApp, email, abrir ERPNext, abrir orçamento/pedido e copiar resumo;
- gerar links para documentos ERPNext de forma centralizada.

## Escopo

### Inclui

1. `DetailDrawer` reutilizável.
2. `QualityBadges` reutilizável.
3. `ContextActions` reutilizável.
4. Helper `erpLinks` para URLs do ERPNext.
5. Pequena página/uso de validação visual em uma tela existente, sem mudar regra de negócio.

### Não inclui

- Drawer de Lead/Cliente.
- Drawer de Deal.
- Alterações em endpoints.
- Escrita no ERPNext.
- Novas dependências.
- Recriar componentes shadcn se já houver padrão local suficiente.

## Arquivos prováveis

- Criar: `src/components/DetailDrawer.jsx`
- Criar: `src/components/QualityBadges.jsx`
- Criar: `src/components/ContextActions.jsx`
- Criar: `src/lib/erpLinks.js`
- Possível ajuste mínimo: uma página existente apenas para validar integração visual, se necessário.

## Dependências e premissas

- React/Vite atual.
- Tailwind/shadcn já configurado.
- Lucide React já disponível.
- Sem dependência nova.
- Mensagens e labels em português brasileiro.
- Ícones: somente Lucide, sem emojis.

## Decisões de design

1. **Drawer antes de nova página:** o componente precisa funcionar em desktop como painel lateral e em mobile como tela quase cheia.
2. **Listas continuam leves:** drawer recebe conteúdo via children; busca de dados fica com a página consumidora.
3. **Ações compactas:** evitar botões grandes repetidos. Preferir grupo de ações com ícone + label curto.
4. **Badges sem bloat visual:** badges pequenos, com variações `warning`, `danger`, `info`, `success`.
5. **ERPNext é continuidade:** links devem abrir em nova aba e sempre apontar para a rota ERP correta.

## Tarefas de implementação

### Tarefa 1 — Criar `DetailDrawer`

**Objetivo:** componente base para detalhes laterais.

**Arquivo:** `src/components/DetailDrawer.jsx`

**Requisitos:**

- Props mínimas:
  - `open`
  - `onClose`
  - `title`
  - `description`
  - `actions`
  - `children`
- Desktop:
  - overlay escuro leve;
  - painel à direita;
  - largura aproximada `max-w-xl` ou similar.
- Mobile:
  - ocupar tela cheia ou quase cheia;
  - área interna rolável.
- Acessibilidade mínima:
  - botão fechar com `aria-label`;
  - `Escape` fecha o drawer, se simples implementar.
- Não usar dependência nova.

**Validação:**

```bash
npm run build
```

### Tarefa 2 — Criar `QualityBadges`

**Objetivo:** padronizar badges de pendências e qualidade de dados.

**Arquivo:** `src/components/QualityBadges.jsx`

**Requisitos:**

- Aceitar array de badges:
  - `label`
  - `type`: `warning | danger | info | success`
  - `title` opcional
- Renderizar chips compactos com cores coerentes.
- Suportar lista vazia sem quebrar layout.
- Usar Lucide para alertas quando necessário.

**Exemplos de labels:**

- `Sem telefone`
- `Sem origem`
- `Preço faltando`
- `Vencido`
- `Parado 5 dias`

### Tarefa 3 — Criar `ContextActions`

**Objetivo:** padronizar ações rápidas em drawers e detalhes.

**Arquivo:** `src/components/ContextActions.jsx`

**Requisitos:**

- Receber lista de ações:
  - `label`
  - `href` opcional
  - `onClick` opcional
  - `icon` opcional
  - `disabled` opcional
  - `title` opcional
- Abrir links externos em nova aba quando apropriado.
- Evitar ações desabilitadas invisíveis: mostrar disabled com tooltip/title.
- Não embutir lógica específica de Lead/Deal/Quotation.

### Tarefa 4 — Criar helper de links ERPNext

**Objetivo:** centralizar montagem de URLs ERPNext.

**Arquivo:** `src/lib/erpLinks.js`

**Requisitos:**

- Exportar funções como:
  - `buildErpDocUrl(baseUrl, doctype, name)`
  - `buildQuotationErpUrl(baseUrl, quotationId)`
  - `buildSalesOrderErpUrl(baseUrl, salesOrderId)`
  - `buildCustomerErpUrl(baseUrl, customerId)`
  - `buildLeadErpUrl(baseUrl, leadId)`
  - `buildCrmDealErpUrl(baseUrl, dealId)`
- Fazer `encodeURIComponent` dos IDs.
- Retornar `null` se `baseUrl` ou `name` não existir.
- Não expor segredo; base URL deve vir de dados já retornados por API ou configuração segura existente.

### Tarefa 5 — Validar responsividade

**Objetivo:** garantir que a base não quebra mobile.

**Validação manual sugerida:**

- Desktop 1440px: drawer lateral à direita.
- Tablet 768px: drawer usa largura confortável.
- Mobile 375px: drawer ocupa tela quase cheia e rola internamente.

**Validação automatizada, se aplicável:**

```bash
npm run build
BASE_URL=http://localhost:5173 node scripts/playwright-test-responsive.mjs
```

## Critérios de aceite

- `DetailDrawer` funciona em desktop e mobile.
- `QualityBadges` renderiza badges sem poluir visualmente.
- `ContextActions` cobre links e callbacks simples.
- Helper de ERPNext gera URLs corretas e seguras.
- Nenhuma dependência nova adicionada.
- `npm run build` passa.
- Nenhum fluxo de negócio foi alterado.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Drawer virar componente complexo demais | Manter API simples: layout apenas, conteúdo vem por `children`. |
| Badges ficarem inconsistentes por página | Centralizar classes no componente. |
| Link ERPNext depender de base URL ausente | Helper retorna `null`; UI mostra ação desabilitada ou oculta. |
| Quebra mobile | Testar 375px antes de concluir. |

## Ordem recomendada de commit

Um único commit é suficiente para este plano:

```bash
git add src/components/DetailDrawer.jsx src/components/QualityBadges.jsx src/components/ContextActions.jsx src/lib/erpLinks.js
git commit -m "feat: add operational UX base components"
```
