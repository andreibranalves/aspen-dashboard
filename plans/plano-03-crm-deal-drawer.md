# Plano 03 — CRM Deal Drawer e Kanban Operacional

> **Origem:** derivado de `plans/prd-erpnext-app-operational-gap-roadmap.md`.
>
> **Dependência:** `plans/plano-01-base-ux-operacional.md`.
>
> **Atenção crítica:** o Kanban deve continuar exibindo todas as colunas, inclusive vazias. Não reintroduzir filtros que removam colunas com `count=0`.

## Objetivo

Transformar o Kanban de CRM em uma ferramenta de acompanhamento operacional, não apenas de movimentação de status.

Ao clicar em um card, o usuário deve conseguir entender o Deal, ver contato/orçamento/follow-up, editar próximo passo e abrir os documentos relacionados sem entrar no ERPNext.

## Resultado esperado

A página `CrmKanbanPage.jsx` terá um drawer lateral de Deal com contexto, ações rápidas e edição segura dos campos operacionais.

## Escopo

### Inclui

1. Endpoint dedicado para detalhe de Deal, preferencialmente `crm-deal-detail.js`.
2. Expansão segura de `crm-update-deal.js` para editar:
   - `status`;
   - `next_step`;
   - `custom_follow_up_stage`.
3. Drawer no Kanban.
4. Badges compactos nos cards:
   - sem orçamento;
   - sem telefone;
   - follow-up pendente;
   - parado há 3+ dias;
   - pedido fechado;
   - origem.
5. Ações rápidas:
   - alterar status;
   - editar próximo passo;
   - editar follow-up stage;
   - abrir orçamento vinculado;
   - WhatsApp;
   - email;
   - abrir no ERPNext.
6. Preservar drag-and-drop existente.
7. Preservar colunas vazias.

### Não inclui

- Inbox completa.
- Comentários complexos.
- Anexos.
- Tarefas recorrentes.
- Automação de follow-up.
- Motivo de perda obrigatório, salvo se campo seguro já existir.

## Arquivos prováveis

- Criar: `api/_functions/crm-deal-detail.js`
- Modificar: `api/_functions/crm-deals.js`
- Modificar: `api/_functions/crm-update-deal.js`
- Modificar: `src/pages/CrmKanbanPage.jsx`
- Usar: `src/components/DetailDrawer.jsx`
- Usar: `src/components/QualityBadges.jsx`
- Usar: `src/components/ContextActions.jsx`
- Usar: `src/lib/erpLinks.js`
- Usar: `src/lib/api.js`
- Usar: `src/lib/constants.js`, se o pipeline estiver centralizado ali.

## API proposta

### `GET /api/crm-deal-detail?id=CRM-DEAL-...`

**Resposta sugerida:**

```json
{
  "success": true,
  "deal": {
    "name": "CRM-DEAL-0001",
    "lead_name": "Cliente Exemplo",
    "email": "cliente@email.com",
    "mobile_no": "11999999999",
    "source": "Instagram",
    "status": "Orcamento Enviado",
    "custom_quotation": "ORC-20261143",
    "custom_quotation_sent_date": "2026-05-20",
    "custom_follow_up_stage": 0,
    "next_step": "Enviar follow-up amanhã",
    "creation": "2026-05-20 10:00:00",
    "modified": "2026-05-20 10:30:00",
    "age_days": 2,
    "erp_url": "https://.../app/crm-deal/CRM-DEAL-0001"
  },
  "quotation": {
    "name": "ORC-20261143",
    "status": "Open",
    "grand_total": 1234.56,
    "erp_url": "https://.../app/quotation/ORC-20261143"
  },
  "quality_flags": ["follow_up_pendente"]
}
```

### `PUT /api/crm-update-deal`

Expandir payload, mantendo compatibilidade com drag-and-drop atual:

```json
{
  "id": "CRM-DEAL-0001",
  "status": "Em Negociacao",
  "next_step": "Ligar amanhã",
  "custom_follow_up_stage": 1
}
```

**Regras:**

- Aceitar atualização parcial.
- Validar status contra pipeline permitido se possível.
- Não aceitar campos arbitrários.
- Retornar Deal atualizado ou payload suficiente para atualizar UI.
- Não quebrar fluxo atual de drag-and-drop.

## Tarefas de implementação

### Tarefa 1 — Auditar Kanban atual

**Objetivo:** mapear estado atual antes de modificar.

**Arquivos a ler:**

- `src/pages/CrmKanbanPage.jsx`
- `api/_functions/crm-deals.js`
- `api/_functions/crm-update-deal.js`
- `src/lib/constants.js`, se existir pipeline compartilhado

**Verificar obrigatoriamente:**

- onde o `PIPELINE_ORDER` é definido no backend;
- onde o `PIPELINE` é definido no frontend;
- como o drag-and-drop chama `crm-update-deal`;
- se `updateKanbanLocal()` mantém colunas vazias;
- shape atual dos cards.

### Tarefa 2 — Criar `crm-deal-detail.js`

**Objetivo:** carregar detalhe de Deal sob demanda.

**Requisitos:**

- Handler ESM seguindo padrão do projeto.
- Aceitar apenas `GET`.
- Validar `id` obrigatório.
- Buscar Deal por `name`.
- Se houver `custom_quotation`, buscar Quotation resumida.
- Calcular `age_days` a partir de `modified`.
- Montar `quality_flags`.
- Retornar `erp_url` quando base do ERP estiver disponível de forma segura.

**Validação:**

```bash
node --check api/_functions/crm-deal-detail.js
```

### Tarefa 3 — Expandir `crm-update-deal.js`

**Objetivo:** permitir edição operacional segura além de status.

**Campos permitidos:**

- `status`
- `next_step`
- `custom_follow_up_stage`

**Cuidados:**

- Atualização parcial.
- Validação de tipo para follow-up stage.
- Não aceitar campos extras.
- Manter compatibilidade com payload atual do drag-and-drop.
- Se status for `Perdido`, não exigir motivo nesta fase, a menos que campo seguro já exista.

**Validação:**

```bash
node --check api/_functions/crm-update-deal.js
npm run build
```

### Tarefa 4 — Adicionar drawer em `CrmKanbanPage.jsx`

**Objetivo:** abrir detalhe ao clicar no card.

**Requisitos:**

- Card continua arrastável.
- Clique no card abre drawer sem atrapalhar drag.
- Estado local:
  - `selectedDealId`
  - `dealDetail`
  - `dealLoading`
  - `dealError`
  - `dealSaving`
- Usar `apiGet` e `apiPut`.
- Ao salvar status no drawer, atualizar Kanban local e manter colunas vazias.
- Ao salvar `next_step` ou follow-up, atualizar card correspondente.

### Tarefa 5 — Adicionar badges nos cards

**Objetivo:** destacar pendências sem pesar visualmente.

**Badges mínimos:**

- `Sem orçamento` quando não houver `custom_quotation`.
- `Sem telefone` quando não houver telefone/mobile.
- `Parado 3+ dias` quando `modified` for antigo.
- `Follow-up` quando `custom_follow_up_stage` indicar pendência.
- Origem como badge info, se houver.

**Cuidado:** não transformar card em tabela. Máximo de badges visíveis deve ser compacto.

### Tarefa 6 — Validar drag-and-drop e colunas vazias

**Validação manual obrigatória:**

- Todas as 7 colunas aparecem mesmo vazias:
  - Novo Lead
  - Contato Feito
  - Orcamento Enviado
  - Em Negociacao
  - Arte Aprovada
  - Pedido Fechado
  - Perdido
- Arrastar card continua funcionando.
- Ao arrastar o último card de uma coluna, a coluna permanece visível.
- Abrir drawer não inicia drag acidental.
- Editar status pelo drawer move o card para a coluna correta.

**Comandos:**

```bash
npm run build
BASE_URL=http://localhost:5173 node scripts/playwright-test-responsive.mjs
```

## Critérios de aceite

- Clicar em card abre Deal Drawer.
- Drawer mostra contato, origem, status, orçamento, valor, follow-up e próximo passo.
- Drawer permite editar status e próximo passo.
- Abrir orçamento vinculado funciona.
- Abrir ERPNext funciona.
- Cards indicam pendências de forma compacta.
- Drag-and-drop atual continua funcionando.
- Colunas vazias continuam visíveis.
- Build passa.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Clique conflitar com drag | Separar handlers e testar card arrastável manualmente. |
| Colunas vazias sumirem | Nunca filtrar colunas por `count > 0`; ordenar por pipeline fixo. |
| `crm-update-deal` aceitar campos perigosos | Allowlist estrita. |
| Drawer e drag atualizarem estado de formas divergentes | Criar função única para atualizar card localmente. |
| Deal sem orçamento vinculado | Mostrar badge `Sem orçamento` e esconder ação de abrir orçamento. |

## Ordem recomendada de commits

1. Endpoint detalhe:

```bash
git add api/_functions/crm-deal-detail.js api/[...path].js
git commit -m "feat: add crm deal detail endpoint"
```

2. Update seguro:

```bash
git add api/_functions/crm-update-deal.js
git commit -m "feat: extend crm deal operational updates"
```

3. Drawer e badges:

```bash
git add src/pages/CrmKanbanPage.jsx
git commit -m "feat: add crm deal drawer"
```
