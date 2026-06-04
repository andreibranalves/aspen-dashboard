<!--
  Sync Impact Report
  ==================
  Version change: 0.0.0 → 1.0.0 (initial)
  Modified principles: N/A (first version)
  Added sections:
    - Core Principles (5): API-First Serverless, ERPNext Pragmatism,
      Pipeline de Extração Confiável, Teste Antes de Deploy, UI Mínima Ação Máxima
    - Stack Tecnológica
    - Workflow de Desenvolvimento
    - Governance
  Removed sections: N/A
  Templates requiring updates:
    - .specify/templates/plan-template.md ✅ (aligned — Technical Context section unchanged, no conflicts)
    - .specify/templates/spec-template.md ✅ (pending verification on first use)
    - .specify/templates/tasks-template.md ✅ (pending verification on first use)
  Follow-up TODOs: None
-->
# Aspen Dashboard Constitution

## Core Principles

### I. API-First Serverless (NON-NEGOTIABLE)

Toda feature de backend é implementada como uma Vercel serverless function em
`api/_functions/`. Cada função é autocontida, stateless e idempotente — não
compartilha estado mutável entre invocações. O catch-all `api/[...path].js`
roteia todas as requisições para os handlers internos.

Regras:
- Toda nova função segue o skeleton: ESM `export async function handler(event)`,
  parse de `event.body` com try/catch, retorno `{ statusCode, body }`
- Nenhuma variável global mutável entre invocações (exceto constantes e caches
  readonly como `@vercel/kv`)
- Secrets e tokens vêm de `process.env` — nunca hardcoded
- Erros retornam status HTTP apropriado + JSON `{ error: "mensagem" }`

### II. ERPNext Pragmatismo (80/20)

Mapeamos apenas os campos do ERPNext que são operacionalmente usados. Não
clonamos doctypes inteiros — trazemos só o que agrega valor. A lógica de
dedup (`like` para sufixos "- 1") trata as idiossincrasias do ERPNext sem
propagá-las para o resto do sistema.

Regras:
- Fields mapeados são explícitos no código, não dinâmicos
- Pricing resolution: Pricing Rule (tiered → SKU) → Item Price fallback
- Customer/Contact/Deal upsert usa dedup por email, não por nome
- Naming series `ORC-YYYY####` é gerenciada no próprio ERPNext
- Novos campos custom no CRM Deal seguem prefixo `custom_`

### III. Pipeline de Extração Confiável

A extração via OpenRouter SEMPRE precede a persistência no ERPNext. O pipeline
de duas fases (extract → orcamento) é determinístico: texto/imagem entram,
pedidos estruturados saem, cotações são criadas. Falhas na extração são
reportadas com clareza — nunca degradam silenciosamente.

Regras:
- Extract rules (system prompt) são a fonte da verdade para mapeamento
  produto→SKU
- Explicit SKUs no input do usuário sempre têm precedência (Rule 0)
- Pricing bracket (30/100/300/500/1000) resolvido no backend, não exposto ao
  usuário
- Urgent orders aplicam +30% em todas as rates automaticamente
- Resposta do OpenRouter é validada como JSON array antes de prosseguir

### IV. Teste Antes de Deploy

Pipeline de qualidade obrigatório antes de merge no master. Testes unitários
(Node test runner) para funções de API, Playwright E2E para fluxos de UI,
`test_local.mjs` para integração real com ERPNext.

Regras:
- `npm test` passa limpo antes de qualquer merge
- `test_local.mjs` é executado após alterações em `extract.js` ou `orcamento.js`
- Playwright cobre: fluxo feliz de orçamento, edição de draft, envio WhatsApp
- Commits com `[skip ci]` são proibidos em master
- Flaky tests são corrigidos ou removidos — nunca ignorados

### V. UI Mínima, Ação Máxima

Single-page app com HTML, CSS e JS inline em `public/index.html`. Zero
abstrações desnecessárias. shadcn/ui + Tailwind para consistência visual.
localStorage apenas para preferências do usuário (regras de extração, templates
WhatsApp) — nunca para estado de negócio.

Regras:
- Estado de negócio vive no ERPNext (quotations, deals, customers)
- Configurações de admin (campos custom, fluxos) vivem em APIs/n8n, não em
  localStorage
- Nova UI: componente mínimo necessário, sem frameworks adicionais
- Cores: primary #0a4ee4, dark canvas #141414
- Feedback visual imediato: loading states, error messages, success indicators
  em PT-BR

## Stack Tecnológica

| Categoria | Tecnologia | Versão |
|-----------|-----------|--------|
| Runtime | Node.js (Vercel serverless) | 20.x+ |
| Frontend | React + Vite | React 19, Vite 6 |
| Estilo | Tailwind CSS + shadcn/ui | Tailwind 3.4, CVA |
| Linguagem | JavaScript (ESM) | `"type": "module"` |
| Testes | Node test runner + Playwright | Playwright 1.60+ |
| Lint/Format | ESLint + Prettier | ESLint 10, Prettier 3.8 |
| Integração | ERPNext/Frappe REST API | — |
| AI | OpenRouter (chat completions) | — |
| WhatsApp | Evolution API | — |
| Email | Resend | — |
| Automação | n8n (VPS externo) | v2.23.2 |
| PDF | Puppeteer + Chromium headless | Puppeteer 25+ |
| KV | @vercel/kv | 3.x |
| Deploy | Vercel (merge → auto-deploy) | — |

**Constraints:**
- Custo zero sempre que possível — preferir tiers gratuitos (Vercel Hobby, n8n
  self-hosted, Resend free tier)
- Sem dependências de runtime que excedam limites serverless (50MB function,
  10s/60s timeout Vercel)
- PDF generation usa Chromium headless (`--headless=new`), nunca wkhtmltopdf

## Workflow de Desenvolvimento

```
feature branch → develop → test → lint → merge → auto-deploy (Vercel)
```

1. **Branch**: `feature/<descricao>` a partir de `master`
2. **Develop**: `vercel dev` para desenvolvimento local com API routes
3. **Test**: `npm test` (unit + E2E) + `npm run test:erp` (integração real) se
   aplicável
4. **Lint**: `npm run check` (lint + build) passa limpo
5. **Validate**: Preview deploy do Vercel para validação visual
6. **Merge**: PR aprovado → merge em master → deploy automático em produção
7. **Verify**: Verificar endpoint de health e fluxo crítico pós-deploy

Nunca acumular mudanças não deployadas. Cada PR é uma unidade atômica de deploy.

## Governance

Esta constituição rege todas as decisões de arquitetura e implementação do
Aspen Dashboard. Nenhuma prática ou convenção externa tem precedência sobre
os princípios aqui definidos.

- **Emendas**: Seguem semantic versioning (MAJOR.MINOR.PATCH). Amendments exigem
  documentação da mudança, justificativa e plano de migração quando aplicável.
- **Compliance**: Todo PR deve verificar conformidade com os princípios.
  Violações devem ser justificadas no corpo do PR com razão explícita.
- **Complexidade**: Toda abstração ou dependência nova deve ser justificada.
  YAGNI é a regra — prefira soluções diretas a premature optimization.
- **Runtime guidance**: Consulte `AGENTS.md` para convenções de código,
  estrutura de módulos e detalhes operacionais do dia a dia.

**Version**: 1.0.0 | **Ratified**: 2026-06-04 | **Last Amended**: 2026-06-04
