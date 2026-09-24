# Aspen Orçamento

Ferramenta interna da Aspen Estamparia para criar, emitir e acompanhar
orçamentos, com atendimento por WhatsApp, CRM, pedidos e resultados. Um único
operador; em produção com dados reais.

## Rodar localmente

```bash
npm ci
npm run dev
```

Valores reais ficam fora do checkout (ver `AGENTS.md`, seção "Ambiente
operacional"); `.env.example` lista os nomes. Validação: `npm run verify:fast`.

## Documentação

| Assunto | Onde |
| --- | --- |
| Regras de trabalho, autorizações e comandos | [`AGENTS.md`](AGENTS.md) |
| Arquitetura e boundaries | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| Produto, usuários e rotas | [`PRODUCT.md`](PRODUCT.md) |
| Contrato visual | [`DESIGN.md`](DESIGN.md) |
| Glossário do domínio | [`CONTEXT.md`](CONTEXT.md) |
| Decisões de arquitetura | [`docs/adr/`](docs/adr/) |
| Risco, validação e gates | [`docs/release-lanes.md`](docs/release-lanes.md) |
| Preview e E2E controlado | [`docs/preview-isolation.md`](docs/preview-isolation.md) |
| Migrations PostgreSQL | [`docs/database-migrations.md`](docs/database-migrations.md) |
| E2E local seguro | [`docs/safe-e2e.md`](docs/safe-e2e.md) |
| WhatsApp em operação | [`docs/whatsapp-operational-runbook.md`](docs/whatsapp-operational-runbook.md) |

Material histórico (specs, planos e evidências antigas) fica na tag
`archive/historico-2026-09`.
