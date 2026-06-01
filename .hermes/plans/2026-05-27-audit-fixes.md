# Correções Pós-Auditoria — Aspen Orçamento v2.0.0

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Corrigir 6 bugs/riscos encontrados na auditoria de 2026-05-27 — sanitização de tokens, bugs de lógica no pricing/orcamento, performance do freight, e validações faltantes.

**Architecture:** Correções pontuais nos handlers existentes, sem mudança de arquitetura. Cada fix é autocontido (1-2 arquivos), testável isoladamente, e não quebra fluxos existentes.

**Tech Stack:** Node.js ESM, Vercel serverless, ERPNext REST API

---

### Task 1: Sanitizar `.env.example` — remover tokens reais

**Objective:** Remover o token real do ERPNext e a API key parcial do OpenRouter do arquivo `.env.example`.

**Files:**

- Modify: `.env.example`

**Step 1: Substituir valores por placeholders seguros**

```bash
# .env.example — valores atuais para referência
ERPNEXT_TOKEN=2e4b160b98549a7:89ba6b5e99f961a    # ← TOKEN REAL, REVOGAR
OPENROUTER_API_KEY=sk-or-...16f0                   # ← parcial mas identificável
```

Deve virar:

```
ERPNEXT_TOKEN=seu_token_erpnext_aqui
OPENROUTER_API_KEY=sk-or-v1-seu_key_aqui
```

**Step 2: Verificar que o arquivo não contém strings sensíveis**

```bash
grep -E '[a-f0-9]{20,}' .env.example
# Esperado: sem output (nenhum token real ou hash longo)
```

**Step 3: Commit**

```bash
git add .env.example
git commit -m "security: sanitiza .env.example — remove tokens reais e API keys parciais"
```

> ⚠️ **Ação manual necessária (Andrei):** Revogar o token `2e4b160b98549a7:89ba6b5e99f961a` no ERPNext (User → API Access → revoke) e gerar um novo. O token antigo está exposto no histórico do git — `git filter-branch` ou `BFG Repo-Cleaner` podem ser necessários para remover do histórico.

---

### Task 2: Corrigir `_rateManual` sempre `true` em `orcamento.js`

**Objective:** O campo `_rateManual` deve refletir se o preço do item foi definido manualmente pelo operador, não ser sempre `true`.

**Files:**

- Modify: `api/_functions/orcamento.js:132`

**Situação atual (linha 132):**

```js
items = items.map(({ manual_rate, ...item }) => ({ ...item, _rateManual: true }));
```

Isso força `_rateManual: true` para TODOS os itens, independente de terem `manual_rate: true` ou `false`.

**Step 1: Aplicar correção**

```js
// Correto: preserva o valor original de manual_rate
items = items.map(({ manual_rate, ...item }) => ({ ...item, _rateManual: manual_rate }));
```

**Step 2: Verificar que o campo `manual_rate` foi removido e `_rateManual` preserva o valor**

```bash
grep -n '_rateManual' api/_functions/orcamento.js
# Esperado: apenas a linha corrigida (132)
grep -n 'manual_rate' api/_functions/orcamento.js
# Esperado: apenas linhas 113 e 119 (onde é lido do input)
```

**Step 3: Rodar teste de regressão — cenários 4 e 6 do `test_local.mjs`**

```bash
node test_local.mjs
```

O cenário 4 (pricing override) verifica que `manual_rate: true` preserva o preço manual.
O cenário 6 (override reset) verifica que `manual_rate: false` permite repricing.

**Step 4: Commit**

```bash
git add api/_functions/orcamento.js
git commit -m "fix: _rateManual agora preserva valor de manual_rate em vez de forçar true"
```

---

### Task 3: `getRate()` — lançar erro quando preço não encontrado em vez de retornar 0

**Objective:** Prevenir orçamentos com itens de valor R$ 0,00 causados por SKU sem pricing configurado.

**Files:**

- Modify: `api/_functions/pricing.js:66`

**Situação atual (linha 66):**

```js
return prices[0]?.price_list_rate || 0;
```

**Step 1: Substituir retorno silencioso por erro explícito**

```js
// Antes:
return prices[0]?.price_list_rate || 0;

// Depois:
if (!prices[0]?.price_list_rate) {
  throw Object.assign(
    new Error(
      `Preço não encontrado para "${itemCode}" (qtd: ${qty}). Verifique Pricing Rule ou Item Price.`
    ),
    { statusCode: 400, code: 'PRICE_NOT_FOUND' }
  );
}
return prices[0].price_list_rate;
```

Mas `pricing.js` é uma shared lib que não conhece o pattern `createHttpError`. Precisamos de uma abordagem compatível. A lib é importada por `orcamento.js` que já tem tratamento de erro. Vamos lançar um erro com `statusCode`:

```js
if (prices[0]?.price_list_rate != null) return prices[0].price_list_rate;

const err = new Error(`Preço não encontrado para "${itemCode}" (qtd: ${qty}).`);
err.statusCode = 400;
throw err;
```

**Step 2: Verificar que `orcamento.js` captura esse erro corretamente**

O bloco catch em `orcamento.js:415-423` já lê `err?.statusCode` e formata a resposta. O erro será exibido como: `"Preço não encontrado para "XXX" (qtd: N)."` — mensagem em PT-BR, sem expor detalhes internos. ✓

**Step 3: Rodar `test_local.mjs` — cenários 1, 2, 5 usam `localGetRate`**

```bash
node test_local.mjs
```

**Step 4: Commit**

```bash
git add api/_functions/pricing.js
git commit -m "fix: getRate() lança erro 400 em vez de retornar 0 quando preço não encontrado"
```

---

### Task 4: Paralelizar consultas de frete em `freight.js`

**Objective:** Evitar timeout de 60s do Vercel transformando o loop sequencial de 10 carriers em chamadas paralelas.

**Files:**

- Modify: `api/_functions/freight.js:227-283`

**Situação atual (linhas 229-283):**

```js
for (const carrier of carriers) {
  try {
    const res = await fetch(...);  // sequencial — 10 × 3-5s = 30-50s
    ...
  } catch ...
}
```

**Step 1: Extrair a lógica de fetch por carrier em uma função separada**

Inserir antes do loop (após a linha 226 `// ── fim Braspress ──`):

```js
async function fetchCarrierRate(
  carrier,
  origin,
  destination,
  envPackages,
  additionalServices,
  insuranceRequested
) {
  try {
    const requestBody = {
      origin,
      destination,
      packages: envPackages,
      shipment: { type: 1, carrier },
      ...(additionalServices ? { additionalServices } : {}),
    };
    const res = await fetch(`${ENVIA_BASE}/ship/rate/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ENVIA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    if (!res.ok) {
      console.warn(`[freight] ${carrier}: ${res.status}`);
      return [];
    }
    const data = await res.json();
    if (data.meta === 'error') {
      console.warn(
        `[freight] ${carrier}: ${data.error?.message || data.error || 'sem serviço disponível'}`
      );
      return [];
    }
    if (!data.data || !Array.isArray(data.data)) return [];

    console.info('[freight] carrier_result', { carrier, rates: data.data.length });
    const results = [];
    for (const r of data.data) {
      const insuranceCharge = normalizePrice(r.insurance);
      if (insuranceRequested && insuranceCharge <= 0) {
        console.info('[freight] filtered_no_insurance', {
          carrier: r.carrier || carrier,
          service: r.service || '',
          totalPrice: normalizePrice(r.totalPrice),
        });
        continue;
      }
      results.push({
        carrier: r.carrier || carrier,
        service: r.service || '',
        serviceDescription: r.serviceDescription || r.service || carrier,
        deliveryEstimate: r.deliveryEstimate || '',
        deliveryDays: r.deliveryDate?.dateDifference ?? null,
        basePrice: normalizePrice(r.basePrice),
        insurance: insuranceCharge,
        additionalServices: r.additionalServices || [],
        additionalCharges: normalizePrice(r.additionalCharges),
        taxes: normalizePrice(r.taxes),
        totalPrice: normalizePrice(r.totalPrice),
        currency: r.currency || 'BRL',
        insuranceApplied: insuranceRequested && insuranceCharge > 0,
      });
    }
    return results;
  } catch (err) {
    console.error(`[freight] ${carrier} error:`, err.message);
    return [];
  }
}
```

**Step 2: Substituir o loop sequencial por `Promise.allSettled`**

```js
// Substituir linhas 227-283 (loop for sequencial) por:
const carrierResults = await Promise.allSettled(
  carriers.map((carrier) =>
    fetchCarrierRate(
      carrier,
      origin,
      destination,
      envPackages,
      additionalServices,
      insuranceRequested
    )
  )
);

const rates = [];
let filteredCount = 0;
for (const result of carrierResults) {
  if (result.status === 'fulfilled') {
    for (const r of result.value) {
      if (r.insuranceApplied === false && insuranceRequested) filteredCount++;
      rates.push(r);
    }
  }
}
```

⚠️ Nota: `filteredCount` perde a precisão por carrier nessa refatoração. Se for importante rastrear qual carrier foi filtrado, extrair essa info do rate. Para o propósito do response, `filteredCount` agregado é suficiente.

**Step 3: Rodar smoke test do freight (se houver ambiente configurado)**

```bash
# Teste manual com curl:
curl -X POST http://localhost:3000/api/freight \
  -H 'Content-Type: application/json' \
  -d '{"origin":{"cep":"01001000"},"destination":{"cep":"20040002"},"packages":[{"weight":1,"amount":1}]}'
```

**Step 4: Commit**

```bash
git add api/_functions/freight.js
git commit -m "perf: paraleliza consultas de frete com Promise.allSettled (evita timeout Vercel 60s)"
```

---

### Task 5: `duplicate-quotation.js` — copiar metadados do orçamento original

**Objective:** Preservar `remarks`, `utm_source`, `contact_email`, `contact_mobile`, `customer_address` ao duplicar um orçamento.

**Files:**

- Modify: `api/_functions/duplicate-quotation.js:43-53`

**Step 1: Adicionar campos ao payload de criação**

```js
// Substituir linhas 43-53 (criação do novo quotation):
const newQuotation = await erpPost('Quotation', {
  quotation_to: src.quotation_to || 'Lead',
  party_name: src.party_name,
  customer_name: src.customer_name,
  title: src.title || src.customer_name || 'Cópia',
  currency: src.currency || 'BRL',
  selling_price_list: src.selling_price_list || 'Standard Selling',
  transaction_date: new Date().toISOString().split('T')[0],
  remarks: src.remarks || '',
  ...(src.utm_source ? { utm_source: src.utm_source } : {}),
  ...(src.contact_email ? { contact_email: src.contact_email } : {}),
  ...(src.contact_mobile ? { contact_mobile: src.contact_mobile } : {}),
  ...(src.customer_address ? { customer_address: src.customer_address } : {}),
  items,
  ignore_pricing_rule: 1,
});
```

Nota: `ignore_pricing_rule: 1` foi adicionado para consistência com `orcamento.js` (linha 292).

**Step 2: Verificar que o código compila (sem erros de sintaxe)**

```bash
node --check api/_functions/duplicate-quotation.js
```

**Step 3: Commit**

```bash
git add api/_functions/duplicate-quotation.js
git commit -m "fix: duplicate-quotation preserva remarks, utm_source, contact_email/mobile, address e pricing_rule"
```

---

### Task 6: `edit-draft.js` — validar estrutura da resposta da IA

**Objective:** Evitar que JSON malformado da IA (campos com tipos errados) seja retornado ao frontend.

**Files:**

- Modify: `api/_functions/edit-draft.js:96-107` (após parse do JSON)

**Step 1: Adicionar função de validação**

Inserir após a função `extractAssistantText` (linha 46):

```js
function validateDraft(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    throw createHttpError(502, 'Resposta inválida do provedor de IA.', 'Draft não é um objeto');
  }
  if (draft.nome !== undefined && typeof draft.nome !== 'string') {
    throw createHttpError(
      502,
      'Resposta inválida do provedor de IA.',
      'Campo "nome" deve ser string'
    );
  }
  if (draft.email !== undefined && draft.email !== null && typeof draft.email !== 'string') {
    throw createHttpError(
      502,
      'Resposta inválida do provedor de IA.',
      'Campo "email" deve ser string ou null'
    );
  }
  if (
    draft.telefone !== undefined &&
    draft.telefone !== null &&
    typeof draft.telefone !== 'string'
  ) {
    throw createHttpError(
      502,
      'Resposta inválida do provedor de IA.',
      'Campo "telefone" deve ser string ou null'
    );
  }
  if (draft.urgente !== undefined && typeof draft.urgente !== 'boolean') {
    throw createHttpError(
      502,
      'Resposta inválida do provedor de IA.',
      'Campo "urgente" deve ser boolean'
    );
  }
  if (draft.items !== undefined) {
    if (!Array.isArray(draft.items)) {
      throw createHttpError(
        502,
        'Resposta inválida do provedor de IA.',
        'Campo "items" deve ser array'
      );
    }
    for (let i = 0; i < draft.items.length; i++) {
      const item = draft.items[i];
      if (!item || typeof item !== 'object') {
        throw createHttpError(
          502,
          'Resposta inválida do provedor de IA.',
          `items[${i}] deve ser objeto`
        );
      }
      if (typeof item.item_code !== 'string' || !item.item_code) {
        throw createHttpError(
          502,
          'Resposta inválida do provedor de IA.',
          `items[${i}].item_code inválido`
        );
      }
      if (typeof item.qty !== 'number' || item.qty <= 0) {
        throw createHttpError(
          502,
          'Resposta inválida do provedor de IA.',
          `items[${i}].qty inválido`
        );
      }
    }
  }
}
```

**Step 2: Chamar validação antes de retornar o parsed**

Substituir linhas 101-106:

```js
// Antes:
const parsed = parseJsonSafely(unwrapJsonText(raw));
if (parsed == null) {
  throw createHttpError(
    502,
    'Resposta inválida do provedor de IA.',
    'JSON inválido retornado pela IA'
  );
}

return parsed;

// Depois:
const parsed = parseJsonSafely(unwrapJsonText(raw));
if (parsed == null) {
  throw createHttpError(
    502,
    'Resposta inválida do provedor de IA.',
    'JSON inválido retornado pela IA'
  );
}

validateDraft(parsed);
return parsed;
```

**Step 3: Verificar sintaxe**

```bash
node --check api/_functions/edit-draft.js
```

**Step 4: Commit**

```bash
git add api/_functions/edit-draft.js
git commit -m "fix: edit-draft valida estrutura do JSON retornado pela IA antes de responder"
```

---

## Verificação Final

Após todos os 6 commits, rodar a suíte completa:

```bash
node test_local.mjs
```

Todos os 7 cenários devem passar (PASS, 0 failures).

---

## Resumo dos Commits

| #   | Tipo       | Arquivo                  | Descrição                                          |
| --- | ---------- | ------------------------ | -------------------------------------------------- |
| 1   | `security` | `.env.example`           | Remove tokens reais e API keys parciais            |
| 2   | `fix`      | `orcamento.js`           | `_rateManual` preserva valor real de `manual_rate` |
| 3   | `fix`      | `pricing.js`             | `getRate()` lança erro quando preço não encontrado |
| 4   | `perf`     | `freight.js`             | Paraleliza 10 carriers com `Promise.allSettled`    |
| 5   | `fix`      | `duplicate-quotation.js` | Copia metadados ao duplicar orçamento              |
| 6   | `fix`      | `edit-draft.js`          | Valida estrutura do JSON antes de responder        |
