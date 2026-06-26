# Design: Runbook e guardrails de qualidade pós-migração TypeScript

## 1. Objetivo e escopo

Estabelecer um runbook leve e guardrails práticos para manter a qualidade de tipos e build do Aspen Dashboard **depois** que a migração TypeScript foi concluída. O foco é prevenir regressões sem criar burocracia, sem novas dependências e sem mudanças massivas de CI.

**Dentro do escopo:**

- Consolidar os comandos de verificação existentes em um fluxo simples de pré-commit/pré-push.
- Definir padrões proibidos (forbidden patterns) e como detectá-los com ferramentas que já temos (`eslint`, `tsc`, scripts Node).
- Documentar o checklist de onboarding para novos arquivos em `src/` (frontend), `api/` (backend) e scripts `.mjs`.
- Criar auditorias periódicas manuais ou semi-automatizadas (ex.: contagem de `as Error`, `.js` faltante em `api/`, arquivos `.js` em `src/`).
- Propor um git hook opcional (client-side) que rode `npm run check` e testes unitários antes do push.

**Fora do escopo (não-objetivos):**

- Não criar pipeline de CI/CD na Vercel ou GitHub Actions.
- Não adicionar ferramentas novas como Husky, lint-staged, Zod, changesets, etc.
- Não reescrever regras de negócio ou migrar backend (o design de migração `api/` → `.ts` é tratado em spec separada).
- Não alterar a arquitetura de rotas, bundle ou deploy.
- Não tornar os checks obrigatórios no servidor (ainda não há CI; os guardrails são client-side e documentais).

---

## 2. Estado atual

### 2.1 Comandos de qualidade existentes

| Comando | O que verifica |
|---|---|
| `npm run lint` | ESLint em `.{js,jsx,ts,tsx,mjs}`; inclui `api/**/*` e `src/**/*`. |
| `npm run type-check` | `tsc --noEmit` no projeto inteiro (frontend + `api/` via `tsconfig.json`). |
| `npm run check:tailwind` | Script customizado que garante que `tailwind.config.js` escaneia `src/`, `.ts` e `.tsx`. |
| `npm run build` | Vite build do frontend para `public/`. |
| `npm run test:unit` | `node --test tests/unit/*.test.{js,ts}`. |
| `npm run test:e2e` | Playwright contra ambiente local ou preview. |
| `npm run check` | Orquestra lint + type-check + check:tailwind + build. |

### 2.2 Riscos de regressão identificados

Após a migração, os principais riscos não são mais "converter arquivos", mas **desfazer convenções durante o desenvolvimento normal**:

1. **Casts inseguros no frontend** — novo `(err as Error).message` ou `as Error` em blocos `catch`.
2. **Arquivos `.js`/`.jsx` reaparecendo em `src/`** — o frontend deve ser 100% `.ts`/`.tsx`.
3. **Importações sem extensão `.js` em `api/`** — backend é ESM puro; omitir `.js` quebra runtime.
4. **Tailwind `content` perdendo `.ts`/`.tsx`** — gera regressão visual de purge.
5. **Local dev sem auth/rate-limit** — código novo pode funcionar localmente e falhar em produção por não respeitar limites de rota.
6. **Tipos frouxos (`Record<string, unknown>`, `any`) sendo reintroduzidos** — perda gradual dos ganhos da migração.

### 2.3 Contexto de deploy

- Deploys são feitos via `vercel deploy --prod` (ou merge para branch conectada).
- O ambiente local pula auth e rate-limit, então não basta "funcionar no dev"; é preciso revisar manualmente rotas públicas vs. protegidas e limites.
- Não há CI no repositório hoje; qualquer gate é client-side ou via revisão humana.

---

## 3. Abordagens consideradas

### Abordagem A — Fortalecer `npm run check` + documentar convenções + hook opcional manual (recomendada)

Manter o que já existe, adicionar scripts leves de auditoria e um hook git simples que qualquer pessoa pode instalar copiando um arquivo.

**Mudanças:**

- Adicionar scripts de auditoria em `scripts/quality-audit.mjs`:
  - Conta `as Error`, `as Error)` e `(err as Error)` em `src/`.
  - Conta arquivos `.js`/`.jsx` em `src/`.
  - Conta imports relativos em `api/` que não terminam em `.js`.
  - Verifica se `tailwind.config.js` content inclui `ts`/`tsx` (já coberto por `check:tailwind`).
- Atualizar `AGENTS.md` com:
  - Seção "Onboarding de novos arquivos".
  - Seção "Antes do push" listando `npm run check` e `npm run test:unit`.
  - Lista de padrões proibidos.
- Criar `.githooks/pre-push` como template (não ativado automaticamente; instrução de `git config core.hooksPath .githooks`).
- Adicionar `npm run audit:quality` ao `package.json`.

**Prós:**

- Zero dependências novas.
- Zero mudanças de infraestrutura/CI.
- Fácil de adotar gradualmente: quem quiser ativa o hook.
- Scripts de auditoria podem ser rodados a qualquer momento.
- Mantém `npm run check` como única entrada de verificação.

**Contras:**

- Não é obrigatório no servidor (ainda depende de disciplina da equipe).
- Hook client-side pode ser desabilitado localmente.

### Abordagem B — Git hooks com Husky + lint-staged

Instalar Husky e lint-staged para rodar lint/prettier/type-check em staged files antes de cada commit.

**Prós:**

- Mais automático e padronizado.
- Pode validar apenas arquivos modificados, acelerando o feedback.

**Contras:**

- Adiciona dependências (`husky`, `lint-staged`) sem aprovação prévia.
- Aumenta complexidade para um time pequeno.
- Não resolve o problema de falta de CI; ainda é client-side.
- Overkill para o objetivo "leve e incremental".

### Abordagem C — Pipeline CI na Vercel/GitHub Actions

Criar workflow que roda `npm run check`, testes unitários e e2e a cada push/PR.

**Prós:**

- Gate real no servidor; ninguém pode quebrar `master` sem passar pelos checks.
- Preview deploys só acontecem após sucesso.

**Contras:**

- Requer configuração de runner, secrets, tempo de execução e manutenção.
- Testes e2e precisam de ambiente ERPNext/Vercel ativo, o que torna o CI lento e frágil.
- Foge do escopo "minimal" e "sem massive CI changes".

### Resumo comparativo

| Abordagem | Dependências novas | Infra | Coerção | Esforço | Recomendação |
|---|---|---|---|---|---|
| A — check + docs + hook opcional | 0 | 0 | Disciplina + revisão | Baixo | **Sim** |
| B — Husky + lint-staged | Husky, lint-staged | 0 | Disciplina | Médio | Não |
| C — CI/GitHub Actions | runner + config | CI | Servidor | Alto | Não agora |

**Decisão:** adotar **Abordagem A** como guardrail pós-migração. As abordagens B e C podem ser reavaliadas no futuro, mas não fazem parte deste design.

---

## 4. Abordagem recomendada (detalhamento)

### 4.1 Entrada única de qualidade

Manter `npm run check` como o comando principal, mas expandi-lo levemente:

```json
{
  "scripts": {
    "check": "npm run lint && npm run type-check && npm run check:tailwind && npm run build",
    "check:quick": "npm run lint && npm run type-check && npm run check:tailwind",
    "audit:quality": "node scripts/quality-audit.mjs"
  }
}
```

- `check` continua sendo o comando de confiança (inclui build).
- `check:quick` pode ser usado no hook para evitar build completo a cada push.
- `audit:quality` é informativo: lista métricas e alerta sobre padrões proibidos.

### 4.2 Script de auditoria: `scripts/quality-audit.mjs`

O script lê o repositório e reporta:

1. **Frontend casts inseguros**
   - Conta ocorrências de `as Error` em `src/` (inclui `(err as Error)`).
   - Meta: 0.
2. **Arquivos JavaScript em `src/`**
   - Lista `.js` / `.jsx` em `src/` (deve ser vazio).
3. **Imports sem `.js` em `api/`**
   - Lista imports relativos em `api/**/*.js` (e futuramente `api/**/*.ts`) que não terminam em `.js`.
   - Meta: 0.
4. **Resumo de checks**
   - Tamanho do bundle (`public/assets/index-*.js` / `.css`).
   - Quantidade de arquivos `.ts`/`.tsx` em `src/`.

O script **não falha o build** por padrão; ele serve para alertar. Pode receber uma flag `--strict` para sair com código de erro se encontrar padrões proibidos.

Exemplo de saída:

```txt
=== Aspen Quality Audit ===
✓ src/ is 100% TypeScript (0 .js/.jsx files)
✓ No unsafe 'as Error' casts in src/
✓ All relative imports in api/ use .js extension

Bundle:
  public/assets/index-*.js  517 kB
  public/assets/index-*.css  42 kB

Tip: run `npm run check` before pushing.
```

### 4.3 Atualização do `AGENTS.md`

Adicionar duas seções ao `AGENTS.md` raiz (ou atualizar as existentes):

#### Seção: "Onboarding de novos arquivos"

| Tipo de arquivo | Onde criar | Extensão | Convenções |
|---|---|---|---|
| Página React | `src/pages/*.tsx` | `.tsx` | Use `@/` para imports; props tipadas; evite `any`. |
| Componente React | `src/components/**/*.tsx` | `.tsx` | Tipar props; preferir `unknown` + narrowing a `any`. |
| Lib/hook frontend | `src/lib/*.ts`, `src/hooks/*.ts` | `.ts` | Use `ensureError`/`getErrorMessage` para catch; evite `as Error`. |
| Handler Vercel | `api/_functions/*.js` | `.js` (até migração TS) | Imports locais **sempre** com `.js`; retornar `{statusCode, body}`. |
| Lib backend | `api/_functions/lib/*.js` | `.js` | Adicione `// @ts-check` + JSDoc para type safety. |
| Script standalone | `scripts/*.mjs` | `.mjs` | ESM; imports com extensão explícita. |
| Teste unitário | `tests/unit/*.test.{js,ts}` | `.ts` preferencialmente | Tipar mocks; usar `as const` onde apropriado. |

#### Seção: "Antes do push / runbook de qualidade"

```markdown
## Runbook de qualidade

1. **Durante o desenvolvimento:**
   - `npm run dev` (frontend) e `node scripts/dev-api-server.mjs` (API).

2. **Antes de commitar:**
   - `npm run lint` e `npm run type-check`.

3. **Antes de fazer push:**
   - `npm run check` (lint + type-check + tailwind + build).
   - `npm run test:unit`.
   - `npm run audit:quality` (verifica padrões proibidos).

4. **Antes de deploy em produção:**
   - Rodar `npm run test:e2e` contra preview da Vercel.
   - Validar rotas afetadas em ambiente real (auth/rate-limit só rodam na Vercel).

### Padrões proibidos

- `as Error` ou `(err as Error).message` em `src/`.
- Arquivos `.js`/`.jsx` novos em `src/`.
- Imports relativos sem `.js` em `api/` (ex.: `import { foo } from './bar'`).
- `any` sem justificativa em código novo.
- Alterar `api/_functions/pricing.js` sem rodar todos os testes de SKU × bracket.
```

### 4.4 Git hook opcional: `.githooks/pre-push`

Criar um hook leve no repositório, mas **não ativá-lo automaticamente**. O desenvolvedor escolhe se usa.

```bash
#!/bin/bash
set -e

echo "[pre-push] Running quality checks..."

npm run check:quick
npm run test:unit
npm run audit:quality -- --strict

echo "[pre-push] OK"
```

Instrução de ativação (documentada no `AGENTS.md`):

```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-push
```

Por que não Husky? Para evitar dependência nova e manter o setup transparente. Qualquer pessoa pode inspecionar `.githooks/pre-push`.

### 4.5 Período de auditoria sugerido

Mesmo sem CI, recomenda-se rodar `npm run audit:quality`:

- **Semanalmente** durante sprints ativos.
- **Antes de cada release/prod deploy**.
- **Após merges grandes** (ex.: migração de handlers, grandes features).

Se alguma métrica sair da meta, abre-se um chore rápido para corrigir antes de acumular débito.

---

## 5. Componentes e arquivos

| Arquivo/script | Ação |
|---|---|
| `scripts/quality-audit.mjs` | Novo script de auditoria de padrões proibidos e métricas. |
| `package.json` | Adicionar `check:quick` e `audit:quality`; manter `check` atual. |
| `.githooks/pre-push` | Novo hook template (opcional, não ativado por padrão). |
| `AGENTS.md` | Atualizar com seções "Onboarding de novos arquivos" e "Runbook de qualidade". |
| `eslint.config.js` | Opcional: reforçar regra `@typescript-eslint/no-explicit-any` como warn. |

### 5.1 `scripts/quality-audit.mjs` (esqueleto)

```js
import { glob } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { strict as assert } from 'node:assert';

const srcFiles = await Array.fromAsync(glob('src/**/*.{ts,tsx}'));
const apiFiles = await Array.fromAsync(glob('api/**/*.{js,ts}'));

let asErrorCount = 0;
for (const f of srcFiles) {
  const text = await readFile(f, 'utf8');
  const matches = text.match(/\(err as Error\)|as Error/g) ?? [];
  asErrorCount += matches.length;
}

let missingJsExtCount = 0;
const relativeImportRe = /from\s+['"](\.\/[^'"]+)['"]/g;
for (const f of apiFiles) {
  const text = await readFile(f, 'utf8');
  for (const [, path] of text.matchAll(relativeImportRe)) {
    if (!path.endsWith('.js')) missingJsExtCount++;
  }
}

console.log(`Unsafe 'as Error' casts in src/: ${asErrorCount}`);
console.log(`Relative imports in api/ missing .js extension: ${missingJsExtCount}`);
```

> O script final pode ser mais robusto (ignorar comentários, suportar `import()` dinâmico, etc.), mas o esqueleto já atende ao objetivo de alerta.

---

## 6. Exemplos de uso

### 6.1 Fluxo de desenvolvimento normal

```bash
# 1. Inicia ambiente
node scripts/dev-api-server.mjs &
npm run dev

# 2. Faz alterações...

# 3. Verifica antes de commitar
npm run lint
npm run type-check

# 4. Verifica antes de push
npm run check
npm run test:unit
npm run audit:quality

# 5. Deploy
vercel deploy --prod
```

### 6.2 Novo handler Vercel (até migração TS)

```js
// api/_functions/novo-handler.js
import { createApiError } from './lib/api-helpers.js'; // ✅ .js explícito

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  // ...
}
```

### 6.3 Novo componente React

```tsx
// src/components/ui/NovoCard.tsx
import { useState } from 'react';

interface NovoCardProps {
  title: string;
  onClick?: () => void;
}

export default function NovoCard({ title, onClick }: NovoCardProps) {
  const [loading, setLoading] = useState(false);
  // ✅ props tipadas, sem any
  return <button onClick={onClick}>{title}</button>;
}
```

### 6.4 Tratamento de erro sem `as Error`

```tsx
// src/lib/errors.ts (recomendado existir após spec de tipos frouxos)
import { getErrorMessage } from '@/lib/errors';

} catch (err) {
  setError(getErrorMessage(err, 'Erro ao carregar dados.'));
}
```

---

## 7. Testes e critérios de sucesso

### 7.1 Critérios do próprio guardrail

- `npm run check` continua passando após as mudanças.
- `npm run audit:quality` roda sem erros fatais e reporta métricas.
- Hook `pre-push` (se ativado) roda `check:quick`, `test:unit` e `audit:quality --strict` sem falhas.
- `AGENTS.md` reflete as novas seções de onboarding e runbook.

### 7.2 Métricas de qualidade (metas)

| Métrica | Meta |
|---|---|
| Arquivos `.js`/`.jsx` em `src/` | 0 |
| Ocorrências de `as Error` em `src/` | 0 (ou roadmap para 0) |
| Imports relativos sem `.js` em `api/` | 0 |
| `any` explícitos em código novo | 0 |
| `npm run check` no push | Passar |
| `npm run test:unit` no push | Passar |

### 7.3 Validação manual periódica

Semanalmente (ou antes de release), rodar:

```bash
npm run check
npm run test:unit
npm run audit:quality -- --strict
```

Se `--strict` falhar, abre-se um chore de correção antes de prosseguir.

---

## 8. Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Equipe ignora o hook opcional | Médio | Deixar o hook como recomendação; reforçar na revisão de PR e no `AGENTS.md`. |
| `audit:quality` gera falsos positivos | Baixo | Script usa regex simples; revisar manualmente quando houver dúvida. Permitir comentário de supressão raro. |
| Aumento do tempo de push | Baixo | Hook usa `check:quick` (sem build); build completo fica para antes do deploy. |
| Geração de `.js` ao migrar `api/` para TS | Médio | Quando a spec de migração `api/` for implementada, adicionar `api/**/*.js` ao `.gitignore` e ajustar a auditoria para ignorar arquivos gerados. |
| Divergência entre local e produção (auth/rate-limit) | Alto | Manter checklist de validação em preview da Vercel antes de produção; documentar no runbook. |

---

## 9. Não-objetivos (reafirmação)

- Não criar CI/GitHub Actions.
- Não adicionar Husky, lint-staged ou qualquer outra dependência.
- Não migrar `api/` para TypeScript (já coberto por outra spec).
- Não reescrever regras de negócio ou componentes.
- Não tornar os guardrails obrigatórios no servidor nesta fase.

---

## 10. Próximos passos sugeridos

1. Criar `scripts/quality-audit.mjs` com as verificações iniciais.
2. Atualizar `package.json` com `check:quick` e `audit:quality`.
3. Criar `.githooks/pre-push` e documentar ativação no `AGENTS.md`.
4. Atualizar `AGENTS.md` com seções de onboarding e runbook.
5. Rodar `npm run audit:quality` para estabelecer baseline.
6. (Futuro) Avaliar CI server-side quando o time crescer ou o deploy automatizado for necessário.
