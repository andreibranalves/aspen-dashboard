---
status: accepted
date: 2026-08-13
---

# PostgreSQL é a única fonte de verdade

O app nasceu sobre Frappe/ERPNext e passou por uma migração gradual com flags por domínio, fallbacks e reconciliação entre as duas bases. Em 13/08/2026 (`de0d4f6`) o runtime Frappe saiu: produtos, clientes, orçamentos, CRM, pedidos e atividades vivem só no PostgreSQL, sem importar o histórico de CRM, pedidos, atividades e leads. As tabelas `frappe_*` que restaram são artefato de auditoria e as migrations antigas mantêm seus nomes. Não se reintroduz segunda fonte, dual-read, dual-write nem fallback de persistência.
