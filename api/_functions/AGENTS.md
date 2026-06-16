# api/\_functions — Handlers & Shared Libs

Internal serverless handlers usados pelo catch-all route `api/[...path].js`.

## Visão Geral

35 arquivos (26 handlers + 9 shared libs) em `api/_functions/`.
Handlers são importados pelo router `api/[...path].js` conforme o path da requisição.
Shared libs são importadas por um ou mais handlers (não expõem export default).

## Estrutura

```
api/_functions/
├── AGENTS.md              ← este arquivo
├── *.js                   ← handlers (27 com export default + pricing.js shared lib)
├── lib/
│   ├── erpnext.js         # Cliente HTTP ERPNext + createHttpError
│   ├── quotation-html.js  # Geração HTML para orçamento
│   ├── quotation-pdf.js   # Geração PDF (Puppeteer + Chromium)
│   ├── print-format.js    # Formato de impressão
│   ├── quote-response.js  # Estrutura de resposta da cotação
│   ├── quote-pipeline.js  # Pipeline de criação de orçamento
│   ├── deal-resolution.js # Resolução de CRM Deal
│   ├── customer-resolution.js # Resolução de Customer/Contact
│   └── client-metadata.js # Validação de CNPJ, lead source, endereço
```

## Handlers

| Arquivo                         | Descrição                                                        |
| ------------------------------- | ---------------------------------------------------------------- |
| `extract.js`                    | Extração por IA via OpenRouter (texto/imagem → pedidos)          |
| `orcamento.js`                  | Pipeline principal: cria Quotation + CRM Deal                    |
| `edit-draft.js`                 | Edição de rascunhos via OpenRouter                               |
| `view.js`                       | GET handler — renderiza HTML do orçamento (`text/html`, público) |
| `pricing.js`                    | **Shared lib** — brackets/regras de precificação                 |
| `send-whatsapp.js`              | Envio de WhatsApp via Evolution API                              |
| `whatsapp-flows.js`             | GET/PUT — templates de fluxo WhatsApp (Vercel KV)                |
| `whatsapp-leads.js`             | Processamento de leads WhatsApp                                  |
| `leads-clients.js`              | Gestão de leads/clientes                                         |
| `client-detail.js`              | GET/PUT — detalhe de Lead/Customer único                         |
| `crm-deals.js`                  | Operações CRM deals                                              |
| `crm-update-deal.js`            | Atualização de campos de deal                                    |
| `products.js`                   | Listagem/busca de produtos                                       |
| `product-detail.js`             | Detalhe de produto único                                         |
| `product-pricing.js`            | Dados de precificação                                            |
| `product-pricing-update.js`     | Atualização de preços                                            |
| `product-update.js`             | Atualização de campos do produto                                 |
| `product-activity.js`           | Atividade de produto                                             |
| `pricing-lookup.js`             | Consulta direta de preços                                        |
| `quotations.js`                 | CRUD de orçamentos (GET/PUT/DELETE)                              |
| `duplicate-quotation.js`        | Duplicação de orçamento                                          |
| `sales-orders.js`               | Operações de pedidos de venda                                    |
| `sales-order-from-quotation.js` | Cria Sales Order a partir de Quotation                           |
| `sales-dashboard.js`            | Dashboard de vendas                                              |
| `pdf.js`                        | Geração de PDF (Puppeteer + @sparticuz/chromium)                 |
| `login.js`                      | Login — sets `aspen_token` cookie (30 dias)                      |
| `logout.js`                     | Logout — limpa cookie                                            |

## Libs Compartilhadas

| Arquivo                      | Descrição                                                     |
| ---------------------------- | ------------------------------------------------------------- |
| `lib/erpnext.js`             | Cliente HTTP para API do ERPNext + `createHttpError`          |
| `lib/quotation-html.js`      | Montagem do HTML do orçamento                                 |
| `lib/quotation-pdf.js`       | Geração do PDF do orçamento (Puppeteer + @sparticuz/chromium) |
| `lib/print-format.js`        | Formato de impressão customizado                              |
| `lib/quote-response.js`      | Estrutura de resposta da cotação                              |
| `lib/quote-pipeline.js`      | Pipeline de criação de orçamento                              |
| `lib/deal-resolution.js`     | Resolução de CRM Deal                                         |
| `lib/customer-resolution.js` | Resolução de Customer/Contact                                 |
| `lib/client-metadata.js`     | Validação de CNPJ, lead source, endereço                      |

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
