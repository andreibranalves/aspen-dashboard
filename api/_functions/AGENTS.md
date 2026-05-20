# api/_functions — Handlers & Shared Libs

Internal serverless handlers usados pelo catch-all route `api/[...path].js`.

## Visão Geral

23 arquivos (19 handlers + 4 libs compartilhadas) em `api/_functions/`.
Handlers são importados pelo router `api/[...path].js` conforme o path da requisição.
Shared libs são importadas por um ou mais handlers (não expõem export default).

## Estrutura

```
api/_functions/
├── AGENTS.md              ← este arquivo
├── *.js                   ← handlers (18 com export default + pricing.js shared lib)
├── lib/
│   ├── erpnext.js         # Cliente HTTP ERPNext
│   ├── quotation-html.js  # Geração HTML para orçamento
│   ├── quotation-pdf.js   # Geração PDF
│   └── print-format.js    # Formato de impressão
```

## Handlers

| Arquivo | Descrição |
|---|---|
| `extract.js` | Extração por IA via OpenRouter (texto/imagem → pedidos) |
| `orcamento.js` | Pipeline principal: cria Quotation + CRM Deal |
| `edit-draft.js` | Edição de rascunhos via OpenRouter |
| `view.js` | GET handler — renderiza HTML do orçamento (`text/html`) |
| `pricing.js` | **Shared lib** — brackets/regras de precificação |
| `freight.js` | Cálculo de frete |
| `send-whatsapp.js` | Envio de WhatsApp via Evolution API |
| `leads-clients.js` | Gestão de leads/clientes |
| `crm-deals.js` | Operações CRM deals |
| `crm-update-deal.js` | Atualização de campos de deal |
| `products.js` | Listagem/busca de produtos |
| `product-detail.js` | Detalhe de produto único |
| `product-pricing.js` | Dados de precificação |
| `product-pricing-update.js` | Atualização de preços |
| `pricing-lookup.js` | Consulta direta de preços |
| `quotations.js` | CRUD de orçamentos (GET/PUT/DELETE) |
| `sales-orders.js` | Operações de pedidos de venda |
| `sales-order-from-quotation.js` | Cria Sales Order a partir de Quotation |
| `sales-dashboard.js` | Dashboard de vendas |

## Libs Compartilhadas

| Arquivo | Descrição |
|---|---|
| `lib/erpnext.js` | Cliente HTTP para API do ERPNext |
| `lib/quotation-html.js` | Montagem do HTML do orçamento |
| `lib/quotation-pdf.js` | Geração do PDF do orçamento |
| `lib/print-format.js` | Formato de impressão customizado |

## Convenções

- **ESM only.** Imports locais com extensão `.js` explícita.
- **Erros em português brasileiro.** Mensagens amigáveis, nunca expor erros crus do ERPNext.
- **Handler skeleton padrão.** Seguir o modelo definido na raiz `AGENTS.md`.
- **`view.js`** é o único GET handler; retorna `text/html`.
- **Demais handlers** retornam objetos estruturados consumidos por `api/[...path].js`.
- **`pricing.js`** é shared lib, não tem `export default` de handler.

## Anti-Padrões

- ❌ Nunca expor stack trace ou raw error do ERPNext na resposta HTTP.
- ❌ Nunca usar `require()` / CommonJS — só ESM.
- ❌ Não omitir extensão `.js` em imports locais.
- ❌ `pricing.js` não deve ser registrado como handler no router.
