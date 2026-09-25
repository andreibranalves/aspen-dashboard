---
status: accepted
date: 2026-05-19
---

# Uma única Function na Vercel

Cada arquivo sob `api/` vira uma Function na Vercel, e o plano Hobby limita quantas cabem num deployment. Em 19/05/2026 (`b54f5c3`) os 19 handlers avulsos foram trocados por `api/[...path].ts`, que despacha pelo registro em `api/_app/routes.ts`. O código de apoio fica em diretórios iniciados por `_`, invisíveis para a descoberta de Functions; `check:vercel-functions` impede uma segunda Function.

Emendado pelo [ADR 0013](0013-worker-whatsapp-no-vps.md): a Vercel continua com uma Function só, mas o trabalho assíncrono do WhatsApp roda num worker no VPS.
