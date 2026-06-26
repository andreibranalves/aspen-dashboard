# Design: Tighten Frontend Types

**Data:** 2026-06-25  
**Escopo:** Frontend SPA (`src/`)

## Status

Design aprovado. Aguardando plano de implementação.

## Contexto

O frontend do Aspen Orçamento já foi migrado para TypeScript e opera com `strict: true`. Apesar disso, alguns pontos de fricção tipográfica permanecem:

- `src/lib/api.ts` constrói `ApiError` via cast `as ApiError` em vez de uma factory tipada.
- Entidades como `Product` e `DraftEdited` usam assinaturas de índice `unknown` para acomodar campos variáveis do ERPNext.
- Interfaces de domínio estão colocadas nos arquivos que as consomem, gerando duplicação e dificultando a manutenção.
- A falta de um vocabulário de tipos compartilhado faz com que componentes redeclarem shapes semelhantes de forma inconsistente.

## Objetivo

Eliminar casts inseguros, substituir `unknown` index signatures por tipos explícitos e estabelecer um vocabulário de domínio centralizado em `src/types/`, garantindo que `npm run type-check` continue passando sem regressões.

## Escopo

Este design cobre apenas o SPA em `src/`.

### Estrutura de tipos

Criar `src/types/` com a seguinte separação de responsabilidades:

| Arquivo | Responsabilidade |
|---|---|
| `src/types/api.ts` | Tipos da camada HTTP: `ApiError`, `ApiResponse<T>`, parâmetros das funções de `src/lib/api.ts`. |
| `src/types/erpnext.ts` | Shapes brutos vindos do ERPNext/Frappe. Campos opcionais e aliases são permitidos aqui. |
| `src/types/domain.ts` | Entidades normalizadas do negócio: `Product`, `Customer`, `Quotation`, `DraftEdited`, `DashboardSummary`, etc. |
| `src/types/index.ts` | Re-exporta todos os tipos públicos. |

### Refatorações principais

1. **`ApiError` tipado via factory**
   - Substituir o cast `as ApiError` por `createApiError(error: unknown): ApiError`.
   - A factory deve usar type guards (`instanceof Error`, checagem de `statusCode`, etc.) para preencher os campos conhecidos e usar defaults seguros para o restante.

2. **Remover `unknown` index signatures do domínio**
   - `Product` e `DraftEdited` devem declarar explicitamente as propriedades conhecidas.
   - Campos realmente dinâmicos devem usar um mapa tipado (`Record<string, T>` com `T` específico) em vez de `unknown` genérico.

3. **Unificar tipos colocados**
   - Mover interfaces reutilizáveis (ex.: `DashboardSummary`, `TopProduct`) de páginas para `src/types/domain.ts`.
   - Manter tipos estritamente locais no arquivo consumidor apenas quando não houver reuso.

4. **Tipar `src/lib/api.ts` com os novos shapes**
   - Usar `ApiError` e `ApiResponse<T>` importados de `@/types/api`.
   - Tipar corretamente o bloco `catch` das funções `request`, `apiGet`, `apiPost`, etc.

## Fora de escopo

- Migração dos handlers Vercel em `api/` para TypeScript.
- Validação runtime dos dados da API (schemas com zod/valibot).
- Refatoração de lógica de negócio ou de componentes além do necessário para ajustar tipos.

## Convenções

- Não usar `any`. Quando a origem for não confiável, usar `unknown` acompanhado de type guard.
- Campos brutos do ERPNext ficam em `src/types/erpnext.ts`; entidades consumidas pela UI ficam em `src/types/domain.ts`.
- Casts `as` só são permitidos dentro de factories ou guards com justificativa documentada em comentário.
- Preferir tipos colocados apenas quando não houver reuso. Tipos usados em mais de um lugar devem ficar em `src/types/`.

## Critérios de sucesso

1. `npm run type-check` passa antes e depois das alterações.
2. Nenhum cast `as ApiError` inseguro permanece em `src/lib/api.ts`.
3. `unknown` index signatures são removidos de `Product` e `DraftEdited` (ou convertidos em mapas tipados).
4. Nenhum novo `any` é introduzido.
5. Interfaces duplicadas entre páginas e `src/lib/*` são consolidadas em `src/types/domain.ts`.

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Runtime continua sem validação | Documentado como fora de escopo. Manter fallback de erro visual nas páginas. |
| Componentes quebrarem por props mais estritas | Rodar `npm run type-check` a cada arquivo alterado durante a implementação. |
| Campos do ERPNext faltantes nos novos tipos | Deixar propriedades opcionais (`?`) em `src/types/erpnext.ts` e mapear apenas os campos estáveis para `domain.ts`. |

## Próximos passos

1. Criar `src/types/{api,erpnext,domain,index}.ts`.
2. Refatorar `src/lib/api.ts` para usar `ApiError` via factory.
3. Substituir interfaces locais duplicadas pelos novos tipos de domínio.
4. Ajustar `Product`, `DraftEdited` e outras entidades com index signatures.
5. Rodar `npm run type-check` e corrigir erros emergentes.
