# Handoff: 2026-06-01 — Estabilização Aspen Orçamento (Fases 1–2)

**Projeto:** aspen-orcamento (legado Vite + Vercel)
**Branch:** `fix/auditoria-2026-05-27`
**Data:** 2026-06-01 ~20:00 UTC

## Resumo da Sessão

Avaliamos um diagnóstico de 14 áreas de melhoria do `aspen-orcamento`, validamos cada claim contra o código real, e montamos um plano de estabilização em 5 fases documentado em `.hermes/plans/2026-05-27-estabilizacao-aspen-orcamento.md`. Implementamos as Fases 1 (Segurança) e 2 (Qualidade de Stack). O build passa, lint tem 0 errors 36 warnings (todos `no-unused-vars` preexistentes), e o próximo passo é a Fase 3 (testes unitários do motor operacional).

## Decisões

| Decisão | Motivo | Alternativas |
|---|---|---|
| Estabilizar legado, não reescrever | Motor operacional (pricing, extraction, ERPNext) funciona; risco está na falta de auth/testes/lint | Rewrite completo em aspen-quote (rejeitado — muito risco) |
| Auth via cookie httpOnly + senha única | Simples, sem banco de usuários, suficiente para app interno | JWT (overkill), OAuth (complexidade desnecessária) |
| ESLint flat config com ambientes separados (Node/Browser/Playwright) | Cobertura correta de globals sem falsos positivos | Config única genérica (gerava muitos erros) |
| `npm test` = unit + e2e; `npm run test:erp` = destrutivo | Evitar criação acidental de dados reais | Flag de ambiente RUN_ERP_WRITE_TESTS (mais complexo) |

## Arquivos

| Ação | Caminho | Notas |
|---|---|---|
| **Criado** | `api/_lib/auth.js` | Middleware de auth: `isAuthenticated()`, `getRouteName()`, `parseCookies()` |
| **Criado** | `api/_functions/login.js` | POST /api/login → seta cookie httpOnly 30 dias |
| **Criado** | `api/_functions/logout.js` | POST /api/logout → limpa cookie |
| **Criado** | `api/_lib/rate-limit.js` | Rate limiter in-memory: extract 10/min, orcamento 20/min, whatsapp 5/min, login 10/min |
| **Criado** | `src/pages/LoginPage.jsx` | Tela full-screen com input de senha, design Framer |
| **Criado** | `eslint.config.js` | Flat config com 3 ambientes (Node, Browser, Playwright scripts) |
| **Criado** | `.prettierrc` | Config Prettier: singleQuote, trailingComma es5, printWidth 100 |
| **Criado** | `.prettierignore` | Ignora node_modules, public/assets, dist |
| **Criado** | `static/` | Diretório vazio para assets estáticos |
| **Criado** | `.hermes/plans/2026-05-27-estabilizacao-aspen-orcamento.md` | Plano completo 5 fases (761 linhas) |
| **Modificado** | `api/[...path].js` | Auth guard (401) + rate limit (429) + rotas login/logout |
| **Modificado** | `src/App.jsx` | Rota `#/login` renderiza fora do Layout |
| **Modificado** | `src/lib/api.js` | Intercepta 401 → redirect `#/login` |
| **Modificado** | `package.json` | Scripts: lint, format, check, test:erp |
| **Modificado** | `vite.config.js` | `publicDir: 'static'` — elimina warning |
| **Modificado** | `src/pages/LoginPage.jsx` | Removeu eslint-disable comment |
| **Modificado** | `src/pages/CrmKanbanPage.jsx` | Removeu eslint-disable comment |
| **Modificado** | `src/pages/QuotationsPage.jsx` | Removeu eslint-disable comment |

## Estado Atual

- **Funcionando:** Build Vite passa limpo (sem warning publicDir/outDir). ESLint 0 errors, 36 warnings. Auth middleware operacional. Rate limiting ativo.
- **Quebrado/Pendente:** `APP_PASSWORD` está **vazia** no `.env` local e **não configurada** no Vercel. Sem ela em produção, API continua aberta. ⚠️ **Ação manual necessária.**
- **Testes:** `npm test` agora roda unit (placeholder vazio) + e2e. `npm run test:erp` é o teste destrutivo.
- **1 arquivo não commitado:** `src/pages/QuotationDetailPage.jsx` (modificado por alterações externas)

## Próximos Passos

### Imediato (Fase 3 — comece aqui)

1. **Configurar `APP_PASSWORD` no Vercel** (Dashboard → Settings → Environment Variables)
2. **Task 3.1:** Criar `tests/unit/pricing.test.js` — testar brackets (30/100/300/500/1000), urgência +30%, fallback, SKU inexistente
3. **Task 3.2:** Criar `tests/unit/extract-rules.test.js` — validar SKUs por tipo de produto (14 cenários)
4. **Task 3.3:** Criar `tests/unit/client-metadata.test.js` — origem, CNPJ, endereço
5. **Task 3.4:** Criar `tests/unit/whatsapp-flows.test.js` — render template, sequência
6. **Task 3.5:** Atualizar `test:unit` script de placeholder para `node --test tests/unit/*.test.js`

### Depois

- **Fase 4:** Refatorar sem mudar comportamento — extrair serviços do `orcamento.js`, quebrar `AutoQuotePage.jsx` (1346 linhas), padronizar `ConfirmDialog`
- **Fase 5:** UX — remover "Framer", padronizar headers/estados, code splitting

## Contexto Técnico

- **Padrões usados:** ESM everywhere, imports com `.js` explícito, handler skeleton padrão (`httpMethod` guard → `JSON.parse` → try/catch → `createHttpError`), design system Framer (Tailwind + CSS variables)
- **Rotas públicas (sem auth):** `view`, `login`, `logout`
- **Rate limits:** extract=10/min, orcamento=20/min, send-whatsapp=5/min, login=10/min
- **Cookie auth:** `aspen_token` = APP_PASSWORD, httpOnly, Secure, SameSite=Lax, 30 dias
- **Planos existentes:** `2026-05-27-audit-fixes.md` (6 bugs críticos já corrigidos), `2026-05-27-estabilizacao-aspen-orcamento.md` (plano atual)

## Git

```
8073b1a fix: corrige LinkValidationError (UOM 'und')
96f4899 chore(stack): separa test:erp + corrige warning Vite
c019bce chore(stack): ESLint + Prettier
12a7ba4 feat(security): rate limiting
bba54b8 feat(auth): Fase 1 — auth + tela login
b3a30cf docs(plan): plano de estabilização 5 fases
26cc45a test: origem='Bríndice' em test_local.mjs
3e40ba8 fix: edit-draft valida JSON da IA
```

Branch: `fix/auditoria-2026-05-27` (limpa, 1 arquivo modificado não commitado)

## Notas

- O diagnóstico original está em `/opt/data/webui/attachments/e8c1464b0a4a/diagnostico-aspen-orcamento.md`
- O plano completo está em `.hermes/plans/2026-05-27-estabilizacao-aspen-orcamento.md`
- A claim #5 do diagnóstico (duplicação front/back de regras) já foi resolvida anteriormente — regras são backend-only no `extract.js DEFAULT_RULES`
- `vercel` CLI não está instalado neste ambiente — deploy precisa ser feito manualmente ou via git push
