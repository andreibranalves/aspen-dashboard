# Inventário após remoção da WhatsApp Inbox

> **Superado por [`atendimento-comercial-assistido.md`](./atendimento-comercial-assistido.md) (decisão D1): o Atendimento voltou a ser a superfície de conversa e o KV de conversas foi retirado.**
>
> **Documento histórico (não-normativo).** Registro de execução/análise concluída, mantido como evidência; nenhum comando aqui é política executável atual. Fontes normativas: [`AGENTS.md`](../AGENTS.md) e [`docs/release-lanes.md`](./release-lanes.md).

A Inbox operacional foi retirada do frontend. Este inventário evita remover dependências comerciais compartilhadas.

## Removido

- `src/features/whatsapp/pages/WhatsAppInboxPage.tsx`: página e entrada de rota.
- `src/lib/api/whatsappInboxApi.ts`: cliente exclusivo da página.
- `src/features/whatsapp/components/whatsapp-attachment-card.tsx`: componente exclusivo da página.
- `tests/whatsapp-inbox.spec.js`: smoke da superfície removida.

## Preservado

| Módulo | Consumidores/razão |
| --- | --- |
| `whatsapp-conversations.ts` | `api/_app/routes.ts` (`whatsapp-conversations`), sincronização, identidade local, CRM e legado operacional controlado |
| `whatsapp-conversations-store.ts` | `whatsapp-conversations.ts`, snapshot de leads e transporte; armazenamento e projeção de identidade |
| `whatsapp-conversations-sync.ts` | `whatsapp-conversations.ts`, `whatsapp-leads.ts`, auditoria de identidade e sincronização Evolution |
| `whatsapp-crm-match.ts` | `whatsapp-conversations.ts`, `whatsapp-leads.ts`, `whatsapp-context.ts`; matching CRM e contexto da extensão |
| `whatsapp-identity-*` | resolução e auditoria de identidade |
| `whatsapp-leads.ts` | snapshot local de leads e testes de CRM |
| `whatsapp-flows.ts` | configuração de fluxos usada pelo envio de orçamento |
| `send-whatsapp*.ts` | `api/_app/routes.ts` (`send-whatsapp`, `send-whatsapp-flow`), transporte Evolution, outbox e entrega de orçamento |
| `whatsapp-send-status.ts` | `api/_app/routes.ts` (`whatsapp-send-status`), status e reconciliação de entregas |
| `communication-*` | envio, histórico de envio e mídia compartilhados |

Verificação reproduzível: `rg -n "whatsapp-conversations|whatsapp-conversations-store|whatsapp-conversations-sync|whatsapp-crm-match|send-whatsapp|whatsapp-send-status" api src tests`. Nenhuma tabela, conversa, entrega, cliente, lead, orçamento ou snapshot foi apagado. A extensão em `extensions/whatsapp-context/` é a superfície documentada para contexto comercial no WhatsApp Web.
