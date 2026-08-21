# Limpeza beta

Ferramenta operacional restrita. Não é exclusão pela UI nem purge genérico.

## Entrada

Arquivo revisável com tipos e UUIDs estáveis:

```json
{
  "candidates": [
    { "type": "quotation", "id": "00000000-0000-4000-8000-000000000001" },
    { "type": "client", "id": "00000000-0000-4000-8000-000000000002" }
  ]
}
```

Busca por nome/telefone não autoriza exclusão.

## Execução

```bash
npm run beta:cleanup -- --ids /caminho/externo/candidatos.json
npm run beta:cleanup -- --ids /caminho/externo/candidatos.json --apply
```

O padrão é **dry-run**. A saída contém somente modo, contagens, UUIDs técnicos, bloqueios e clientes compartilhados; nunca payloads, credenciais ou SQL.

`--apply` revalida o grafo dentro de uma única transaction. Pedido real ligado ao orçamento bloqueia a remoção; cliente compartilhado é preservado; dependências exclusivas são removidas na ordem segura. Falha faz rollback integral. Em `APP_ENV=production`, `LITE_BASELINE_TAG=...`, `LITE_BASELINE_BACKUP_FILE=/caminho/externo/backup.sql` (arquivo 0600) e `LITE_BASELINE_RESTORE_CONFIRMED=1` são obrigatórios, após conclusão do baseline #41.
