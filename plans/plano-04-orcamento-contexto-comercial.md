# Plano 04 — Orçamento com Contexto Comercial

> **Origem:** derivado de `plans/prd-erpnext-app-operational-gap-roadmap.md`.
>
> **Dependências recomendadas:**
> - `plans/plano-01-base-ux-operacional.md`
> - opcionalmente `plans/plano-03-crm-deal-drawer.md`, se for abrir Deal localmente.
>
> **Atenção crítica:** não quebrar edição de itens nem preservação de preço manual em `QuotationDetailPage.jsx`.

## Objetivo

Completar o detalhe de Orçamento para que ele vire uma tela central de venda: além de itens e preço, deve mostrar cliente, contato, origem, CNPJ, endereço, Deal vinculado, follow-up e link direto para ERPNext.

## Resultado esperado

Ao abrir um orçamento, o usuário entende o contexto comercial sem precisar abrir o ERPNext para consultas simples.

## Escopo

### Inclui

1. Botão `Abrir no ERPNext` no detalhe do orçamento.
2. Bloco `Cliente e contato` em `QuotationDetailPage.jsx`.
3. Exibição de:
   - Cliente/Lead;
   - tipo de entidade;
   - ID da entidade;
   - origem;
   - email;
   - telefone;
   - CNPJ;
   - endereço resumido;
   - Deal vinculado;
   - status do Deal;
   - follow-up stage.
4. Indicadores de validade e pendência:
   - orçamento vencido;
   - vence hoje;
   - vence em até 3 dias;
   - sem telefone;
   - sem origem;
   - sem deal;
   - sem pedido vinculado após X dias, se dado existir.
5. Filtros na lista se a API já suportar:
   - origem;
   - `date_from`;
   - `date_to`;
   - cliente;
   - vencidos/vencendo;
   - sem deal;
   - sem origem.
6. Edição leve de metadados somente se for segura e separada da edição de itens.

### Não inclui

- Impostos.
- Contabilidade.
- Condições de pagamento complexas.
- Termos legais completos.
- Price list avançada.
- Mudanças estruturais na geração de PDF.
- Alteração automática de status sem confirmação.

## Arquivos prováveis

- Modificar: `src/pages/QuotationDetailPage.jsx`
- Modificar: `src/pages/QuotationsPage.jsx`
- Modificar: `api/_functions/quotations.js`
- Usar: `src/components/QualityBadges.jsx`
- Usar: `src/components/ContextActions.jsx`
- Usar: `src/lib/erpLinks.js`
- Usar: `src/lib/api.js`
- Possível uso: `api/_functions/lib/client-metadata.js`
- Possível uso: `api/_functions/lib/erpnext.js`

## API esperada

O endpoint `api/_functions/quotations.js` já existe e deve ser expandido somente se o detalhe atual não retornar os dados necessários.

### Detail response sugerido

```json
{
  "success": true,
  "quotation": {
    "name": "ORC-20261143",
    "transaction_date": "2026-05-20",
    "valid_till": "2026-05-27",
    "quotation_to": "Customer",
    "party_name": "CUST-0001",
    "customer_name": "Cliente Exemplo",
    "grand_total": 1234.56,
    "status": "Open",
    "docstatus": 1,
    "utm_source": "Instagram",
    "contact_person": "CONT-0001",
    "contact_email": "cliente@email.com",
    "contact_mobile": "11999999999",
    "customer_address": "ADDR-0001",
    "shipping_address_name": "ADDR-0001",
    "erp_url": "https://.../app/quotation/ORC-20261143"
  },
  "commercial_context": {
    "entity_type": "Customer",
    "entity_id": "CUST-0001",
    "entity_name": "Cliente Exemplo",
    "origem": "Instagram",
    "email": "cliente@email.com",
    "telefone": "11999999999",
    "cnpj": "55458072000179",
    "address_summary": "Rua X, 123 — São Paulo/SP",
    "deal": {
      "name": "CRM-DEAL-0001",
      "status": "Orcamento Enviado",
      "custom_follow_up_stage": 0
    }
  },
  "quality_flags": ["vence_em_breve"]
}
```

## Tarefas de implementação

### Tarefa 1 — Auditar detalhe atual de orçamento

**Objetivo:** identificar quais dados já chegam no frontend.

**Arquivos a ler:**

- `src/pages/QuotationDetailPage.jsx`
- `src/pages/QuotationsPage.jsx`
- `api/_functions/quotations.js`
- `src/lib/api.js`

**Verificar:**

- shape atual da resposta de detalhe;
- como edição de itens funciona;
- como `_rateManual` é preservado;
- se já há `origem`, email, telefone e deal na resposta;
- quais filtros já são aceitos pela API.

### Tarefa 2 — Adicionar `erp_url` no detalhe, se ausente

**Objetivo:** permitir botão `Abrir no ERPNext`.

**Backend:**

- Se o frontend não tem `ERPNEXT_BASE`, retornar `erp_url` pronto.
- Montar URL sem expor segredo.
- Doctype: `quotation`.
- URL esperada: `{ERPNEXT_BASE}/app/quotation/{quotation_id}`.

**Frontend:**

- Mostrar botão com `ExternalLink` ou ícone Lucide equivalente.
- Abrir em nova aba.
- Se URL ausente, esconder ou desabilitar com texto claro.

### Tarefa 3 — Expandir contexto comercial no backend

**Objetivo:** enriquecer o detalhe do orçamento com dados comerciais.

**Dados a tentar buscar:**

- Entidade do orçamento:
  - `quotation_to`
  - `party_name`
  - `customer_name`
- Contact:
  - email;
  - telefone/mobile.
- Customer/Lead:
  - CNPJ;
  - origem.
- Address:
  - resumo de endereço.
- CRM Deal:
  - por `custom_quotation == quotation.name`, preferencialmente;
  - fallback por email somente se seguro.

**Cuidados:**

- Não deixar detalhe lento demais.
- Não buscar documentos completos em massa na listagem.
- Tratar ausência de dados como `null`, não erro fatal.

### Tarefa 4 — Criar bloco `Cliente e contato`

**Objetivo:** exibir contexto no detalhe.

**Frontend:** `src/pages/QuotationDetailPage.jsx`

**Campos:**

- Cliente/Lead.
- Tipo de entidade.
- ID da entidade.
- Origem.
- Email.
- Telefone.
- CNPJ.
- Endereço resumido.
- Deal vinculado.
- Status do Deal.
- Follow-up stage.

**Ações:**

- WhatsApp, se telefone existir.
- Email, se email existir.
- Abrir Deal local ou ERPNext, se disponível.
- Abrir entidade no ERPNext, se URL disponível.

### Tarefa 5 — Adicionar indicadores de atenção

**Objetivo:** mostrar problemas operacionais sem poluir a tela.

**Indicadores no detalhe:**

- Vencido.
- Vence hoje.
- Vence em até 3 dias.
- Sem telefone.
- Sem origem.
- Sem Deal.

**Indicadores na lista, se já houver dados:**

- Vencido/vencendo.
- Sem telefone.
- Sem origem.
- Sem Deal.

**Implementação:** usar `QualityBadges`.

### Tarefa 6 — Filtros avançados em `QuotationsPage.jsx`

**Objetivo:** aproveitar filtros de API já existentes sem criar endpoint novo pesado.

**Antes de implementar:** validar suporte atual em `quotations.js` para:

- `origem`
- `date_from`
- `date_to`
- `cliente`

**Adicionar UI apenas para filtros suportados.** Para filtros ainda não suportados, decidir explicitamente se entram neste plano ou viram backlog.

**Filtros candidatos:**

- origem;
- data inicial/final;
- cliente;
- vencidos;
- vencendo em breve;
- sem deal;
- sem origem.

### Tarefa 7 — Edição leve de metadados, se segura

**Objetivo:** permitir ajustes comerciais sem misturar com edição de itens.

**Campos candidatos:**

- validade;
- prazo de produção;
- contato/email/telefone;
- origem;
- observação interna curta.

**Regra:** edição deve ficar em seção separada da edição de itens/preços.

**Se houver incerteza sobre campo ERPNext:** deixar fora deste plano e documentar como pendência.

### Tarefa 8 — Validar regressão de itens/preço manual

**Obrigatório:** garantir que edição atual de itens continua funcionando.

**Validações:**

- Abrir orçamento existente.
- Alterar quantidade de item com preço automático.
- Alterar item com preço manual e confirmar que `_rateManual` preserva valor.
- Salvar alterações.
- Reabrir detalhe.
- Verificar bloco comercial.

**Comandos:**

```bash
npm run build
```

Se houver teste específico:

```bash
node test_local.mjs
```

## Critérios de aceite

- Detalhe do orçamento mostra contexto comercial sem abrir ERPNext.
- Botão `Abrir no ERPNext` funciona.
- Usuário enxerga contato e origem no detalhe.
- Deal vinculado/status/follow-up aparecem quando existem.
- Lista permite filtrar por origem/data/cliente se API suportar.
- Indicadores de vencimento aparecem corretamente.
- Edição de itens continua preservando preço manual.
- Build passa.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Quebrar edição de itens | Não misturar estado de metadados com `editedItems`; validar manualmente. |
| Detalhe ficar lento | Buscar contexto no endpoint de detalhe, não na lista. |
| Deal não encontrado | Usar `custom_quotation` como vínculo principal; fallback conservador. |
| Campos ERPNext divergentes | Retornar null e exibir `Não informado`, sem erro fatal. |
| Edição leve virar formulário ERP | Limitar campos e deixar link ERPNext para avançado. |

## Ordem recomendada de commits

1. Backend detalhe enriquecido:

```bash
git add api/_functions/quotations.js
git commit -m "feat: enrich quotation commercial context"
```

2. Frontend bloco comercial:

```bash
git add src/pages/QuotationDetailPage.jsx
git commit -m "feat: show quotation commercial context"
```

3. Indicadores/filtros:

```bash
git add src/pages/QuotationDetailPage.jsx src/pages/QuotationsPage.jsx
git commit -m "feat: add quotation operational indicators"
```
