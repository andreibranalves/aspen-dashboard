---
status: accepted
date: 2026-09-21
---

# Identidade do cliente é decidida no salvamento

Vários orçamentos do mesmo cliente devem reutilizar um único cadastro, mas a consulta feita antes do salvamento pode ficar velha ou falhar. Por isso `POST /api/client-matches` é somente leitura e só antecipa o resultado no card; o vínculo é decidido dentro da transação de `POST /api/orcamento`, depois do lock de escrita e da recuperação por `creation_request_id`. A regra de normalização e classificação vive em `api/_modules/client-matching.ts`.

Sem `client_id` e sem identificador forte válido (documento, e-mail ou telefone), o salvamento só cria cliente com `extracted.confirm_new_client: true`; caso contrário responde `409 CLIENT_SELECTION_REQUIRED`. Conflitos de identidade respondem `409` com `CLIENT_IDENTITY_CONFLICT` ou `CLIENT_ARCHIVED`, e cliente inexistente responde `404 CLIENT_NOT_FOUND`.
