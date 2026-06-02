# Plano: Enviar Orçamento em PDF via WhatsApp (Evolution API)

**Branch:** `feat/whatsapp-pdf-attachment`
**Data:** 02/06/2026
**Contexto:** Página `/auto`, card de resultado finalizado, botão "Enviar WhatsApp" que envia PDF real anexado (não apenas link).

---

## Objetivo

Fazer o botão "Enviar WhatsApp" no card de resultado (estado `done`) do `SplitResultCard` enviar o **PDF real do orçamento como anexo** via Evolution API, em vez de apenas um link de texto.

---

## Precondições observadas

| Fato | Evidência |
|---|---|
| `send-whatsapp.js` já envia mídia (imagens) via Evolution | `sendMedia()` linha 377-415, busca de ERPNext com auth, base64, `sendMedia` endpoint |
| `send-whatsapp.js` já suporta steps tipo `document` | `buildSequenceSteps()` linha 199-218, `sendStep()` linha 417-420 |
| Steps `document` com `source: quotation_pdf` são convertidos para texto (link) | Linha 201-208: "NEVER generate/attach PDF via WhatsApp" |
| `WhatsAppSendPanel` já existe no frontend com seletor de fluxo + botão | `src/components/WhatsAppSendPanel.jsx` |
| `whatsappFlows.js` converte `document` steps para `text` no frontend | `flowToSequencePayload()` linha 253-268 |
| Evolution API está configurada | `.env`: `EVOLUTION_BASE_URL`, `INSTANCE`, `API_KEY` |
| ERPNext PDF está disponível via `download_pdf` | API: `POST /api/method/frappe.utils.print_format.download_pdf` |
| Ambiente de produção é Vercel (sem Chrome) | `quotation-pdf.js` precisa de Chrome → falha no Vercel |
| Andrei autorizou ignorar a restrição do AGENTS.md sobre `download_pdf` | "Ignore o agents.md" |

---

## Abordagem

1. **Backend:** Alterar `send-whatsapp.js` para, quando um step `document` tiver `source: quotation_pdf`, buscar o PDF do ERPNext via `download_pdf` e enviar como anexo (não mais converter para link de texto).
2. **Frontend lib:** Remover a conversão de `document → text` no `flowToSequencePayload()`.
3. **Frontend componentes:** Adicionar `WhatsAppSendPanel` no `SplitResultCard` (estado `done`) + handler no `AutoQuotePage`.

---

## Plano passo a passo

### Passo 1: Alterar `send-whatsapp.js` — enviar PDF real

**Arquivo:** `api/_functions/send-whatsapp.js`

**O que mudar na função `buildSequenceSteps` (linhas 199-218):**

Remover a conversão de `document + quotation_pdf` → `text`. Em vez disso, passar o step `document` adiante para que `sendMedia` o processe. O step precisa ter:
- `type: 'document'`
- `media`: URL do PDF do ERPNext (via `download_pdf`)
- `fileName`: `{quotationId}.pdf`
- `mimetype: 'application/pdf'`
- `caption` opcional

**Nova função auxiliar:** `getQuotationPdfUrl(quotationId)` → constrói a URL do ERPNext `download_pdf`:
```
POST /api/method/frappe.utils.print_format.download_pdf
Body: { doctype: 'Quotation', name: quotationId, format: 'Standard', no_letterhead: 0 }
```

Mas `send-whatsapp.js` já baixa mídia do ERPNext em `sendMedia()` (linhas 380-401). Precisamos de um approach diferente: o PDF do `download_pdf` é retornado como resposta binária de um POST, não um GET simples. Então precisamos de uma nova helper `fetchQuotationPdf(quotationId)` que:
1. Faz POST para `ERPNEXT_BASE/api/method/frappe.utils.print_format.download_pdf`
2. Recebe o PDF binário
3. Retorna como base64

**Alternativa mais simples:** Construir a URL do printview como GET e o `sendMedia` existente busca com auth.
```
GET {ERPNEXT_BASE}/printview?doctype=Quotation&name={id}&format=Standard&no_letterhead=0
```
Isso retorna HTML, não PDF. Então não serve.

**Solução final:** Criar `fetchQuotationPdfBuffer(quotationId)` que faz POST para `download_pdf` e retorna `{ buffer, fileName }`. O step `document` no `buildSequenceSteps` terá `media` setado como `__pdf__:{quotationId}` (marcador especial), e `sendMedia` tratará esse prefixo chamando `fetchQuotationPdfBuffer`.

### Passo 2: `sendMedia` tratar marcador `__pdf__:`

**Arquivo:** `api/_functions/send-whatsapp.js`, função `sendMedia`

Adicionar tratamento: se `media` começa com `__pdf__:`, chamar `fetchQuotationPdfBuffer`, converter para base64, e prosseguir com `sendMedia` normal.

### Passo 3: Remover conversão `document → text` no frontend

**Arquivo:** `src/lib/whatsappFlows.js`, função `flowToSequencePayload`

Remover o bloco de código (linhas 253-268) que converte `document` steps com `source: quotation_pdf` em `text` steps. Deixar o step como `document` puro.

### Passo 4: Alterar `buildSequenceSteps` no backend

**Arquivo:** `api/_functions/send-whatsapp.js`, função `buildSequenceSteps`

Substituir o bloco de linhas 199-209 (conversão para texto) por: montar step `document` com `media: '__pdf__:{quotationId}'`, `fileName`, `mimetype`, `caption`.

### Passo 5: Adicionar `WhatsAppSendPanel` no `SplitResultCard`

**Arquivo:** `src/components/SplitResultCard.jsx`

No estado `isDone` (linha 382-398), após o botão "Abrir orçamento", adicionar o `WhatsAppSendPanel`:
- Props: `selectedFlowId`, `flows`, `status`, `onSelectFlow`, `onSend`
- Essas props precisam vir de `AutoQuotePage`

### Passo 6: Adicionar handler `handleSendWhatsApp` no `AutoQuotePage`

**Arquivo:** `src/pages/AutoQuotePage.jsx`

- Estado `waStatusByDraftIndex` ({ [draftIndex]: { state, message } })
- Handler que chama `POST /api/send-whatsapp` com:
  ```json
  {
    "quotation_id": "ORC-XXXX",
    "telefone": "11999999999",
    "nome": "João",
    "whatsapp_sequence": { ...flowToSequencePayload(selectedFlow) },
    "deal_id": "..."
  }
  ```

### Passo 7: Passar props pelo `SplitResultCard`

Adicionar novas props ao `SplitResultCard`: `waFlows`, `waSelectedFlowId`, `waStatus`, `onSelectWaFlow`, `onSendWhatsApp`.

---

## Arquivos alterados

| Arquivo | Tipo de mudança |
|---|---|
| `api/_functions/send-whatsapp.js` | Nova helper `fetchQuotationPdfBuffer`, alterar `buildSequenceSteps`, alterar `sendMedia` |
| `src/lib/whatsappFlows.js` | Remover conversão `document → text` no `flowToSequencePayload` |
| `src/components/SplitResultCard.jsx` | Adicionar `WhatsAppSendPanel` no estado `done` |
| `src/pages/AutoQuotePage.jsx` | Estado + handler WhatsApp, passar props |

---

## Riscos e trade-offs

| Risco | Mitigação |
|---|---|
| **Renderização wkhtmltopdf ≠ Chrome** | O `download_pdf` do ERPNext usa wkhtmltopdf. O layout pode diferir do `/api/view`. Andrei autorizou ignorar essa restrição do AGENTS.md. |
| **Timeout no Vercel (maxDuration)** | O download do PDF + upload para Evolution pode levar >10s. Vercel Pro permite 60s; verificar `maxDuration` no `vercel.json`. |
| **Tamanho do PDF** | PDFs de orçamento são pequenos (<1MB). WhatsApp suporta até 100MB. Sem risco. |
| **Falha silenciosa** | Se o ERPNext retornar erro no `download_pdf`, o `send-whatsapp.js` deve retornar erro claro (já tem tratamento). |
| **Fluxo existente de link quebrado** | Manter compatibilidade: o fluxo padrão "primeiro contato" tem step `text` com `(link_orcamento)`, não `document`. A mudança só afeta quem explicitamente usar `source: quotation_pdf` em step `document`. |

---

## Validação

1. `vercel dev` → testar localmente com dry_run
2. Criar orçamento real via `/auto` → clicar "Enviar WhatsApp" → verificar se PDF chega no WhatsApp
3. Testar com diferentes fluxos (o padrão "primeiro contato" deve continuar enviando link, não PDF)
4. Verificar logs do Vercel para erros de timeout

---

## Perguntas abertas

1. O `download_pdf` do ERPNext aceita `format` customizado? O projeto tem um print format customizado (`Aspen Standard`)? → Verificar antes de implementar.
2. O envio do PDF deve ser um step isolado ou combinado com mensagens de texto? O fluxo "primeiro contato" atual manda 5 mensagens de texto + fotos. Adicionar o PDF como step extra ou substituir o step do link?
