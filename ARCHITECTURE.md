# Arquitetura

Guia curto das boundaries do Aspen Orçamento para desenvolvedores e coding agents.

Stack: React 19 e Vite 6 no frontend; Node.js ESM numa única Function da Vercel (ADR 0009); PostgreSQL via Drizzle; Evolution API para WhatsApp e OpenRouter para extração.

## Mapa

```text
Frontend e páginas       src/features/
Rotas do frontend        src/app/routes.tsx
Dispatch do frontend     src/app/App.tsx
Componentes de UI        src/components/ui/
Componentes compartilhados src/components/shared/

Function implantável     api/[...path].ts
Adaptação HTTP            api/_http/
Roteamento HTTP           api/_app/
Handlers e negócio        api/_modules/
Código compartilhado      api/_shared/
PostgreSQL e Drizzle      api/_infrastructure/db/
APIs externas             api/_infrastructure/integrations/
Worker do VPS             api/_worker/ (imagem e deploy em deploy/worker/)
```

## Fluxo e responsabilidades

```text
Frontend → HTTP → api/_app → api/_modules → api/_infrastructure
```

- O frontend acessa estado e regras de negócio pelo backend HTTP; não acessa banco diretamente.
- Exceção: `MediaUploader` envia bytes diretamente ao Vercel Blob com token emitido por `/api/communication-media-upload`; metadados continuam passando pelo backend.
- `api/[...path].ts` é a única Function implantável e delega ao pipeline HTTP compartilhado.
- `api/_worker/main.ts` é a entrada do container `aspen-worker` no VPS (ADR 0013). Não é Function da Vercel: usa o mesmo build e os mesmos módulos, mas atende só `/health` e `/wake`, pelo qual a Function o acorda depois de gravar trabalho. Deploy e operação em [`docs/worker-runbook.md`](docs/worker-runbook.md).
- Autenticação, rate limiting e normalização de erros permanecem nesse pipeline; respostas e logs não expõem segredos, dados pessoais, stack traces ou erros brutos.
- `api/_app/routes.ts` é o único registro de endpoints.
- `api/_http` adapta transportes; não contém regras de negócio.
- `api/_modules` contém handlers e regras de negócio, usando infraestrutura por interfaces, helpers e factories exportadas.
- `api/_shared` contém autenticação, rate limiting, erros e helpers neutros; não contém handlers, regras de negócio ou escritas no banco.
- Repositórios em `api/_infrastructure/db/repositories` controlam estado durável e transações.
- Implementações de transporte, configuração, SDKs e URLs-base de fornecedores ficam em `api/_infrastructure/integrations`; módulos consomem as factories exportadas e podem fornecer paths específicos da operação exigidos pelo contrato do cliente.

## Regras para alterações

Não:

- acessar PostgreSQL ou Drizzle pelo frontend;
- acessar PostgreSQL ou Drizzle fora do boundary documentado em [`docs/postgresql-drizzle-boundary.md`](docs/postgresql-drizzle-boundary.md);
- importar SDKs ou ler configuração de ambiente de Evolution API, OpenRouter, Resend, wake do worker, Vercel Blob ou Vercel KV em `api/_modules` ou `api/_shared`; use as factories da camada de integrações;
- acessar fornecedores diretamente pelo frontend, exceto o upload ao Vercel Blob mediado pelo token do backend descrito acima;
- adicionar rotas do frontend fora de `src/app/routes.tsx`;
- adicionar endpoints fora de `api/_app/routes.ts`;
- criar outra Function implantável ou duplicar adapters HTTP;
- colocar detalhes de banco, transporte ou fornecedor em regras de negócio;
- criar novo fallback de provedor, transporte ou persistência;
- adicionar dependências sem aprovação explícita; migrations seguem a autorização e os gates de [`docs/database-migrations.md`](docs/database-migrations.md).

Ao alterar uma boundary, atualize este documento e os guards arquiteturais relacionados na mesma mudança.

## Verificação

A verificação exigida para concluir depende da classificação de risco da mudança, conforme a fonte normativa [`docs/release-lanes.md`](docs/release-lanes.md), que escolhe os checks pelo risco e reserva a suíte ampla para um `RELEASE` justificado.
