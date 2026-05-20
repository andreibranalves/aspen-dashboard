# Plano 05 — Dashboard Acionável e Alertas Operacionais

> **Origem:** derivado de `plans/prd-erpnext-app-operational-gap-roadmap.md`.
>
> **Dependências recomendadas:**
> - `plans/plano-01-base-ux-operacional.md`
> - `plans/plano-04-orcamento-contexto-comercial.md`, para filtros/indicadores de orçamento.
>
> **Objetivo de produto:** fazer o Dashboard responder “o que preciso fazer hoje?”, sem virar BI completo.

## Objetivo

Adicionar uma camada de alertas operacionais e cards clicáveis no Dashboard, destacando gargalos acionáveis:

- orçamentos sem follow-up ou vencidos;
- deals parados;
- pedidos atrasados/pendentes;
- produtos com preço incompleto;
- leads sem telefone/origem.

## Resultado esperado

O Dashboard deixa de ser apenas analítico e passa a funcionar como fila de trabalho. Cada card de ação leva o usuário para a página correspondente já filtrada, quando possível.

## Escopo

### Inclui

1. Seção `Ações pendentes` no `DashboardPage.jsx`.
2. Cards clicáveis com contagem e breve explicação.
3. Expansão de `sales-dashboard.js` para retornar agregados operacionais leves.
4. Links para páginas filtradas:
   - orçamento parado/vencido → Orçamentos;
   - deal parado → CRM;
   - pedido atrasado → Pedidos;
   - produto sem preço → Produtos;
   - lead sem origem/telefone → Leads.
5. Alertas em Pedidos de Venda:
   - entrega atrasada;
   - entrega parcial;
   - faturamento pendente;
   - pedido aberto há muitos dias;
   - pedido sem orçamento de origem.
6. Alertas em Produtos:
   - preço completo/incompleto;
   - faixas faltantes;
   - filtro por categoria/status/preço.

### Não inclui

- BI completo.
- Gráficos complexos.
- Forecast automático.
- Automação de follow-up.
- Criação de Delivery Note ou Sales Invoice.
- Edição de estoque/faturamento/logística.
- Escrita em ERPNext para corrigir preços em massa.

## Arquivos prováveis

- Modificar: `src/pages/DashboardPage.jsx`
- Modificar: `api/_functions/sales-dashboard.js`
- Modificar: `src/pages/ProductsPage.jsx`
- Modificar: `src/pages/ProductDetailPage.jsx`, se auditoria de faixas ainda não estiver clara.
- Modificar: `api/_functions/products.js`
- Modificar: `api/_functions/product-detail.js`
- Modificar: `src/pages/SalesOrdersPage.jsx`
- Modificar: `src/pages/SalesOrderDetailPage.jsx`
- Modificar: `api/_functions/sales-orders.js`
- Usar: `src/components/QualityBadges.jsx`
- Usar: `src/lib/api.js`

## API proposta

### Expandir `GET /api/sales-dashboard`

Adicionar objeto `pending_actions` sem quebrar campos atuais:

```json
{
  "success": true,
  "metrics": {},
  "pending_actions": {
    "stale_quotations": {
      "count": 4,
      "label": "Orçamentos parados",
      "href": "#/quotations?attention=stale"
    },
    "stale_deals": {
      "count": 3,
      "label": "Deals parados",
      "href": "#/crm?attention=stale"
    },
    "late_sales_orders": {
      "count": 2,
      "label": "Pedidos atrasados",
      "href": "#/sales-orders?attention=late"
    },
    "products_missing_price": {
      "count": 5,
      "label": "Produtos com preço faltando",
      "href": "#/products?price_status=missing"
    },
    "leads_missing_data": {
      "count": 8,
      "label": "Leads incompletos",
      "href": "#/leads?quality=missing-contact"
    },
    "expiring_quotations": {
      "count": 6,
      "label": "Orçamentos vencendo/vencidos",
      "href": "#/quotations?validity=attention"
    }
  }
}
```

**Regra de performance:** cada contagem deve usar consultas limitadas/agregadas, sem carregar documentos completos em massa.

## Tarefas de implementação

### Tarefa 1 — Auditar Dashboard e endpoints atuais

**Objetivo:** entender os dados já disponíveis.

**Arquivos a ler:**

- `src/pages/DashboardPage.jsx`
- `api/_functions/sales-dashboard.js`
- `src/pages/ProductsPage.jsx`
- `api/_functions/products.js`
- `src/pages/SalesOrdersPage.jsx`
- `api/_functions/sales-orders.js`
- `src/pages/LeadsPage.jsx`
- `api/_functions/leads-clients.js`
- `src/pages/QuotationsPage.jsx`
- `api/_functions/quotations.js`

**Verificar:**

- quais filtros via query/hash já existem;
- shape atual das métricas;
- se há suporte a origem/data/cliente em orçamentos;
- se produtos já retornam status de preço completo;
- se pedidos já retornam `delivery_date`, `per_delivered`, `per_billed`.

### Tarefa 2 — Definir thresholds operacionais

**Objetivo:** tornar alertas consistentes.

**Sugestões iniciais:**

- Deal parado: `modified` há 3+ dias e status não final.
- Orçamento parado: aberto há 3+ dias sem pedido vinculado.
- Orçamento vencendo: vence hoje ou em até 3 dias.
- Orçamento vencido: `valid_till` anterior a hoje.
- Pedido atrasado: `delivery_date` anterior a hoje e `per_delivered < 100`.
- Faturamento pendente: `per_billed < 100` em pedido fechado/entregue ou docstatus relevante.
- Produto com preço incompleto: falta alguma faixa Aspen `30, 100, 300, 500, 1000`.
- Lead incompleto: sem telefone ou sem origem.

**Importante:** se alguma regra depender de campo incerto, implementar como melhor esforço e documentar limitação.

### Tarefa 3 — Expandir `sales-dashboard.js` com `pending_actions`

**Objetivo:** retornar contagens de ações pendentes.

**Requisitos:**

- Manter resposta anterior compatível.
- Cada contagem deve ter fallback para `0` em erro parcial, com `console.warn`, sem derrubar dashboard inteiro.
- Evitar buscar itens completos se só precisa de contagem.
- Limitar consultas com filtros ERPNext.
- Não expor detalhes brutos de erro.

**Validação:**

```bash
node --check api/_functions/sales-dashboard.js
npm run build
```

### Tarefa 4 — Criar seção `Ações pendentes` no Dashboard

**Objetivo:** exibir cards clicáveis.

**Frontend:** `src/pages/DashboardPage.jsx`

**Requisitos:**

- Card com:
  - número;
  - label;
  - descrição curta;
  - ícone Lucide;
  - link para página filtrada.
- Estados:
  - loading;
  - vazio: `Nenhuma ação pendente relevante`;
  - erro parcial: não quebrar dashboard todo.
- Evitar excesso visual.

### Tarefa 5 — Implementar navegação com filtros via hash/query

**Objetivo:** cards abrem página já filtrada.

**Exemplos:**

- `#/quotations?validity=attention`
- `#/crm?attention=stale`
- `#/sales-orders?attention=late`
- `#/products?price_status=missing`
- `#/leads?quality=missing-contact`

**Requisitos:**

- Usar padrão existente de hash router.
- Se a página ainda não suportar o filtro, implementar leitura mínima de query param.
- Se o filtro for complexo demais, abrir página com busca/filtro aproximado e manter card útil.

### Tarefa 6 — Alertas em Sales Orders

**Objetivo:** destacar pedidos problemáticos na lista e detalhe.

**Campos necessários:**

- `delivery_date`
- `per_delivered`
- `per_billed`
- `status`
- vínculo de orçamento, se disponível

**Badges:**

- `Entrega atrasada`
- `Entrega parcial`
- `Faturamento pendente`
- `Aberto há X dias`
- `Sem orçamento origem`

**Fora de escopo:** editar entrega/faturamento.

### Tarefa 7 — Alertas/filtros em Produtos

**Objetivo:** encontrar SKUs com preço incompleto.

**Lista de Produtos:**

- filtro por categoria;
- filtro ativo/inativo;
- filtro preço completo/faltando;
- opcional: sem imagem.

**Detalhe do Produto:**

- mostrar status das faixas Aspen:
  - 30;
  - 100;
  - 300;
  - 500;
  - 1000.
- origem do preço:
  - Pricing Rule por faixa;
  - Pricing Rule SKU;
  - Item Price.
- status OK/faltando.
- link ERPNext da regra/preço se possível.

### Tarefa 8 — Validar performance e responsividade

**Comandos:**

```bash
npm run build
BASE_URL=http://localhost:5173 node scripts/playwright-test-responsive.mjs
```

**Validação manual:**

- Dashboard carrega em tempo aceitável.
- Cards aparecem com números coerentes.
- Clicar card leva à página correta.
- Produtos com preço faltando aparecem no filtro.
- Pedido atrasado aparece destacado.
- Mobile não fica poluído.

## Critérios de aceite

- Dashboard tem seção de ações pendentes.
- Cada card abre página correspondente com filtro ou contexto equivalente.
- Pedidos problemáticos ficam visualmente evidentes.
- Produtos com preço incompleto são fáceis de encontrar.
- Dashboard não vira BI complexo.
- Performance continua aceitável.
- Build passa.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Dashboard ficar lento | Usar contagens leves, limites e fallback parcial. |
| Filtros por hash inconsistentes | Implementar parsing simples e documentado por página. |
| Alertas falsos positivos | Usar labels conservadores e thresholds claros. |
| Visual virar painel poluído | Limitar número de cards e priorizar ação. |
| Produto sem preço exigir consulta pesada | Calcular status no endpoint de produtos com campos mínimos, ou limitar auditoria ao detalhe. |

## Ordem recomendada de commits

1. Backend dashboard:

```bash
git add api/_functions/sales-dashboard.js
git commit -m "feat: add dashboard pending actions"
```

2. Frontend dashboard:

```bash
git add src/pages/DashboardPage.jsx
git commit -m "feat: show actionable dashboard cards"
```

3. Produtos e pedidos:

```bash
git add src/pages/ProductsPage.jsx src/pages/ProductDetailPage.jsx api/_functions/products.js api/_functions/product-detail.js src/pages/SalesOrdersPage.jsx src/pages/SalesOrderDetailPage.jsx api/_functions/sales-orders.js
git commit -m "feat: add operational alerts for products and sales orders"
```
