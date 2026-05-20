# Plano 06 — Integrações Leves e Produtividade

> **Origem:** derivado de `plans/prd-erpnext-app-operational-gap-roadmap.md`.
>
> **Dependências recomendadas:**
> - `plans/plano-01-base-ux-operacional.md`
> - `plans/plano-04-orcamento-contexto-comercial.md`
> - `plans/plano-05-dashboard-alertas-operacionais.md`, se os filtros operacionais já estiverem em uso.
>
> **Regra rígida:** nenhuma compra de frete, envio real de teste ou automação recorrente deve acontecer sem confirmação explícita do usuário.

## Objetivo

Reduzir redigitação e alternância de contexto nas rotinas comerciais: iniciar cotação de frete a partir de orçamento/pedido, copiar resumos prontos para WhatsApp e tornar configurações do WhatsApp Flow Builder portáveis entre navegadores.

## Resultado esperado

O app ganha pequenas integrações de produtividade sem virar ERP/logística completa:

- `Cotar frete` em orçamento/pedido com dados pré-preenchidos;
- `Copiar para WhatsApp` em opções de frete;
- `Copiar resumo` em orçamento e pedido;
- aviso claro de localStorage em Settings;
- export/import JSON dos fluxos WhatsApp.

## Escopo

### Inclui

1. Ação `Cotar frete` a partir de Orçamento.
2. Ação `Cotar frete` a partir de Pedido de Venda.
3. Pré-preenchimento da página de Frete quando houver dados disponíveis:
   - CEP destino;
   - valor segurado;
   - resumo dos itens;
   - sugestão simples de volumes, se já houver dado/preset seguro.
4. Botão `Copiar para WhatsApp` em cada opção de frete.
5. Botão `Copiar resumo` em orçamento.
6. Botão `Copiar resumo` em pedido.
7. Aviso em Settings sobre armazenamento local.
8. Exportar/importar/restaurar padrões dos fluxos WhatsApp.
9. Validação de JSON antes de aplicar import.

### Não inclui

- Compra de etiqueta de frete.
- Rastreamento completo.
- Módulo logístico.
- Salvar frete escolhido no ERPNext, salvo se houver campo/nota seguro aprovado depois.
- Envio real de WhatsApp de teste sem confirmação explícita.
- Configuração multiusuário/global no backend.
- Histórico WhatsApp completo.

## Arquivos prováveis

- Modificar: `src/pages/FreightPage.jsx`
- Modificar: `src/pages/QuotationDetailPage.jsx`
- Modificar: `src/pages/SalesOrderDetailPage.jsx`
- Modificar: `src/pages/SettingsPage.jsx`
- Modificar: `src/lib/whatsappFlows.js`
- Possível criar: `src/lib/copySummaries.js`
- Possível criar: `src/lib/freightPrefill.js`
- Usar: `src/components/ContextActions.jsx`
- Usar: `src/lib/formatters.js`

## Decisões de design

1. **Frete via URL/hash state:** preferir passar dados por query/hash ou `sessionStorage` curto, evitando backend novo.
2. **Sem side effect automático:** abrir Frete pré-preenchido não cota automaticamente se isso puder gerar confusão; usuário deve revisar e clicar para cotar.
3. **Copiar é local:** botões de copiar usam Clipboard API com fallback amigável.
4. **Settings continua localStorage:** export/import resolve portabilidade sem criar backend global prematuro.
5. **Import seguro:** JSON inválido ou schema inválido não substitui configuração atual.

## Fluxo proposto — Cotar frete

### A partir de Orçamento

1. Usuário abre `QuotationDetailPage.jsx`.
2. Clica em `Cotar frete`.
3. App coleta dados disponíveis:
   - valor total do orçamento;
   - endereço/CEP de entrega se já existir;
   - itens resumidos;
   - possível peso/volume se existir dado confiável.
4. App navega para `#/freight` com estado de pré-preenchimento.
5. `FreightPage.jsx` lê o estado, preenche campos e mostra aviso:
   - `Dados importados do orçamento ORC-... Revise antes de cotar.`

### A partir de Pedido

1. Usuário abre `SalesOrderDetailPage.jsx`.
2. Clica em `Cotar frete`.
3. App coleta:
   - valor do pedido;
   - endereço/CEP de entrega;
   - itens resumidos;
   - data/cliente como contexto.
4. Navega para `#/freight` com pré-preenchimento.

## Formato sugerido para prefill

Preferência: `sessionStorage` com ID curto para evitar URL gigante.

```js
{
  "source_type": "quotation",
  "source_id": "ORC-20261143",
  "destination_cep": "00000000",
  "insured_value": 1234.56,
  "items_summary": "30x LNC-SED-70, 30x LNC-CSD-70",
  "customer_name": "Cliente Exemplo"
}
```

URL:

```text
#/freight?prefill=freight-prefill-uuid
```

Se preferir query simples, limitar a dados curtos:

```text
#/freight?cep=00000000&valor=1234.56&origem=quotation&id=ORC-20261143
```

## Tarefas de implementação

### Tarefa 1 — Auditar Frete e detalhes atuais

**Objetivo:** entender como os dados de frete são modelados hoje.

**Arquivos a ler:**

- `src/pages/FreightPage.jsx`
- `api/_functions/freight.js`
- `src/pages/QuotationDetailPage.jsx`
- `src/pages/SalesOrderDetailPage.jsx`
- `src/pages/SettingsPage.jsx`
- `src/lib/whatsappFlows.js`

**Verificar:**

- campos atuais de Frete;
- como CEP e seguro são armazenados em estado;
- se orçamento/pedido já retornam endereço/CEP;
- se já existe helper de copiar texto;
- shape atual dos fluxos WhatsApp.

### Tarefa 2 — Criar helper de resumo copiável

**Objetivo:** centralizar textos para WhatsApp.

**Possível arquivo:** `src/lib/copySummaries.js`

**Funções sugeridas:**

- `buildQuotationSummary(quotation)`
- `buildSalesOrderSummary(order)`
- `buildFreightOptionSummary(option)`
- `copyTextToClipboard(text)` ou manter cópia no componente se já houver padrão.

**Exemplo orçamento:**

```text
Orçamento ORC-20261143 — Cliente Exemplo
Itens: 30x LNC-SED-70, 30x LNC-CSD-70
Total: R$ 1.234,56
Validade: 27/05/2026
```

**Exemplo pedido:**

```text
Pedido SAL-ORD-2026-00001 — Cliente Exemplo
Status: To Deliver and Bill
Itens: 30x LNC-SED-70, 30x LNC-CSD-70
Total: R$ 1.234,56
Entrega prevista: 30/05/2026
```

**Exemplo frete:**

```text
Frete Jadlog: R$ 48,90, prazo estimado de 4 dias úteis.
```

### Tarefa 3 — Adicionar `Cotar frete` em Orçamento

**Frontend:** `src/pages/QuotationDetailPage.jsx`

**Requisitos:**

- Botão/action compacta.
- Se não houver CEP, ainda permitir abrir Frete com valor/itens e aviso `CEP não encontrado`.
- Não cotar automaticamente.
- Usar `sessionStorage` ou query para prefill.

### Tarefa 4 — Adicionar `Cotar frete` em Pedido

**Frontend:** `src/pages/SalesOrderDetailPage.jsx`

**Requisitos:**

- Mesma lógica de prefill.
- Usar endereço de entrega se disponível.
- Usar total do pedido como seguro sugerido.
- Não editar logística no app.

### Tarefa 5 — Ler prefill em `FreightPage.jsx`

**Objetivo:** preencher a página de Frete ao chegar de orçamento/pedido.

**Requisitos:**

- Ler query/hash no mount.
- Buscar payload no `sessionStorage`, se usado.
- Preencher campos disponíveis.
- Mostrar aviso com origem:
  - `Dados importados do orçamento ORC-... Revise antes de cotar.`
  - `Dados importados do pedido SAL-... Revise antes de cotar.`
- Não disparar cotação automaticamente.
- Permitir limpar dados importados.

### Tarefa 6 — Adicionar copiar opção de frete

**Frontend:** `src/pages/FreightPage.jsx`

**Requisitos:**

- Cada opção de transportadora recebe botão `Copiar para WhatsApp`.
- Texto inclui transportadora, preço e prazo.
- Feedback visual curto: `Copiado`.
- Fallback em caso de erro na Clipboard API.

### Tarefa 7 — Adicionar copiar resumo em orçamento e pedido

**Arquivos:**

- `src/pages/QuotationDetailPage.jsx`
- `src/pages/SalesOrderDetailPage.jsx`

**Requisitos:**

- Botão/action compacta.
- Texto curto e útil para WhatsApp.
- Não incluir dados excessivos.
- Feedback visual `Copiado`.

### Tarefa 8 — Aviso de localStorage em Settings

**Frontend:** `src/pages/SettingsPage.jsx`

**Texto sugerido:**

> Estas configurações ficam salvas neste navegador. Se trocar de computador ou navegador, exporte antes ou configure novamente.

**Requisitos:**

- Mostrar perto da seção de WhatsApp flows.
- Não bloquear uso.
- Sem modal obrigatório.

### Tarefa 9 — Export/import/restaurar WhatsApp flows

**Arquivos:**

- `src/pages/SettingsPage.jsx`
- `src/lib/whatsappFlows.js`

**Requisitos:**

- Exportar JSON dos flows atuais.
- Importar JSON com validação antes de aplicar.
- Se inválido, mostrar erro e manter configuração atual.
- Restaurar padrões com confirmação.
- Não fazer envio real.

**Validação mínima do import:**

- JSON parseável.
- Array de flows.
- Cada flow tem `id`, `name`/`label` conforme schema atual e steps válidos.
- Steps não podem quebrar `flowToSequencePayload()`.

### Tarefa 10 — Validar fluxo completo

**Comandos:**

```bash
npm run build
npm run test:whatsapp-flows
npm run test:whatsapp
```

Se ambiente local estiver disponível:

```bash
BASE_URL=http://localhost:5173 node scripts/playwright-test-responsive.mjs
```

**Validação manual:**

- Abrir orçamento → `Cotar frete` → Frete pré-preenchido.
- Abrir pedido → `Cotar frete` → Frete pré-preenchido.
- Cotar frete manualmente → copiar opção.
- Copiar resumo de orçamento.
- Copiar resumo de pedido.
- Exportar flows.
- Importar JSON válido.
- Tentar importar JSON inválido e confirmar que não quebra configuração atual.
- Restaurar padrões com confirmação.

## Critérios de aceite

- Frete pode ser iniciado a partir de orçamento e pedido.
- Dados disponíveis são pré-preenchidos sem cotação automática.
- Usuário consegue copiar opção de frete sem redigitar.
- Usuário consegue copiar resumo de orçamento e pedido.
- Settings explica claramente que flows ficam no navegador.
- Export/import de flows funciona.
- Import inválido não quebra configuração atual.
- Nenhum envio real acontece sem confirmação explícita.
- Build e testes de WhatsApp flows passam.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| URL de Frete ficar gigante | Usar `sessionStorage` com chave curta. |
| Dados importados incorretos cotarem errado | Não cotar automaticamente; mostrar aviso para revisar. |
| Clipboard API falhar | Mostrar fallback/erro amigável. |
| Import quebrar flows | Validar schema antes de salvar. |
| Settings virar backend prematuro | Manter localStorage + export/import; não criar config global. |
| Envio real de teste por acidente | Não implementar teste real sem confirmação explícita. |

## Ordem recomendada de commits

1. Prefill de frete:

```bash
git add src/pages/FreightPage.jsx src/pages/QuotationDetailPage.jsx src/pages/SalesOrderDetailPage.jsx
git commit -m "feat: prefill freight from quotation and sales order"
```

2. Resumos copiáveis:

```bash
git add src/lib/copySummaries.js src/pages/FreightPage.jsx src/pages/QuotationDetailPage.jsx src/pages/SalesOrderDetailPage.jsx
git commit -m "feat: add copyable operational summaries"
```

3. Settings export/import:

```bash
git add src/pages/SettingsPage.jsx src/lib/whatsappFlows.js
git commit -m "feat: add whatsapp flow export import"
```
