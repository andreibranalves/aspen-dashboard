# PostgreSQL de testes

Ambiente local descartável para testes de integração. Usa `postgres:16`, porta `55432` e `tmpfs`; nenhum dado persiste após `db:test:down`.

## Rodar suíte completa

```bash
npm run test:postgres:docker
```

O comando inicia o container, aplica as migrations já versionadas pelos próprios testes, executa `npm run test:postgres` e remove o container/volume ao terminar.

Para manter o banco aberto durante a investigação:

```bash
npm run test:postgres:docker -- --keep
```

URL resultante:

```text
postgresql://aspen_test:aspen_test@127.0.0.1:55432/aspen_test
```

## Operação manual

```bash
npm run db:test:up
TEST_DATABASE_URL=postgresql://aspen_test:aspen_test@127.0.0.1:55432/aspen_test npm run test:postgres
npm run db:test:down
```

Use `TEST_POSTGRES_PORT=55433` para trocar a porta. Este banco não deve receber dados de produção nem ser usado como `DATABASE_URL` da aplicação.
