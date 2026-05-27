# Plano de Estabilização — Aspen Orçamento v2.0.0

> **Base:** Diagnóstico de 2026-05-27 (14 áreas de melhoria, veredito: estabilizar o legado, não reescrever)
>
> **For Hermes:** Este é um plano multi-fase. Cada fase é autocontida e pode ser executada independentemente. Use `subagent-driven-development` dentro de cada fase para implementar as tasks.

**Objetivo:** Transformar o `aspen-orcamento` em um sistema operacional confiável com auth, validação, testes, lint, e modularização — sem rewrite.

**Princípio:** Manter o motor operacional intacto. Toda mudança é incremental: testar antes, depois, e commitar com mensagens `type(scope): descrição`.

**Stack:** Node.js ESM, Vite 6, React 19, Tailwind 3, Vercel serverless, ERPNext REST API

---

## Pré-requisito: Plano de Correções de Bugs (já documentado)

O plano `2026-05-27-audit-fixes.md` cobre 6 bugs/riscos encontrados na auditoria de código (tokens expostos, `_rateManual` sempre `true`, `getRate()` retornando 0, loop sequencial de frete, metadados perdidos na duplicação, e resposta da IA sem validação). Executar esse plano **antes** ou **em paralelo** com a Fase 1 abaixo.

---

## Fase 1 — Segurança Mínima (🔴 prioridade máxima)

> Sem auth, qualquer endpoint está exposto. Esta fase é pré-requisito para considerar o sistema "deployável com segurança".

### Task 1.1: Middleware de autenticação no catch-all API

**Objetivo:** Proteger todas as rotas `/api/*` com verificação de senha. Rotas explicitamente públicas (`view`, `extract`) podem ser liberadas se necessário.

**Files:**
- Modify: `api/[...path].js`
- Create: `api/_lib/auth.js`

**Passo 1: Criar `api/_lib/auth.js` — middleware de auth**

```js
// ── Auth middleware ──────────────────────────────────────────────────────────

const APP_PASSWORD = process.env.APP_PASSWORD;

// Rotas que NÃO exigem autenticação (ex: view é usada por links de orçamento)
const PUBLIC_ROUTES = new Set(['view']);

/**
 * Retorna true se a requisição está autenticada.
 * Estratégia: cookie httpOnly `aspen_auth` ou header `x-aspen-key`.
 */
export function isAuthenticated(req) {
  // Se APP_PASSWORD não está configurado, permitir tudo (dev mode)
  if (!APP_PASSWORD) return true;

  const routeName = getRouteName(req);
  if (PUBLIC_ROUTES.has(routeName)) return true;

  // 1. Cookie httpOnly
  const cookies = parseCookies(req.headers?.cookie || '');
  if (cookies.aspen_auth === APP_PASSWORD) return true;

  // 2. Header direto (fallback para scripts/integrações)
  if (req.headers?.['x-aspen-key'] === APP_PASSWORD) return true;

  return false;
}

function parseCookies(cookieHeader) {
  const map = {};
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key) map[key] = rest.join('=');
  }
  return map;
}
```

**Passo 2: Adicionar guard no router `api/[...path].js`**

```js
// Antes da linha 62 (após getRouteName):
const routeName = getRouteName(req);
if (!isAuthenticated(req)) {
  // Para browser: redirecionar para login
  if (req.headers?.accept?.includes('text/html')) {
    return res.status(401).json({ error: 'Não autorizado.', login: true });
  }
  return res.status(401).json({ error: 'Não autorizado.' });
}
```

> ⚠️ A função `getRouteName` está definida no escopo do módulo, não exportada. O `auth.js` precisaria recebê-la como parâmetro ou re-implementar a lógica. Alternativa: fazer o check inline no router.

**Passo 3: Criar endpoint de login `POST /api/login`**

Criar handler `api/_functions/login.js`:

```js
export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let payload;
  try { payload = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const { password } = payload;
  if (!password || password !== process.env.APP_PASSWORD) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Senha incorreta.' })
    };
  }

  // Setar cookie httpOnly (30 dias)
  const cookie = `aspen_auth=${password}; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000; Path=/`;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie,
    },
    body: JSON.stringify({ success: true })
  };
}
```

**Passo 4: Criar endpoint de logout `POST /api/logout`**

```js
// handler em api/_functions/logout.js
return {
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json',
    'Set-Cookie': 'aspen_auth=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/',
  },
  body: JSON.stringify({ success: true })
};
```

**Passo 5: Registrar `login` e `logout` no router**

Em `api/[...path].js`, adicionar as imports e entries no `ROUTES`:

```js
import { handler as login } from './_functions/login.js';
import { handler as logout } from './_functions/logout.js';

const ROUTES = {
  // ... existing ...
  login,
  logout,
};
```

**Passo 6: Verificar build**

```bash
node --check api/[...path].js
node --check api/_lib/auth.js
node --check api/_functions/login.js
node --check api/_functions/logout.js
npm run build
```

**Passo 7: Commit**

```bash
git add api/[...path].js api/_lib/auth.js api/_functions/login.js api/_functions/logout.js
git commit -m "feat(auth): middleware de autenticação no catch-all API + login/logout com cookie httpOnly"
```

---

### Task 1.2: Tela de login no frontend

**Objetivo:** Quando a API retorna 401, redirecionar para uma tela de login.

**Files:**
- Create: `src/pages/LoginPage.jsx`
- Modify: `src/App.jsx`
- Modify: `src/lib/api.js`

**Passo 1: Criar `LoginPage.jsx`**

Uma página simples com input de senha, botão "Entrar", mensagem de erro. Ao submeter, chama `POST /api/login` e redireciona para `#/quotations`.

**Passo 2: Modificar `api.js` — interceptar 401**

```js
// Em src/lib/api.js, após cada fetch:
if (res.status === 401) {
  window.location.hash = '#/login';
  throw new Error('Sessão expirada.');
}
```

**Passo 3: Registrar rota no `App.jsx`**

```jsx
import LoginPage from './pages/LoginPage.jsx';
// ...
{hash === '#/login' && <LoginPage />}
```

**Passo 4: Build + E2E**

```bash
npm run build
npm run test:e2e
```

**Passo 5: Commit**

```bash
git add src/pages/LoginPage.jsx src/App.jsx src/lib/api.js
git commit -m "feat(auth): tela de login que redireciona em 401"
```

---

### Task 1.3: Rate limiting simples para endpoints sensíveis

**Objetivo:** Proteger `/api/extract`, `/api/orcamento`, `/api/send-whatsapp`, e `/api/login` contra abuso.

**Files:**
- Create: `api/_lib/rate-limit.js`
- Modify: `api/[...path].js`

**Passo 1: Criar rate limiter in-memory**

```js
// api/_lib/rate-limit.js
// Rate limiter simples in-memory (Vercel serverless — reseta entre cold starts,
// mas suficiente contra abuso básico)

const WINDOW_MS = 60_000; // 1 minuto
const limits = new Map(); // IP → { count, resetAt }

const ROUTE_LIMITS = {
  'extract': 10,      // 10 req/min
  'orcamento': 20,    // 20 req/min
  'send-whatsapp': 5, // 5 req/min
  'login': 10,        // 10 req/min
};

export function checkRateLimit(req) {
  const routeName = getRouteNameFromReq(req);
  const max = ROUTE_LIMITS[routeName];
  if (!max) return true; // sem limite

  const ip = req.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers?.['x-real-ip']
    || 'unknown';

  const key = `${ip}:${routeName}`;
  const now = Date.now();
  const entry = limits.get(key);

  if (!entry || now > entry.resetAt) {
    limits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  entry.count++;
  if (entry.count > max) return false;
  return true;
}
```

**Passo 2: Adicionar check no router**

```js
if (!checkRateLimit(req)) {
  return res.status(429).json({ error: 'Muitas requisições. Aguarde um minuto.' });
}
```

**Passo 3: Commit**

```bash
git add api/_lib/rate-limit.js api/[...path].js
git commit -m "feat(security): rate limiting in-memory para extract, orcamento, send-whatsapp e login"
```

---

### Task 1.4: Configurar `APP_PASSWORD` no Vercel

**Objetivo:** Garantir que a variável `APP_PASSWORD` está configurada em produção.

**Passo 1:** Verificar no dashboard do Vercel → Project Settings → Environment Variables.

**Passo 2:** Se vazia, definir uma senha forte (mínimo 16 caracteres).

**Passo 3:** Confirmar que `vercel dev` funciona com `APP_PASSWORD` definida no `.env` local.

```bash
vercel dev
# Testar: curl -X POST http://localhost:3000/api/quotations → 401
# Login: curl -X POST http://localhost:3000/api/login -d '{"password":"..."}' → 200 + cookie
```

---

## Fase 2 — Qualidade de Stack (🟠 prioridade alta)

> Sem lint/format/check, bugs de sintaxe e estilo entram sem barreira. Esta fase adiciona as ferramentas mínimas.

### Task 2.1: Adicionar ESLint + Prettier

**Objetivo:** Configurar lint e formatação automática no projeto.

**Files:**
- Create: `eslint.config.js`
- Create: `.prettierrc`
- Create: `.prettierignore`
- Modify: `package.json`

**Passo 1: Instalar dependências**

```bash
npm install --save-dev eslint @eslint/js prettier eslint-config-prettier
```

**Passo 2: Criar `eslint.config.js`**

```js
import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  prettierConfig,
  {
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
    },
  },
];
```

**Passo 3: Criar `.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "es5",
  "printWidth": 100,
  "tabWidth": 2
}
```

**Passo 4: Criar `.prettierignore`**

```
node_modules/
public/assets/
dist/
```

**Passo 5: Adicionar scripts ao `package.json`**

```json
{
  "scripts": {
    "lint": "eslint .",
    "lint:fix": "eslint --fix .",
    "format": "prettier --write '**/*.{js,jsx,json,css,md}'",
    "format:check": "prettier --check '**/*.{js,jsx,json,css,md}'",
    "check": "npm run lint && npm run build && npm run test:e2e"
  }
}
```

**Passo 6: Rodar formatação inicial e verificar lint**

```bash
npm run format
npm run lint
# Corrigir warnings manualmente, se houver
```

**Passo 7: Commit**

```bash
git add eslint.config.js .prettierrc .prettierignore package.json package-lock.json
git commit -m "chore(stack): adiciona ESLint + Prettier com scripts lint, format e check"
```

---

### Task 2.2: Separar teste destrutivo de teste seguro

**Objetivo:** `npm test` não deve criar dados reais no ERPNext sem flag explícita.

**Files:**
- Modify: `package.json`

**Passo 1: Separar scripts de teste**

```json
{
  "scripts": {
    "test": "npm run test:unit && npm run test:e2e",
    "test:unit": "echo '⚠️  unit tests pendentes — ver Fase 3' && exit 0",
    "test:e2e": "npx playwright test",
    "test:e2e:ui": "npx playwright test --ui",
    "test:e2e:report": "npx playwright show-report",
    "test:erp": "node test_local.mjs",
    "test:whatsapp": "node scripts/test-whatsapp-sequence.mjs",
    "test:whatsapp-flows": "node scripts/test-whatsapp-flows.mjs"
  }
}
```

> O antigo `npm test` vira `npm run test:erp`. O novo `npm test` roda apenas testes seguros (unit + e2e com mocks).

**Passo 2: Commit**

```bash
git add package.json
git commit -m "chore(test): separa test:erp (destrutivo) de test:e2e (seguro); npm test é seguro"
```

---

### Task 2.3: Corrigir warning Vite `publicDir/outDir`

**Objetivo:** Separar assets estáticos da saída de build para eliminar o warning.

**Files:**
- Modify: `vite.config.js`
- Create: `public-static/` (ou renomear para `static/`)

**Passo 1: Mover assets estáticos**

```bash
mkdir -p static
# Mover logos e arquivos que NÃO são output do build
# (verificar quais arquivos em public/ são assets vs build output)
```

**Passo 2: Ajustar `vite.config.js`**

```js
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  publicDir: 'static',          // assets estáticos vêm daqui
  build: {
    outDir: 'public',            // build output vai pra cá
    emptyOutDir: false,
  },
  server: { port: 5173 },
});
```

**Passo 3: Verificar build**

```bash
npm run build
# Esperado: sem warning "public directory feature may not work correctly"
```

**Passo 4: Commit**

```bash
git add vite.config.js static/
git commit -m "fix(build): separa publicDir (static/) de outDir (public/) — elimina warning Vite"
```

---

## Fase 3 — Testes Operacionais (🟠 prioridade alta)

> Sem testes no motor operacional, qualquer refactor é arriscado. Esta fase cobre pricing, extraction, e client metadata com testes unitários.

### Task 3.1: Testes unitários — `pricing.js`

**Objetivo:** Cobrir todas as faixas de pricing (30, 100, 300, 500, 1000), urgência (+30%), fallback, e SKU inexistente.

**Files:**
- Create: `tests/unit/pricing.test.js`

**Step 1: Criar arquivo de teste com mock do ERPNext**

```js
// tests/unit/pricing.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Mock do fetch para simular respostas do ERPNext
// (pricing.js recebe ERPNEXT_BASE e ERPNEXT_TOKEN como parâmetros —
//  mockamos o fetch global para interceptar as chamadas)

// ... 12-15 casos de teste cobrindo:
// - bracket 30, 100, 300, 500, 1000 com valores conhecidos
// - urgência (rate * 1.3)
// - fallback para Item Price quando Pricing Rule não existe
// - SKU inexistente → erro
// - todos os SKUs reais da DEFAULT_RULES
```

**Step 2: Rodar testes**

```bash
node --test tests/unit/pricing.test.js
```

**Step 3: Commit**

```bash
git add tests/unit/pricing.test.js
git commit -m "test(unit): pricing.js — brackets, urgência, fallback, SKU inexistente"
```

---

### Task 3.2: Testes unitários — regras de extração

**Objetivo:** Garantir que as regras do `extract.js` produzem os SKUs esperados para cada tipo de produto.

**Files:**
- Create: `tests/unit/extract-rules.test.js`

**Casos de teste:**
- Lenços → LNC-SED-70 + LNC-CSD-70
- Lenços com "laser" → LNC-SED-LAS-70
- Echarpes → ECH-SED + ECH-CSD
- Chapéus → CHP-PAN + CHP-PNR + CHP-BAM
- Cangas < 100 → CNG-SAL-70 + CNG-SAL-100
- Cangas ≥ 100 → + CNG-VIS-70 + CNG-VIS-100
- Bonés < 100 → BNE-TAC-VNL
- Bonés ≥ 100 → BNE-TAC-SUB + BNE-BRI + BNE-PRE
- Cachecóis → CHC-SOF-140 + CHC-LAA-COU
- Ecobags → ECO-30 + ECO-35 + ECO-50
- Toalhas de Praia → TWL-210 + TWL-280
- Toalhas de Banho → TBH-LEM + TBH-URC + TBH-IPA
- SKU explícito (não expande)
- Múltiplas quantidades (várias linhas)
- Urgente = true quando prazo < 15 dias

> Nota: Estes testes validam o system prompt e a lógica de parsing, não chamam a API da IA. Podem ser testados com mocks da resposta do OpenRouter.

**Step: Commit**

```bash
git add tests/unit/extract-rules.test.js
git commit -m "test(unit): extract-rules — validação dos SKUs por tipo de produto (14 cenários)"
```

---

### Task 3.3: Testes unitários — `client-metadata.js`

**Objetivo:** Validar `normalizeLeadSource`, `isValidLeadSource`, `normalizeCnpj`, `isValidCnpj`, `normalizeAddressPayload`, `hasMinimumAddressForErp`, `buildAddressPayload`.

**Files:**
- Create: `tests/unit/client-metadata.test.js`

**Casos de teste:**
- Origem válida/inválida
- CNPJ com e sem pontuação
- Endereço com campos mínimos
- Endereço sem campos obrigatórios → `hasMinimumAddressForErp` retorna false
- `buildAddressPayload` monta payload correto

**Step: Commit**

```bash
git add tests/unit/client-metadata.test.js
git commit -m "test(unit): client-metadata — origem, CNPJ, endereço mínimo"
```

---

### Task 3.4: Testes unitários — `whatsappFlows.js`

**Objetivo:** Validar renderização de template e sequências de WhatsApp.

**Files:**
- Create: `tests/unit/whatsapp-flows.test.js`

**Casos de teste:**
- Template com `(Saudacao)` → "Bom dia" / "Boa tarde" / "Boa noite" por hora
- Template com `(nome)` → substituição
- Template com `(primeiro_nome)` → primeiro nome
- Template com `(numero_pedido)` → substituição
- Template com `(link_orcamento)` → URL formatada
- Sequência de etapas (timing)

**Step: Commit**

```bash
git add tests/unit/whatsapp-flows.test.js
git commit -m "test(unit): whatsapp-flows — render template, sequência"
```

---

### Task 3.5: Atualizar `package.json` com script `test:unit`

```json
{
  "scripts": {
    "test": "npm run test:unit && npm run test:e2e",
    "test:unit": "node --test tests/unit/*.test.js"
  }
}
```

```bash
git add package.json
git commit -m "chore(test): npm test agora roda unit + e2e; test:unit cobre pricing, extract, metadata, whatsapp"
```

---

## Fase 4 — Refatoração Sem Mudar Comportamento (🟡 prioridade média)

> Extrair componentes e serviços sem alterar lógica de negócio. Cada refactor deve passar nos testes da Fase 3.

### Task 4.1: Extrair serviços do `orcamento.js`

**Objetivo:** Quebrar o handler monolítico em serviços focados.

**Files a criar em `api/_functions/lib/`:**
- `quote-pipeline.js` — orquestrador: validate → resolve → price → create → respond
- `customer-resolution.js` — achar/criar Customer + Contact + Address
- `deal-resolution.js` — upsert CRM Deal
- `quote-response.js` — montar resposta (print URL, HTML, PDF)

**Files a modificar:**
- `api/_functions/orcamento.js` → delegar para os serviços

**Fluxo alvo:**

```js
// orcamento.js handler (reduzido para ~80 linhas)
export async function handler(event) {
  // parse + basic validation
  const payload = validateQuotePayload(JSON.parse(event.body));

  // resolve customer/contact/address
  const party = await resolveParty(payload.client);

  // price items
  const pricedItems = await resolveQuoteItems(payload.items);

  // create quotation
  const quotation = await createQuotation(party, pricedItems, payload);

  // upsert deal
  const deal = await upsertDeal(party, quotation);

  // build response
  return buildQuoteResponse(quotation, deal, party);
}
```

**Tasks individuais:**
- 4.1a: Extrair `customer-resolution.js` (Customer → Contact → Address)
- 4.1b: Extrair `deal-resolution.js` (CRM Deal upsert)
- 4.1c: Extrair `quote-response.js` (print URL, HTML, PDF)
- 4.1d: Criar `quote-pipeline.js` (orquestrador)
- 4.1e: Simplificar `orcamento.js` para delegar ao pipeline

**Verificação após cada task:** `node test_local.mjs` (todos os 7 cenários devem passar).

---

### Task 4.2: Quebrar `AutoQuotePage.jsx` (1346 linhas)

**Objetivo:** Extrair componentes sem mudar comportamento.

**Componentes a extrair:**
- `ExtractionInputPanel` — área de input (texto + imagem)
- `DraftReviewCard` — card de review de rascunho
- `DraftItemTable` — tabela de itens do rascunho
- `CustomerMetadataForm` — formulário de metadados do cliente
- `WhatsAppSendPanel` — painel de envio WhatsApp

**Hooks a extrair:**
- `useExtractionDrafts` — lógica de rascunhos
- `useImageInput` — paste/drop de imagem
- `useDraftPricing` — precificação de rascunhos

**Verificação após cada extração:** `npm run build && npm run test:e2e`.

---

### Task 4.3: Padronizar componentes operacionais

**Objetivo:** Criar componentes reutilizáveis alinhados com o design system existente.

**Componentes a criar em `src/components/`:**
- `ConfirmDialog.jsx` — substituir `window.confirm`
- `StatusBadge.jsx` — badge de status padronizado
- `EmptyState.jsx` — estado vazio para listas/tabelas
- `ErrorState.jsx` — estado de erro com mensagem e retry

---

## Fase 5 — UX e Alinhamento Visual (🟡 prioridade baixa)

> Melhorias cosméticas e de usabilidade, sem alterar o motor operacional.

### Task 5.1: Remover branding "Framer"

**Files a modificar:**
- `src/components/layout/Sidebar.jsx` — footer "v3.0 · Framer"
- `src/index.css` — variáveis CSS com prefixo Framer (manter funcionalidade, renomear se necessário)

### Task 5.2: Padronizar headers e estados

**Objetivo:** Consistência visual entre páginas.

- Padronizar `PageHeader` em todas as páginas
- Padronizar loading skeletons (já existe `Skeleton.jsx`, `SkeletonDetail.jsx`, etc.)
- Padronizar empty states com `EmptyState`

### Task 5.3: Melhorar fluxo de orçamento

- Reduzir cliques no fluxo automático
- Warnings antes de criar orçamento (ex: origem ausente, CNPJ inválido)
- Melhorar clareza de "cliente novo" vs "cliente antigo"
- Melhorar recuperação de rascunho (draft automático)

---

## Resumo das Fases

| Fase | Prioridade | Escopo | Estimativa |
|------|-----------|--------|------------|
| **1** — Segurança | 🔴 Máxima | Auth, rate limit, tela login | 2-3h |
| **2** — Stack | 🟠 Alta | ESLint, Prettier, separar testes, Vite fix | 1-2h |
| **3** — Testes | 🟠 Alta | Pricing, extraction, metadata, WhatsApp | 3-4h |
| **4** — Refactor | 🟡 Média | Extrair serviços e componentes | 4-6h |
| **5** — UX | 🟡 Baixa | Branding, consistência visual | 2-3h |

**Total estimado:** 12-18 horas de trabalho.

---

## Veredito

O `aspen-orcamento` é um sistema **funcional e operacional**. O motor de negócio (pricing, extração, pipeline ERPNext) funciona. O problema não é o que ele faz, é **como** está construído: sem auth, sem testes, sem lint, monolítico.

A recomendação do diagnóstico está correta: **estabilizar o legado, não reescrever**. Após as 5 fases, o sistema terá:

- ✅ API protegida com auth + rate limit
- ✅ Testes unitários no motor operacional (pricing, extraction, metadata, WhatsApp)
- ✅ ESLint + Prettier como barreira de qualidade
- ✅ Código modularizado (serviços extraídos, páginas quebradas)
- ✅ UX padronizada e sem branding Framer

O `aspen-quote` continua como referência visual/arquitetural para features futuras, mas o motor operacional segue no `aspen-orcamento`.
