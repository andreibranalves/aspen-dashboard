# Preview isolado

Preview usa uma URL `DATABASE_URL` distinta de `PRODUCTION_DATABASE_URL` e não envia efeitos externos.

## Preflight obrigatório

```bash
APP_ENV=preview EXTERNAL_WRITES_ENABLED=0 npm run preview:preflight
```

O gerenciador de segredos injeta as URLs; não coloque valores no checkout. O preflight falha fechado quando qualquer valor está ausente, inválido ou aponta para a mesma identidade PostgreSQL.

Evolution e Resend são bloqueados no Preview. Persistência PostgreSQL pode ser exercitada somente no banco isolado. Não há dual-write, banco fallback ou coluna `is_test`.

O provisionamento e a remoção das branches PostgreSQL de Preview seguem a política de [ciclo de vida das branches de Preview](./release-lanes.md#ciclo-de-vida-das-branches-de-preview).
