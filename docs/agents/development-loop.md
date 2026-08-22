# Development loop

## Purpose

O Aspen usa desenvolvimento orientado por issues, Wayfinder maps, frontier gating, implementação e review separados, pull requests com CI e human gates. O objetivo é manter cada mudança rastreável, revisável e limitada ao ticket autorizado.

## State machine

```text
planned
→ unlocked
→ claimed
→ implementation
→ local verification
→ PR
→ CI
→ review
→ changes requested OR approved
→ merge
→ resolved
→ next frontier
```

Uma task só avança quando o gate anterior estiver satisfeito.

## Roles

- **Planner:** entende o goal/spec, mantém o mapa, cria tickets pequenos, define dependencies, frontier, out-of-scope e unknowns.
- **Implementer:** reivindica a frontier desbloqueada, trabalha em branch dedicada, implementa apenas o ticket, verifica localmente, abre PR e relata evidências.
- **Reviewer:** revisa ticket, diff real, CI, arquitetura, riscos, testes e escopo sem editar a implementação.
- **Integrator:** integra somente após todos os gates de merge e usa squash merge por padrão.
- **Closer:** registra evidência, resolve o ticket, atualiza o mapa e identifica a próxima frontier sem iniciá-la automaticamente.

## Source of truth

GitHub Issues é a fonte de verdade para specs, tickets, estado, dependências, decisões e evidências. Use as operações e convenções de `docs/agents/issue-tracker.md`.

## Wayfinder

- O mapa usa a label `wayfinder:map`.
- Children são sub-issues nativas do GitHub e usam uma label `wayfinder:<type>` apropriada.
- Dependencies nativas do GitHub são a representação canônica dos bloqueios.
- A frontier é o primeiro child, na ordem do mapa, que esteja aberto, sem blocker aberto e sem assignee.

Implemente somente a frontier atual. Não reivindique tickets bloqueados nem etapas posteriores.

## Verification

Durante o desenvolvimento:

```bash
npm run verify:fast
```

Antes do handoff ou review, quando aplicável:

```bash
npm run verify:full
```

`verify:fast` cobre os gates locais rápidos do repositório. `verify:full` acrescenta build web e E2E. A CI mantém jobs separados; este documento não replica o workflow YAML.

## Review contract

O reviewer deve:

- ler o ticket e os acceptance criteria;
- ler o diff ou PR real;
- conferir a CI;
- validar escopo e arquitetura;
- procurar regressões, riscos de segurança e impactos em dados;
- avaliar testes relevantes;
- usar o relatório do implementer apenas como evidência auxiliar;
- manter a implementação intacta durante o review;
- manter o acceptance corpus, salvo autorização explícita para alterá-lo.

O resultado é `APPROVE`, `REQUEST CHANGES` ou riscos não bloqueantes.

## Merge contract

Merge somente quando:

```text
required CI = green
AND review = approved
AND unresolved blocking review items = 0
AND PR belongs to current frontier
```

Use squash merge por padrão. O implementer não integra a própria implementação.

## Human gates

Consulte `AGENTS.md` para os gates específicos. Sempre exija decisão humana antes de:

- criar ou executar migrations;
- operar em produção;
- habilitar external writes;
- executar alterações destrutivas em dados;
- alterar secrets ou credentials.

## Completion

O ticket termina somente depois de merge, resolução da issue e atualização do mapa. Uma auditoria sem diff pode ser encerrada com evidência registrada na issue, sem commit vazio ou documento artificial.

Depois da conclusão, informe a próxima frontier ou outro próximo passo recomendado. Não o execute sem autorização, salvo modo autônomo explicitamente autorizado.
