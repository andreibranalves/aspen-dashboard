# Design: Apertar tipos frouxos no frontend — erros e respostas de API

## 1. Objetivo e escopo

Eliminar casts inseguros de erro (`as Error`) e reduzir o uso de `Record<string, unknown>` / `unknown[]` nas fronteiras de API do frontend, trocando por tipos explícitos e helpers de narrowing. Manter comportamento em runtime idêntico, sem novas dependências, sem alterar backend e sem impactar bundle/code-splitting.

**Dentro do escopo:**

- Criar helper centralizado `ensureError` (e opcional `getErrorMessage`) para tratar `unknown` em blocos `catch`.
- Converter `ApiError` de interface + cast manual para factory tipada (`createApiError`), garantindo `status` e `data` no objeto de erro.
- Introduzir type guards simples (`hasErrorMessage`, `isApiError`) para evitar `data as { error?: string }`.
- Tipar respostas de API mais repetidas: extração (`ExtractedOrder`, `ExtractedItem`), rascunhos, mídias/flows (`ExecuteFlowPayload`/`ExecuteFlowResponse`).
- Substituir mecanicamente `(err as Error).message` por `getErrorMessage(err, ...)` ou `ensureError(err).message` em páginas e libs.

**Fora do escopo (não-objetivos):**

- Não migrar backend (`api/` continua `.js`).
- Não adicionar Zod, Valibot ou qualquer validação em runtime.
- Não alterar bundle/code-splitting.
- Não reescrever lógica de negócio ou componentes além do necessário para troca de tipos.
- Não criar biblioteca de schemas/validação.
- Não alterar contratos de API entre frontend e backend.

---

## 2. Contexto e contagens atuais

Após a migração para TypeScript, o frontend ainda contém tipagens frouxas nos pontos de contato com API e erros:

| Padrão | Ocorrências | Arquivos afetados |
|---|---|---|
| `as Error` (inclui `(err as Error)`) | 11 | 9 arquivos |
| `(err as Error).message` | 11 | 9 arquivos |
| `Record<string, unknown>` | 23 | 9 arquivos |
| `unknown[]` | 4 | 2 arquivos (`communicationApi.ts`, `whatsappFlows.ts`) |
| ` as ` (todos os casts) | ~105 | 22 arquivos |
| `unknown` (total) | ~94 | 19 arquivos |

### Pontos de maior risco

1. **`(err as Error).message` em blocos `catch`** — expõe a aplicação a falhas se o valor capturado não for uma `Error` (pode ser `undefined`, string, objeto, etc.).
2. **`Record<string, unknown>` para payloads e respostas de API** — perde autocompletar, refatoração segura e verificação em tempo de compilação.
3. **`data as { error?: string }` no wrapper `api.ts` e em `communicationApi.ts`** — cast pontual que pode ser eliminado com type guard simples.
4. **`unknown[]` em `ExecuteFlowPayload.items` e `ExecuteFlowResponse.steps`/`evolution`** — array sem forma; substituir por tipos leves baseados no que o frontend realmente consome.

---

## 3. Abordagens consideradas

### Abordagem A — Minimal & safe (recomendada)

Helpers de narrowing + factory tipada + interfaces explícitas. Sem novas dependências.

**Mudanças:**
- Criar `src/lib/errors.ts` com `ensureError`, `getErrorMessage`, `isApiError`.
- Alterar `src/lib/api.ts` para usar `createApiError` e `hasErrorMessage`.
- Trocar `(err as Error).message` por `getErrorMessage(err, fallback)`.
- Substituir `Record<string, unknown>` / `unknown[]` por interfaces específicas nos arquivos de domínio.

**Prós:**
- Zero dependências novas.
- Zero alterações de backend.
- Nenhuma mudança em bundle (tree-shakeable puro).
- Risco mínimo: apenas type-level + helpers que preservam runtime.
- Fácil de revisar linha a linha.

**Contras:**
- Não valida runtime (mantém o contrato atual "confiar no backend").
- Requer manutenção manual dos tipos quando backend mudar.

### Abordagem B — `ApiError` como classe

Transformar `ApiError` em classe estendendo `Error`.

**Prós:**
- `instanceof ApiError` funciona naturalmente.

**Contras:**
- Classes em TypeScript com `Error` exigem `Object.setPrototypeOf` ou ajuste de prototype para preservar `instanceof` após transpilação em alguns targets.
- Maior mudança estrutural sem ganho funcional sobre factory + type guard.
- Pode quebrar lugares que esperam `Error` simples.

### Abordagem C — Validação em runtime com Zod/Valibot

Adicionar biblioteca de schema validation e tipar a partir de schemas.

**Prós:**
- Tipos e validação de runtime alinhados.

**Contras:**
- Nova dependência (fora do escopo).
- Aumento de bundle.
- Overkill para o objetivo atual; backend continua sendo a fonte da verdade.

**Decisão:** adotar **Abordagem A — minimal & safe**.

---

## 4. Componentes e arquivos

### 4.1 `src/lib/errors.ts` (novo)

Helpers centralizados para lidar com valores `unknown` capturados em exceções.

```ts
export interface ApiError extends Error {
  status: number;
  data?: unknown;
}

export function ensureError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  return new Error(String(error));
}

export function getErrorMessage(
  error: unknown,
  fallback = 'Ocorreu um erro.',
): string {
  return ensureError(error).message || fallback;
}

export function createApiError(
  message: string,
  status: number,
  data?: unknown,
): ApiError {
  const err = new Error(message) as ApiError;
  err.status = status;
  if (data !== undefined) err.data = data;
  return err;
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof Error && 'status' in error && typeof (error as ApiError).status === 'number';
}
```

> `createApiError` pode ser mantido em `src/lib/api.ts` se preferirmos coesão com o wrapper; o design não é prescritivo sobre o arquivo, apenas sobre a assinatura.

### 4.2 `src/lib/api.ts`

- Importar `createApiError` e `getErrorMessage`.
- Remover a interface `ApiError` daqui se for para `src/lib/errors.ts`; caso contrário, reexportar.
- Introduzir type guard para evitar `data as { error?: string }`:

```ts
function hasErrorMessage(data: unknown): data is { error: string } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof (data as { error?: unknown }).error === 'string'
  );
}
```

- Usar `createApiError` nas duas rotas de erro (401 e `!res.ok`).
- Manter `request<T>` com generics; manter `data as T` no retorno pois é o ponto de fronteira confiável (o backend define o contrato).

### 4.3 `src/hooks/useExtractionDrafts.ts`

- Tipar `ExtractedItem` e `ExtractedOrder` no lugar de `Record<string, unknown>`.
- `Draft.original` passa de `Record<string, unknown>` para `ExtractedOrder`.
- `Draft.result.data` passa de `Record<string, unknown>` para `ExtractedOrderResult` ou similar.
- `DraftEdited` mantém `[key: string]: unknown` apenas se realmente necessário; considerar remover index signature se todos os campos são conhecidos.
- Usar `ensureError` no `catch` de `fetchPricing`.
- `buildDraftsFromOrders` recebe `ExtractedOrder[]` em vez de `Record<string, unknown>[]`.

```ts
export interface ExtractedItem {
  item_code?: string;
  qty?: number;
  rate?: number | null;
  item_name?: string;
}

export interface ExtractedOrder {
  nome?: string;
  email?: string;
  telefone?: string;
  urgente?: boolean;
  origem?: string;
  cnpj?: string;
  endereco?: unknown;
  items?: ExtractedItem[];
  prazo_producao?: string;
  // [key: string]: unknown; // manter apenas se necessário
}
```

### 4.4 `src/lib/communicationApi.ts`

- Substituir `unknown[]` por tipos leves em `ExecuteFlowPayload` e `ExecuteFlowResponse`.
- Introduzir type guard local `hasErrorMessage` para evitar `data as { error?: string }`.
- Manter interfaces existentes; adicionar apenas campos que já são usados no frontend.

```ts
export interface ExecuteFlowItem {
  item_code: string;
  qty: number;
  rate?: number;
  item_name?: string;
}

export interface ExecuteFlowPayload {
  quotation_id: string;
  flow_id: string;
  telefone: string;
  nome: string;
  deal_id?: string | null;
  items?: ExecuteFlowItem[];
}

export interface ExecuteFlowStep {
  type: string;
  template?: string;
  media?: string;
  source?: string;
  caption?: string;
}

export interface ExecuteFlowResponse {
  success: boolean;
  dry_run: boolean;
  duplicate_warning: boolean;
  duplicate_message: string;
  flow_id: string;
  flow_name: string;
  quotation_id: string | null;
  deal_id: string | null;
  phone: string;
  product_summary: string;
  categories: string[];
  steps_count: number;
  steps: ExecuteFlowStep[];
  evolution: { status: string; message?: string }[];
  send_event_id: string | null;
}
```

> Os tipos acima são exemplos; a implementação deve espelhar exatamente o que o backend `/api/send-whatsapp-flow` retorna hoje, sem inventar campos.

### 4.5 `src/lib/clientMetadata.ts`

- `normalizeAddress` usa `address as Record<string, unknown>`. Substituir por `hasOwnProperty` / type guard inline ou, se preferível, manter o cast local mas comentado como fronteira de dados brutos.
- Como `normalizeAddress` recebe `unknown`, a abordagem recomendada é iterar chaves conhecidas sem cast genérico:

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeAddress(address: unknown): Address {
  if (!isRecord(address)) return { ...EMPTY_ADDRESS };
  return {
    cep: onlyDigits(address.cep),
    logradouro: String(address.logradouro || '').trim(),
    // ...
  };
}
```

### 4.6 Páginas e componentes afetados

Substituir `(err as Error).message` por `getErrorMessage(err, ...)` ou `ensureError(err).message` em:

- `src/pages/AutoQuotePage.tsx`
- `src/pages/QuotationsPage.tsx`
- `src/pages/LeadsPage.tsx`
- `src/pages/SalesOrdersPage.tsx`
- `src/pages/CrmKanbanPage.tsx`
- `src/pages/ProductsPage.tsx`
- `src/pages/LeadDetailPage.tsx`
- `src/pages/ProductDetailPage.tsx`
- `src/pages/QuotationDetailPage.tsx`
- `src/pages/ManualOrcamentoPage.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/SalesOrderDetailPage.tsx`
- `src/components/communication/SendHistoryTab.tsx`
- `src/components/communication/MediaLibrary.tsx`
- `src/components/communication/MediaUploader.tsx`
- `src/components/communication/FlowEditorTab.tsx`
- `src/components/DraftReviewCard.tsx`
- `src/lib/whatsappFlows.ts`

---

## 5. Fluxo de dados / exemplos

### 5.1 Tratamento de erro

```ts
// antes
} catch (err) {
  setError((err as Error).message || 'Erro ao carregar orçamentos.');
}

// depois
} catch (err) {
  setError(getErrorMessage(err, 'Erro ao carregar orçamentos.'));
}
```

### 5.2 Criação de ApiError

```ts
// antes
const err = new Error(
  (data as { error?: string })?.error || `Erro ${res.status}`,
) as ApiError;
err.status = res.status;
err.data = data;
throw err;

// depois
const message = hasErrorMessage(data) ? data.error : `Erro ${res.status}`;
throw createApiError(message, res.status, data);
```

### 5.3 Resposta de API tipada

```ts
// antes
const data = await res.json() as Record<string, unknown>;

// depois
const data = await res.json() as ExtractedOrderResponse;
```

### 5.4 Uso de `unknown` em catch com log

```ts
// antes
} catch (err) {
  console.warn('[pricing]', (err as Error).message);
}

// depois
} catch (err) {
  console.warn('[pricing]', ensureError(err).message);
}
```

---

## 6. Testes e critérios de sucesso

- `npm run type-check` executa sem erros.
- `npm run lint` passa (sem novos warns relacionados).
- `npm run test:unit` passa com todos os testes.
- Contagem de `as Error` / `(err as Error)` cai para **zero**.
- Contagem de `Record<string, unknown>` reduzida nos arquivos de domínio (meta: remover do `useExtractionDrafts.ts` e reduzir em páginas de detalhe).
- `unknown[]` reduzido para zero em `communicationApi.ts` e `whatsappFlows.ts`.
- Nenhuma alteração de comportamento observável no app (testes e2e de fluxo crítico devem passar).
- Revisão manual de cada arquivo alterado para garantir que nenhum fallback de mensagem foi perdido.

---

## 7. Plano de implementação resumido

1. Criar `src/lib/errors.ts` com `ensureError`, `getErrorMessage`, `createApiError`, `isApiError`.
2. Atualizar `src/lib/api.ts` para usar `createApiError` e `hasErrorMessage`.
3. Atualizar `src/lib/clientMetadata.ts` com `isRecord` / type guard em `normalizeAddress`.
4. Atualizar `src/hooks/useExtractionDrafts.ts` com tipos `ExtractedOrder`/`ExtractedItem` e `ensureError`.
5. Atualizar `src/lib/communicationApi.ts` com tipos leves para `ExecuteFlowPayload`/`ExecuteFlowResponse` e type guard `hasErrorMessage`.
6. Atualizar `src/lib/whatsappFlows.ts` com `ensureError` e tipagem apropriada para arrays.
7. Mecanicamente substituir `(err as Error).message` em todas as páginas/componentes listados.
8. Rodar `npm run type-check`, `npm run lint`, `npm run test:unit`.
9. Rodar smoke test manual e/ou e2e nos fluxos de orçamento e WhatsApp.

---

## 8. Não-objetivos (reafirmação)

- Não reescrever componentes além do necessário para a troca de tipos.
- Não criar biblioteca de validação de schemas.
- Não alterar contratos de API entre frontend e backend.
- Não adicionar dependências.
- Não mudar backend (`api/`).
- Não alterar configuração de bundle ou code-splitting.
