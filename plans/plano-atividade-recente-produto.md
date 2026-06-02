# Atividade Recente do Produto — Plano de Implementação

> **Para Hermes:** Use o skill `development-branch-workflow` para executar este plano tarefa por tarefa.

**Objetivo:** Adicionar na página de detalhe do produto um feed de "Atividade recente" mostrando os últimos orçamentos, alterações de preço e atualizações do produto.

**Arquitetura:** Backend consulta 3 fontes no ERPNext (Quotation Item, Version de Pricing Rule, Version de Item) via REST API e consolida em um endpoint `/api/product-activity`. Frontend consome o endpoint e renderiza no `ProductDetailPage.jsx`.

**Tech Stack:** JavaScript (ESM), React 19, Tailwind, ERPNext REST API via `erpnext.js`

---

## Dados de entrada e saída

### GET /api/product-activity?sku=LNC-SED-70&limit=10

```json
{
  "sku": "LNC-SED-70",
  "atividades": [
    { "tipo": "orcamento", "texto": "Orçamento ORC-20260528 criado com 500 un.", "data": "2026-05-28", "id": "ORC-20260528" },
    { "tipo": "preco", "texto": "Preço da faixa 500 alterado de R$ 35,00 → R$ 34,12", "data": "2026-05-20", "id": "LNC-SED-70-500" },
    { "tipo": "produto", "texto": "Descrição do produto atualizada", "data": "2026-05-15", "id": "LNC-SED-70" }
  ]
}
```

### Fontes no ERPNext

| Tipo | Doctype | Filtro |
|------|---------|--------|
| Orçamentos | Quotation Item + Quotation | `item_code = SKU`, join via `parent` |
| Alterações de preço | Version | `ref_doctype = "Pricing Rule"`, `docname` contém SKU |
| Atualizações do produto | Version | `ref_doctype = "Item"`, `docname = SKU` |
| Modificação geral | Item | `modified` field (já retornado por `product-detail.js`) |

---

## Tarefas

### Tarefa 1: Criar o handler `product-activity.js`

**Objetivo:** Criar o backend que consulta ERPNext e retorna atividades consolidadas.

**Arquivos:**
- Criar: `api/_functions/product-activity.js`

**Passo 1: Criar o arquivo com o handler skeleton**

```js
// ── Imports ─────────────────────────────────────────────────────────────────
import { erpGetList, createHttpError } from './lib/erpnext.js';

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const params = event.queryStringParameters || {};
  const sku = (params.sku || '').trim();

  if (!sku) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'SKU é obrigatório.' }),
    };
  }

  const limit = Math.min(20, Math.max(1, parseInt(params.limit, 10) || 10));

  try {
    const atividades = [];

    // ── 1. Orçamentos recentes que contêm este SKU ──
    const quoteItems = await erpGetList('Quotation Item', {
      fields: ['parent', 'qty', 'modified'],
      filters: [['item_code', '=', sku]],
      order_by: 'modified desc',
      limit,
    });

    for (const qi of quoteItems) {
      atividades.push({
        tipo: 'orcamento',
        texto: `Orçamento ${qi.parent} criado com ${qi.qty || '?'} un.`,
        data: (qi.modified || '').split(' ')[0],
        id: qi.parent,
        ts: qi.modified || '',
      });
    }

    // ── 2. Alterações de preço via Version ──
    const priceVersions = await erpGetList('Version', {
      fields: ['docname', 'data', 'modified'],
      filters: [
        ['ref_doctype', '=', 'Pricing Rule'],
        ['docname', 'like', `${sku}-%`],
      ],
      order_by: 'modified desc',
      limit,
    });

    // ── 3. Atualizações do produto via Version ──
    const itemVersions = await erpGetList('Version', {
      fields: ['docname', 'data', 'modified'],
      filters: [
        ['ref_doctype', '=', 'Item'],
        ['docname', '=', sku],
      ],
      order_by: 'modified desc',
      limit: 5,
    });

    // Processar price versions
    for (const v of priceVersions) {
      let texto = `Preço da regra ${v.docname} alterado`;
      try {
        const parsed = typeof v.data === 'string' ? JSON.parse(v.data) : v.data;
        const changed = parsed?.changed;
        if (Array.isArray(changed)) {
          for (const c of changed) {
            if (c[0] === 'rate' || c[0] === 'title') {
              texto = `Preço alterado em ${v.docname}: R$ ${c[1] || '?'} → R$ ${c[2] || '?'}`;
            }
          }
        }
      } catch { /* mantém texto default */ }
      atividades.push({
        tipo: 'preco',
        texto,
        data: (v.modified || '').split(' ')[0],
        id: v.docname,
        ts: v.modified || '',
      });
    }

    // Processar item versions
    for (const v of itemVersions) {
      let texto = 'Produto atualizado';
      try {
        const parsed = typeof v.data === 'string' ? JSON.parse(v.data) : v.data;
        const changed = parsed?.changed;
        if (Array.isArray(changed)) {
          const fieldNames = changed.map(c => c[0]).filter(Boolean);
          texto = `Produto atualizado: ${fieldNames.join(', ')}`;
        }
      } catch { /* mantém texto default */ }
      atividades.push({
        tipo: 'produto',
        texto,
        data: (v.modified || '').split(' ')[0],
        id: v.docname,
        ts: v.modified || '',
      });
    }

    // Ordenar por data decrescente, limitar, remover ts
    atividades.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
    const result = atividades.slice(0, limit).map(({ ts, ...rest }) => rest);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, atividades: result }),
    };
  } catch (err) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[product-activity]', err?.logMessage || err?.message || err);
    return {
      statusCode: code,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Erro ao buscar atividades do produto.' }),
    };
  }
}
```

**Passo 2: Verificar sintaxe**
```bash
node -c api/_functions/product-activity.js
```

---

### Tarefa 2: Registrar o handler nos routers

**Objetivo:** Adicionar `product-activity` aos 3 roteadores.

**Arquivos:**
- Modificar: `api/[...path].js`
- Modificar: `scripts/app-server.mjs`
- Modificar: `scripts/dev-api-server.mjs`

**Passo 1: `api/[...path].js`**
Adicionar import:
```js
import { handler as productActivity } from './_functions/product-activity.js';
```
Adicionar rota:
```js
'product-activity': productActivity,
```

**Passo 2: `scripts/app-server.mjs`**
Adicionar import:
```js
import { handler as productActivity } from '../api/_functions/product-activity.js';
```
Adicionar rota e atualizar contador (20 → 21 handlers).

**Passo 3: `scripts/dev-api-server.mjs`**
Adicionar import e rota (mesmo padrão).

**Passo 4: Verificar**
```bash
kill $(ps aux | grep "[s]cripts/app-server.mjs" | awk '{print $2}') 2>/dev/null; sleep 1
PORT=8888 node scripts/app-server.mjs &
sleep 2
curl -s 'http://127.0.0.1:8888/api/product-activity?sku=LNC-SED-70&limit=5' | python3 -m json.tool
```

---

### Tarefa 3: Adicionar o componente de atividade ao `ProductDetailPage.jsx`

**Objetivo:** Consumir `/api/product-activity` e exibir no rodapé da página.

**Arquivos:**
- Modificar: `src/pages/ProductDetailPage.jsx`

**Passo 1: Adicionar state e fetch**

No início do componente, após os outros `useState`:
```jsx
const [atividades, setAtividades] = useState([]);
```

Adicionar o fetch após o `fetchProduct`:
```jsx
const fetchAtividades = useCallback(async () => {
  try {
    const result = await apiGet(`/product-activity?sku=${encodeURIComponent(decodedSku)}&limit=10`);
    setAtividades(result.atividades || []);
  } catch { /* silencioso — atividade é secundário */ }
}, [decodedSku]);

useEffect(() => { fetchAtividades(); }, [fetchAtividades]);
```

**Passo 2: Renderizar a seção**

Logo acima do `{produto.modificado_em && ...}`, adicionar:
```jsx
{atividades.length > 0 && (
  <div className="bg-card rounded-lg border border-border shadow-sm p-5 space-y-3">
    <h2 className="text-lg font-semibold">Atividade recente</h2>
    <div className="space-y-2 text-sm">
      {atividades.map((a, i) => (
        <div key={i} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
          <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
            a.tipo === 'orcamento' ? 'bg-accent/10 text-accent' :
            a.tipo === 'preco' ? 'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400' :
            'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400'
          }`}>
            {a.tipo === 'orcamento' ? 'O' : a.tipo === 'preco' ? '$' : 'E'}
          </span>
          <span className="flex-1 text-muted-foreground">{a.texto}</span>
          <span className="text-xs text-muted-foreground">{a.data}</span>
        </div>
      ))}
    </div>
  </div>
)}
```

**Passo 3: Build e reiniciar servidor**
```bash
cd /opt/data/aspen-orcamento && npm run build
kill $(ps aux | grep "[s]cripts/app-server.mjs" | awk '{print $2}') 2>/dev/null; sleep 1
PORT=8888 node scripts/app-server.mjs &
sleep 2
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8888/
# Esperado: 200
```

---

### Tarefa 4: Testar o fluxo completo

**Passo 1: Testar API isolada**
```bash
curl -s 'http://127.0.0.1:8888/api/product-activity?sku=LNC-SED-70&limit=10' | python3 -m json.tool
# Esperado: JSON com array "atividades" contendo orçamentos, preços, e/ou updates
```

**Passo 2: Testar sem SKU (validação)**
```bash
curl -s 'http://127.0.0.1:8888/api/product-activity' | python3 -m json.tool
# Esperado: { "error": "SKU é obrigatório." }
```

**Passo 3: Verificar frontend**
Abrir `http://127.0.0.1:8888/#/products/LNC-SED-70` e confirmar que a seção "Atividade recente" aparece com itens.

---

### Tarefa 5: Commit e push
```bash
git add -A
git commit -m "feat: atividade recente do produto (orçamentos, preços, updates via ERPNext Version)"
git push
```

---

## Notas

- **Version doctype** é nativo do Frappe — sempre que um documento é salvo, uma entrada Version é criada automaticamente. Nenhuma customização do ERPNext é necessária.
- **Fallback silencioso**: se o endpoint falhar, o frontend simplesmente não mostra a seção. A página de produto funciona normalmente sem atividade.
- **Performance**: as 3 queries ao ERPNext são sequenciais (simplicidade). Com `limit=10`, cada query retorna no máximo 10 registros. Se ficar lento, podemos paralelizar com `Promise.all`.
- **SKU não encontrado**: se o SKU não existir, a query de Quotation Item retorna `[]`, as de Version também — o endpoint retorna `{ "atividades": [] }` em vez de 404.
