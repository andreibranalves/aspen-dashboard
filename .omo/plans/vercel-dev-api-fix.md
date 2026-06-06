# Fix `vercel dev` API Route Detection

## TL;DR

> **Quick Summary**: `vercel dev` não detecta as funções serverless em `api/` — apenas o frontend Vite carrega. O plano diagnostica a causa raiz (provável conflito `outputDirectory` + detecção de funções) e aplica correções no `vercel.json`.
>
> **Deliverables**:
> - Diagnóstico confirmado da causa raiz (baseline com `curl` + `--debug`)
> - `vercel.json` corrigido com funções detectadas corretamente
> - Verificação de que rotas públicas, de auth e protegidas respondem
> - SPA continua funcionando após correções
>
> **Estimated Effort**: Quick
> **Parallel Execution**: NO — sequencial (cada task depende do diagnóstico da anterior)
> **Critical Path**: Task 1 (baseline) → Task 2 (diagnóstico aprofundado) → Task 3 (correção) → Task 4 (verificação)

---

## Context

### Original Request
Usuário reportou que ao rodar `vercel dev`, o frontend carrega (Vite SPA) mas as rotas API (`/api/*`) retornam erro. O output do terminal mostra apenas Vite, sem menção a "Functions", "Lambda handler" ou qualquer detecção de rotas API.

### Interview Summary
**Key Discussions**:
- **Sintoma**: Frontend carrega, API dá erro (não 401, não 404 — erros genéricos como 500)
- **Ambiente**: Vercel CLI v50.25.4, Node.js v24.15.0, Windows 11
- **Output `vercel dev`**: Apenas `VITE v6.4.2 ready in 280 ms` — zero menção a funções
- **Estratégia de teste**: Tests-after + Agent-Executed QA (curl nos endpoints)
- **`.env` local**: Contém `APP_PASSWORD` e `ERPNEXT_TOKEN`

**Research Findings**:
- **Causa provável #1**: `outputDirectory: "public"` no `vercel.json` faz o dev server do Vercel priorizar arquivos estáticos, interferindo na detecção de funções em `api/`
- **Causa provável #2**: `functions` glob `"api/[...path].js"` tem colchetes que podem ser interpretados como character class de glob
- **Causa provável #3**: Possível incompatibilidade Node.js v24 com Vercel CLI v50
- **Catch-all handler**: `api/[...path].js` importa 27 sub-handlers + usa `res.status().json()` (estilo Express) que depende de helper augmentation do Vercel
- **Auth ativo**: `.env` tem `APP_PASSWORD` → auth NÃO está em "dev mode" → todas as rotas protegidas exigem cookie/token

### Metis Review
**Identified Gaps** (addressed in plan):
- **Pré-diagnóstico necessário**: Testar rota pública `view` primeiro como canário — se funcionar, funções estão ok e auth é o problema; se falhar, funções não estão rodando
- **Cache `.vercel`**: Pode conter artefatos stale que interferem na detecção
- **Module-level side-effects**: Os 29 imports no top-level do handler podem crashar se algum módulo acessar `process.env` em module scope
- **Auth interference**: `APP_PASSWORD` está setado → auth exigido. Testar com login primeiro para isolar
- **Windows paths**: Separadores de path podem causar mismatch na detecção de funções

---

## Work Objectives

### Core Objective
Fazer o `vercel dev` detectar e servir corretamente as funções serverless do diretório `api/`, mantendo o frontend SPA funcionando.

### Concrete Deliverables
- Diagnóstico confirmando a causa raiz (funções não detectadas vs auth vs crash de módulo)
- `vercel.json` corrigido (se necessário)
- Rotas `view` (pública), `login` (auth), e uma protegida (ex: `quotations`) respondendo corretamente
- SPA servindo normalmente em `/`

### Definition of Done
- [ ] `curl http://localhost:3000/api/view?q=ORC-20261143` retorna 200 com HTML
- [ ] `curl -X POST http://localhost:3000/api/login -H "Content-Type: application/json" -d '{"password":"20520040"}'` retorna 200 com cookie
- [ ] Rota protegida responde 200 com cookie válido
- [ ] `curl http://localhost:3000/` retorna o SPA (HTML com React root)
- [ ] `vercel dev` output mostra detecção de funções (qualquer menção a "Functions", "Lambda", ou registro de rotas)

### Must Have
- Funções serverless detectadas e funcionando em `vercel dev`
- Frontend SPA continua operacional
- Auth continua funcionando (não bypass para "fazer funcionar")

### Must NOT Have (Guardrails)
- **NÃO modificar** arquivos em `api/_functions/` ou `api/_lib/` — escopo é apenas `vercel.json`
- **NÃO alterar** a assinatura do handler (`handler(req, res)`) ou o `function-adapter.js`
- **NÃO adicionar** dependências ao `package.json`
- **NÃO modificar** as regras de rewrite (a regex com negative lookahead está correta)
- **NÃO desabilitar** auth para debug (se auth for o problema, será tratado separadamente)
- **NÃO fazer deploy** — alterações são apenas para desenvolvimento local

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed via curl + terminal output capture.

### Test Decision
- **Infrastructure exists**: YES (node:test + Playwright)
- **Automated tests**: Tests-after (sem TDD — verificação com curl após cada correção)
- **Framework**: N/A (verificação via curl + análise de output do terminal)
- **Agent-Executed QA**: MANDATORY para todas as tasks

### QA Policy
- **API/Backend**: Bash (curl) — enviar requests, validar status code + response body
- **Terminal output**: Bash — capturar e analisar output do `vercel dev`
- **Frontend**: Bash (curl) — verificar que SPA HTML é retornado
- Evidência salva em `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`

---

## Execution Strategy

### Sequential Flow (diagnóstico depende de cada step anterior)

```
Task 1 (Baseline + limpeza):
├── Limpar cache .vercel/
├── Iniciar vercel dev --debug
├── Testar rota pública (view) — canário
└── Capturar output do terminal

Task 2 (Diagnóstico aprofundado):
├── Testar rota auth (login)
├── Testar rota protegida com cookie
├── Verificar se handler chega a ser invocado
└── Identificar causa raiz exata

Task 3 (Correção):
├── Aplicar correção no vercel.json (ou onde for necessário)
├── Reiniciar vercel dev
└── Verificar detecção de funções

Task 4 (Verificação final):
├── Testar todas as 3 categorias de rota
├── Verificar SPA continua funcionando
└── Capturar evidências

Critical Path: Task 1 → Task 2 → Task 3 → Task 4
Todas sequenciais — cada uma depende da anterior.
```

### Agent Dispatch Summary

- **T1**: `unspecified-high` — Diagnóstico inicial, múltiplos curls, análise de output
- **T2**: `unspecified-high` — Diagnóstico aprofundado, possível debugging de módulo
- **T3**: `quick` — Correção de config (escopo limitado)
- **T4**: `unspecified-high` — Verificação abrangente, múltiplos cenários

---

## TODOs

- [x] 1. Baseline diagnóstico + limpeza de cache

  **What to do**:
  - Remover diretório `.vercel/` para eliminar cache stale: `rm -rf .vercel` (Windows: `Remove-Item -Recurse -Force .vercel`)
  - Recriar o link do projeto: `vercel link` (usar o projeto existente `aspen-dashboard`)
  - Iniciar `vercel dev --debug` em background e capturar output completo de startup (~15s)
  - Analisar output: procurar por "Functions", "Lambda", "Node.js runtime", "api/", ou erros
  - Testar a rota pública `view` como canário (não requer auth):
    ```bash
    curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/view?q=ORC-20261143
    ```
  - Se `view` retornar 200 → funções estão rodando, problema é auth
  - Se `view` retornar erro → funções não estão sendo detectadas/invocadas
  - Registrar output completo do `--debug` para análise na Task 2

  **Must NOT do**:
  - NÃO modificar nenhum arquivo ainda — apenas diagnóstico
  - NÃO alterar `.env` ou `vercel.json`
  - NÃO tentar "consertar" nada nesta task

  **Recommended Agent Profile**:
  > Diagnóstico com múltiplos comandos shell + análise de output
  - **Category**: `unspecified-high`
    - Reason: Diagnóstico requer múltiplos comandos coordenados, análise de output, e decisão baseada em evidências
  - **Skills**: [`playwright`]
    - `playwright`: Para iniciar browser e verificar visualmente se necessário, mas primariamente usar curl

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (primeira task — baseline)
  - **Blocks**: Task 2 (diagnóstico aprofundado depende destes resultados)
  - **Blocked By**: None (pode começar imediatamente)

  **References**:
  - `vercel.json:1-17` — Config atual do Vercel (outputDirectory, functions, rewrites)
  - `api/[...path].js:1-82` — Catch-all handler (auth guard, route dispatch)
  - `api/_lib/auth.js:52-68` — `isAuthenticated()` — dev mode quando APP_PASSWORD undefined
  - `api/_functions/view.js` — Única rota pública (sem auth, GET, retorna HTML) — usar como canário
  - `.env` — Contém APP_PASSWORD (auth ativo) e ERPNEXT_TOKEN

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Limpeza de cache e startup do vercel dev
    Tool: Bash (PowerShell)
    Preconditions: Projeto linkado no Vercel (project.json existe)
    Steps:
      1. Remove-Item -Recurse -Force ".vercel" (limpa cache)
      2. cmd /c "vercel link" (re-link ao projeto aspen-dashboard)
      3. Iniciar vercel dev em background com timeout de 60s
      4. Capturar stdout + stderr completos
      5. Procurar no output por strings: "Functions", "Lambda", "Node.js runtime", "api/", "Error", "Cannot find"
    Expected Result: Output do startup capturado. Identificar se há ou não menção a funções API.
    Failure Indicators: Output truncado, vercel dev não sobe, erro de link
    Evidence: .sisyphus/evidence/task-1-startup-output.txt

  Scenario: Teste da rota pública view (canário)
    Tool: Bash (curl)
    Preconditions: vercel dev rodando em localhost:3000
    Steps:
      1. curl -s -w "\n%{http_code}" "http://localhost:3000/api/view?q=ORC-20261143"
      2. Verificar HTTP status code
      3. Verificar Content-Type header (deve ser text/html ou application/json)
      4. Se status != 200, capturar corpo da resposta
    Expected Result: 200 com HTML ou erro claro (não HTML do SPA)
    Failure Indicators: Sem resposta, timeout, HTML do index.html (significa rewrite capturou a rota)
    Evidence: .sisyphus/evidence/task-1-view-route.txt

  Scenario: Teste de conectividade básica
    Tool: Bash (curl)
    Preconditions: vercel dev rodando
    Steps:
      1. curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
      2. Verificar se retorna 200 (SPA)
      3. curl -s http://localhost:3000/ | Select-String "root" (verificar que contém React root)
    Expected Result: 200, HTML contendo div#root
    Failure Indicators: 404, 500, ou resposta vazia
    Evidence: .sisyphus/evidence/task-1-spa-check.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-1-startup-output.txt` — Output completo do `vercel dev --debug`
  - [ ] `task-1-view-route.txt` — Resposta da rota view com status code
  - [ ] `task-1-spa-check.txt` — Confirmação que SPA carrega

  **Commit**: NO (diagnóstico apenas, sem alterações de código)

- [x] 2. Diagnóstico aprofundado da causa raiz

  **What to do**:
  - Analisar o output do `vercel dev --debug` capturado na Task 1:
    - Se NÃO há menção a "Functions"/"Lambda" → funções não detectadas → causa é config
    - Se HÁ menção mas erros → funções detectadas mas crashando → causa é runtime/import
  - Testar rota de auth (`login`):
    ```bash
    curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/login \
      -H "Content-Type: application/json" \
      -d '{"password":"20520040"}'
    ```
    - Se 200 → funções funcionam, auth ok
    - Se 401 → auth funcionando mas credenciais erradas (improvável com senha correta)
    - Se erro → funções não detectadas ou crash
  - Se login funcionar, capturar cookie e testar rota protegida:
    ```bash
    curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/quotations \
      -H "Content-Type: application/json" \
      -b "aspen_token=20520040" \
      -d '{"action":"list"}'
    ```
  - Se funções NÃO detectadas: verificar se o handler é ao menos importado — adicionar temporariamente `console.log('[DEBUG] handler loaded')` no topo do `api/[...path].js` (após imports, antes do `export default`), reiniciar, verificar se aparece no output
  - Identificar causa raiz exata dentre:
    - A) `outputDirectory` conflitando com detecção de `api/`
    - B) Catch-all `[...path].js` não sendo reconhecido como entrypoint
    - C) Crash de módulo (import com side-effect)
    - D) Node.js v24 incompatibilidade
    - E) Auth bloqueando (mas view pública também falharia)

  **Must NOT do**:
  - NÃO aplicar correções ainda — apenas diagnosticar
  - NÃO remover o `console.log` de debug sem registrar o resultado
  - NÃO modificar handlers permanentemente

  **Recommended Agent Profile**:
  > Análise de logs + debugging direcionado + testes com curl
  - **Category**: `unspecified-high`
    - Reason: Requer análise de múltiplas fontes de evidência e debugging estratégico
  - **Skills**: []
    - N/A — trabalho é shell + análise de output

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Task 3 (correção depende da causa raiz identificada)
  - **Blocked By**: Task 1

  **References**:
  - `api/_functions/view.js` — Handler público para verificar padrão de export
  - `api/_functions/login.js` — Handler de auth
  - `api/_lib/function-adapter.js:25-44` — `toFunctionEvent` e `sendFunctionResult` (conversão Express↔Vercel)
  - `api/_lib/rate-limit.js:24-55` — `checkRateLimit` (usa `getRouteName`)
  - `vercel.json:6-9` — Config `functions` com glob `api/[...path].js`

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Teste da rota de login (auth)
    Tool: Bash (curl)
    Preconditions: vercel dev rodando
    Steps:
      1. curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/login -H "Content-Type: application/json" -d '{"password":"20520040"}'
      2. Verificar status code
      3. Se 200, verificar se há header Set-Cookie com aspen_token
      4. Se não 200, capturar corpo do erro
    Expected Result: 200 com cookie aspen_token OU erro claro (não HTML do SPA)
    Failure Indicators: HTML do index.html como resposta (rewrite capturou), sem resposta
    Evidence: .sisyphus/evidence/task-2-login.txt

  Scenario: Teste de rota protegida com cookie
    Tool: Bash (curl)
    Preconditions: Login funcionou (cookie disponível)
    Steps:
      1. curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/quotations -H "Content-Type: application/json" -b "aspen_token=20520040" -d '{"action":"list"}'
      2. Verificar status code e response
    Expected Result: 200 com JSON (lista de cotações ou array vazio)
    Failure Indicators: 401, HTML do SPA, erro 500
    Evidence: .sisyphus/evidence/task-2-protected-route.txt

  Scenario: Verificação de module-load (debug)
    Tool: Bash (grep/Edit)
    Preconditions: Funções não detectadas confirmado na Task 1
    Steps:
      1. Adicionar console.log('[DEBUG] [...path].js handler module loaded') no topo de api/[...path].js (após imports)
      2. Reiniciar vercel dev
      3. Verificar se a mensagem aparece no output
    Expected Result: Se aparecer → handler foi carregado, crash é no runtime. Se NÃO aparecer → módulo nem foi importado
    Evidence: .sisyphus/evidence/task-2-module-load.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-2-login.txt` — Resposta da rota de login
  - [ ] `task-2-protected-route.txt` — Resposta da rota protegida
  - [ ] `task-2-module-load.txt` — Resultado do debug de module-load (se aplicável)
  - [ ] `task-2-root-cause.md` — Documento curto identificando a causa raiz exata

  **Commit**: NO (diagnóstico apenas)

- [x] 3. Correção da configuração

  **What to do**:
  - Baseado no diagnóstico da Task 2, aplicar a correção apropriada:

    **Se causa for A (outputDirectory conflito)**:
    - Remover `outputDirectory: "public"` temporariamente e testar
    - Se resolver, o problema é a ordem de detecção. Solução: manter `outputDirectory` mas adicionar `functions` config explícito
    - Alternativa: testar com `"api/**/*.js"` no `functions` em vez do glob com colchetes

    **Se causa for B (catch-all não reconhecido)**:
    - Testar criando um endpoint simples `api/test.js` com `export default function handler(req, res) { res.status(200).json({ ok: true }); }`
    - Se `test.js` funciona mas `[...path].js` não → problema é com catch-all especificamente
    - Solução: verificar se o Vercel CLI suporta `[...path].js` na versão atual; possível renomear ou usar `[route].js`

    **Se causa for C (crash de módulo)**:
    - Identificar qual módulo está crashando (via stack trace ou isolamento)
    - Adicionar try/catch nos imports problemáticos OU
    - Mover imports para dentro do handler (lazy loading)

    **Se causa for D (Node.js v24)**:
    - Testar com Node.js 20 ou 22 via `nvm use`
    - Se resolver, documentar incompatibilidade e recomendar versão

  - Após correção, reiniciar `vercel dev`
  - Verificar que o output agora mostra detecção de funções
  - Remover qualquer `console.log` de debug adicionado na Task 2

  **Must NOT do**:
  - NÃO modificar handlers de `_functions/` permanentemente
  - NÃO remover `outputDirectory` permanentemente sem testar que SPA quebra
  - NÃO fazer deploy
  - NÃO adicionar dependências

  **Recommended Agent Profile**:
  > Correção cirúrgica de configuração, escopo limitado
  - **Category**: `quick`
    - Reason: Após diagnóstico, a correção é focada em config (vercel.json) ou ajuste pontual
  - **Skills**: []
    - N/A — edição de config + teste com curl

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Task 4 (verificação final)
  - **Blocked By**: Task 2 (precisa do diagnóstico)

  **References**:
  - `vercel.json:1-17` — Config a ser modificada
  - `vite.config.js` — Build output dir (`public/`), para referência ao modificar outputDirectory
  - `api/[...path].js:1-82` — Handler principal (se precisar ajustar imports)
  - Task 2 output (`task-2-root-cause.md`) — Diagnóstico da causa raiz

  **Acceptance Criteria**:
  - [ ] `vercel dev` output contém menção a funções API (qualquer string: "Functions", "Lambda", "Node.js runtime")
  - [ ] Rota pública `view` retorna 200
  - [ ] `console.log` de debug removidos

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Verificação de detecção de funções pós-correção
    Tool: Bash (PowerShell)
    Preconditions: Correção aplicada no vercel.json
    Steps:
      1. Iniciar vercel dev (timeout 60s)
      2. Capturar output de startup
      3. Procurar por strings: "Functions", "Lambda", "Node.js runtime", "api/"
      4. Confirmar que PELO MENOS UMA dessas strings aparece
    Expected Result: Output contém menção a funções serverless
    Failure Indicators: Output idêntico ao pré-correção (apenas Vite)
    Evidence: .sisyphus/evidence/task-3-startup-after-fix.txt

  Scenario: Rota pública view funcionando
    Tool: Bash (curl)
    Preconditions: vercel dev rodando pós-correção
    Steps:
      1. curl -s -w "\nHTTP_STATUS:%{http_code}" "http://localhost:3000/api/view?q=ORC-20261143"
      2. Verificar HTTP_STATUS:200
      3. Verificar que resposta contém HTML (não JSON de erro, não HTML do SPA)
    Expected Result: HTTP 200, Content-Type: text/html, contém elementos de cotação
    Failure Indicators: Status != 200, resposta é index.html do SPA
    Evidence: .sisyphus/evidence/task-3-view-works.txt

  Scenario: Rollback — SPA continua funcionando
    Tool: Bash (curl)
    Preconditions: vercel dev rodando pós-correção
    Steps:
      1. curl -s -w "\nHTTP_STATUS:%{http_code}" http://localhost:3000/
      2. Verificar HTTP_STATUS:200
      3. Verificar que resposta contém "<div id=\"root\">" (React mount point)
    Expected Result: HTTP 200, HTML do SPA com div#root
    Failure Indicators: 404, blank page, erro
    Evidence: .sisyphus/evidence/task-3-spa-still-works.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-3-startup-after-fix.txt` — Output do vercel dev pós-correção
  - [ ] `task-3-view-works.txt` — Resposta da rota view
  - [ ] `task-3-spa-still-works.txt` — Verificação que SPA não quebrou

  **Commit**: YES
  - Message: `fix(vercel): restore api function detection in vercel dev`
  - Files: `vercel.json` (e potencialmente `api/[...path].js` se precisou de ajuste mínimo)
  - Pre-commit: `npm run lint`

- [x] 4. Verificação final completa

  **What to do**:
  - Testar todas as 3 categorias de rota em sequência:
    1. **Pública**: `GET /api/view?q=ORC-20261143` → 200 HTML
    2. **Auth**: `POST /api/login` com senha correta → 200 + cookie; com senha errada → 401
    3. **Protegida**: `POST /api/quotations` com cookie → 200 JSON
  - Testar edge cases:
    - Rota inexistente: `GET /api/rota-que-nao-existe` → 404 JSON
    - Sem auth em rota protegida: `POST /api/quotations` sem cookie → 401
    - SPA hash routes: `GET /#/dashboard` → SPA HTML (não quebrou roteamento)
  - Verificar que o output do terminal mostra as rotas sendo acessadas (logs de request)
  - Rodar `npm run lint` para garantir que nenhuma alteração quebrou o lint

  **Must NOT do**:
  - NÃO testar todas as 27 rotas — 3 representativas bastam
  - NÃO fazer deploy
  - NÃO adicionar novos testes unitários (fora do escopo)

  **Recommended Agent Profile**:
  > Verificação abrangente com múltiplos cenários curl
  - **Category**: `unspecified-high`
    - Reason: Requer testar múltiplos cenários, capturar evidências, e validar edge cases
  - **Skills**: []
    - N/A — trabalho é curl + análise de output

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (última task de implementação)
  - **Blocks**: Final Verification Wave (F1-F4)
  - **Blocked By**: Task 3

  **References**:
  - `api/_lib/auth.js:6-9` — PUBLIC_ROUTES e AUTH_ROUTES (para confirmar quais rotas são públicas)
  - `api/_lib/auth.js:52-68` — `isAuthenticated()` lógica completa
  - `vercel.json:11-16` — Rewrites (verificar que SPA hash routes funcionam)

  **Acceptance Criteria**:
  - [ ] Todas as 3 categorias de rota respondem corretamente
  - [ ] Edge cases de erro retornam status apropriados
  - [ ] `npm run lint` passa

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Fluxo completo — view → login → quotations
    Tool: Bash (curl)
    Preconditions: vercel dev rodando pós-correção
    Steps:
      1. curl -s -w "\n%{http_code}" "http://localhost:3000/api/view?q=ORC-20261143" → esperado 200
      2. curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/login -H "Content-Type: application/json" -d '{"password":"20520040"}' → esperado 200
      3. curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/quotations -H "Content-Type: application/json" -b "aspen_token=20520040" -d '{"action":"list"}' → esperado 200
    Expected Result: 200, 200, 200 respectivamente
    Failure Indicators: Qualquer status != 200
    Evidence: .sisyphus/evidence/task-4-full-flow.txt

  Scenario: Edge cases — erros esperados
    Tool: Bash (curl)
    Preconditions: vercel dev rodando
    Steps:
      1. curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/login -H "Content-Type: application/json" -d '{"password":"wrong"}' → esperado 401
      2. curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/quotations -H "Content-Type: application/json" -d '{"action":"list"}' → esperado 401 (sem cookie)
      3. curl -s -w "\n%{http_code}" "http://localhost:3000/api/rota-inexistente" → esperado 404
    Expected Result: 401, 401, 404 respectivamente
    Failure Indicators: 500 em vez de 401/404, HTML do SPA em vez de JSON
    Evidence: .sisyphus/evidence/task-4-edge-cases.txt

  Scenario: SPA hash routes preservadas
    Tool: Bash (curl)
    Preconditions: vercel dev rodando
    Steps:
      1. curl -s -w "\n%{http_code}" "http://localhost:3000/"
      2. Verificar que resposta é HTML do SPA (contém div#root, script tags)
      3. curl -s -w "\n%{http_code}" "http://localhost:3000/assets/" (verificar assets estáticos)
    Expected Result: Ambos retornam HTML/recursos do SPA (não erros)
    Failure Indicators: 404 em assets, HTML quebrado
    Evidence: .sisyphus/evidence/task-4-spa-routes.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-4-full-flow.txt` — Fluxo view→login→quotations
  - [ ] `task-4-edge-cases.txt` — Cenários de erro
  - [ ] `task-4-spa-routes.txt` — SPA continua funcionando
  - [ ] `task-4-lint.txt` — Output do `npm run lint`

  **Commit**: YES (se houver ajustes finos) ou ammend do commit da Task 3
  - Message: `fix(vercel): restore api function detection in vercel dev`
  - Pre-commit: `npm run lint`

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** — `oracle`
  Verificar cada "Must Have" presente e cada "Must NOT Have" ausente. Checar evidências em `.sisyphus/evidence/`.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Rodar `npm run lint`. Revisar diff: sem `console.log` de debug, sem código comentado, sem imports não utilizados.
  Output: `Lint [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high`
  Executar TODOS os QA scenarios de todas as tasks. Verificar cross-task: view → login → quotations. Testar edge cases: sem cookie, senha errada, rota inexistente.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  Verificar que apenas `vercel.json` foi modificado (nenhum handler, lib, ou package.json). Checar "Must NOT do" compliance.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Commit único** após Task 4: `fix(vercel): restore api function detection in vercel dev`
  - Files: `vercel.json`
  - Pre-commit: verificar que `npm run lint` passa

---

## Success Criteria

### Verification Commands
```bash
# Rota pública (canário)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/view?q=ORC-20261143
# Expected: 200

# Rota de auth
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"password":"20520040"}'
# Expected: 200

# SPA
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
# Expected: 200
```

### Final Checklist
- [ ] `vercel dev` output mostra detecção de funções API
- [ ] Rota pública `view` retorna 200
- [ ] Rota `login` retorna 200 com cookie
- [ ] Rota protegida funciona com cookie válido
- [ ] SPA carrega normalmente
- [ ] Auth não foi bypassada
- [ ] Nenhum handler foi modificado
