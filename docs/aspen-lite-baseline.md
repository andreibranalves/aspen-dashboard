# Baseline recuperável Aspen Lite

Executar antes de qualquer limpeza ou alteração destrutiva:

1. Checkout limpo: `git status --short` deve não retornar arquivos.
2. Criar backup PostgreSQL fora do checkout:

```bash
CUTOVER_BACKUP_DIR=/caminho/externo/seguro npm run db:backup
```

4. Restaurar o arquivo explicitamente em alvo PostgreSQL separado, usando `RESTORE_DATABASE_URL`, `RESTORE_PG_SERVICE`, `RESTORE_EXPECTED_DATABASE`, `PGSERVICEFILE` e `PGPASSFILE` protegidos:

```bash
CUTOVER_BACKUP_DIR=/caminho/externo/seguro npm run db:backup -- --validate --file /caminho/externo/seguro/backup-...sql
```

A validação existente confirma o destino isolado, executa migrações e confere tabelas/contagens sem imprimir dados de clientes. Falha de backup, restauração ou destino aborta o procedimento. Depois, com checkout limpo, crie a tag apenas após ambos os arquivos existirem:

```bash
npm run lite:baseline -- --tag aspen-lite-baseline-YYYYMMDD \
  --backup /caminho/externo/seguro/backup.sql \
  --restore /caminho/externo/seguro/restore-evidence.txt \
  --evidence /caminho/externo/seguro/baseline.json \
  --push
```

Registre tag, timestamp, arquivo de backup e resultado da restauração em evidência externa com permissão `0600`.

O agente não executa `git push`, backup de produção ou restauração sem configuração operacional explícita.
