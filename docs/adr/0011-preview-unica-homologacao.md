---
status: accepted
date: 2026-09-13
---

# Preview isolado é a única homologação

Em 18/08/2026 (`a34f5e4`) o Vercel Preview começou a substituir o staging da VPS; desde 27/08/2026 (#146) cada PR tem sua branch PostgreSQL no Neon, e em 13/09/2026 (#276) o Preview, com escritas externas desligadas, virou a única homologação. Production é o `master`. Um ambiente permanente a mais exigiria banco, integrações e segredos próprios, enquanto o Preview por PR já ensaia cada mudança isolada. O nome `staging` que resta nas envs de migration identifica só o alvo técnico não-produtivo. Detalhes em `docs/preview-isolation.md`.

Emendado pelo [ADR 0013](0013-worker-whatsapp-no-vps.md): o worker do WhatsApp no VPS não tem Preview; é validado no CI contra PostgreSQL descartável e roda de verdade só em produção.
