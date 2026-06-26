# TypeScript Migration — Next Steps

> Historical note: this document describes the state after Phase 1. Frontend files listed below may already have been migrated in later phases. See `docs/typescript-migration-fase4-fase5-report.md` for the current frontend state.

## Fase 1 concluída

- TypeScript + `@types/node` instalados.
- `tsconfig.json` configurado com:
  - `allowJs: true`
  - `checkJs: false`
  - `noEmit: true`
  - `allowImportingTsExtensions: true`
  - `isolatedModules: true`
  - paths `@/*` → `src/*`
  - types `node` e `vite/client`
- ESLint e Prettier configurados para `.ts`/`.tsx`.
- Convertidos para TypeScript:
  - `src/lib/utils.ts`
  - `src/lib/formatters.ts`
- Testes adicionados:
  - `tests/unit/formatters.test.ts`
- Pipeline validado:
  - `npm run lint` ✅
  - `npx tsc --noEmit` ✅
  - `npm run build` ✅
  - `tests/unit/formatters.test.ts` ✅

## Decisões tomadas

- **Imports extensionless no frontend:** usamos `@/lib/utils` ao invés de `@/lib/utils.ts`. O Vite resolve. O teste unitário importa com `.ts` por exigência do Node ESM/type stripping.
- **`allowImportingTsExtensions: true`:** necessário porque `tests/unit/formatters.test.ts` importa `../../src/lib/formatters.ts` com extensão e o projeto usa `noEmit: true`.
- **`TZ=UTC` no script `test:unit`:** garante que testes de data sejam determinísticos independentemente do timezone do host.
- **Backend continua em JS:** não ativamos `checkJs` globalmente. Quando quisermos type safety em um arquivo `.js` específico, usamos `// @ts-check` no topo do arquivo.
- **`tests/orcamento.spec.js` fora do `include`:** o arquivo tem `// @ts-check` e gera erros. Por isso, `tsconfig.json` inclui apenas `tests/unit/**/*` nesta fase.

## Próximos passos sugeridos (em ordem)

1. **Frontend libs puras**
   - `src/lib/constants.js`
   - `src/lib/erpLinks.js`
   - `src/lib/printFormats.js`
   - `src/lib/api.js`

2. **Componentes UI atômicos**
   - `src/components/ui/input.jsx`
   - `src/components/ui/badge.jsx`
   - `src/components/ui/table.jsx`
   - `src/components/ui/back-button.jsx`

3. **Hooks pequenos**
   - `src/hooks/useDarkMode.js`
   - `src/hooks/useImageInput.js`

4. **Backend libs puras (com `// @ts-check` ou `.ts`)**
   - `api/_functions/lib/time-greeting.js`
   - `api/_functions/lib/quote-response.js`
   - `api/_functions/lib/client-metadata.js`

5. **Handlers de API (futuro, maior risco)**
   - Requer validar build no Vercel com `.ts` em `api/`.
   - Começar por `login.js` / `logout.js`.
   - Deixar `pricing.js`, `extract.js`, `orcamento.js` para o final.

## Quando parar

- Pare quando o custo de tipar um arquivo superar o benefício claro.
- Não é necessário converter 100% do projeto.
- Integrações externas mal documentadas (ERPNext, Frappe) podem usar `any` ou interfaces parciais.

## Riscos a monitorar

- `checkJs: true` global no backend gera muitos erros — não ative sem planejamento.
- Vercel Functions com `.ts` precisam ser testados em deploy de preview antes de produção.
- `node --test` com `.ts` pode falhar em Node < 22.
- O bloco TypeScript no ESLint flat config não aplica regras React Hooks a `.tsx` — tratar ao migrar componentes.
