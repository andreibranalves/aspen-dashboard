# Procedimento de Corte Operacional (Go-Live)

## Pré-requisitos

1. Migração concluída (tabela `frappe_import_lineage` populada)
2. PDFs arquivados no Vercel Blob (mínimo 1 documento emitido)
3. Backup validado (último backup < 24h)
4. Capacidade verde (DB < 80% limite, conexões < 80%)
5. Configurações obrigatórias preenchidas (validade, pagamento, template)

## Passo a Passo

### 1. Validar pré-requisitos

```bash
node scripts/backup-crm.mjs --validate
node scripts/backup-crm.mjs --preflight
curl -s https://aspen-orcamento.vercel.app/api/operational-status | jq .ready
```

### 2. Backup final pré-corte

```bash
node scripts/backup-crm.mjs
# Salve o backup gerado em backups/backup-YYYY-MM-DDTHH:mm:ss.sql em local seguro
```

### 3. Travar escrita no Frappe (lock de aplicação)

```bash
# Via painel Frappe: bloquear permissões de escrita para o usuário da API
# Alternativa: rotacionar ERPNEXT_TOKEN para invalidar o token atual
```

### 4. Sincronização final

```bash
node scripts/migrate-frappe-crm.mjs --apply --mode final-sync
```

### 5. Validar consistência

```bash
# Comparar contagem: PostgreSQL vs Frappe
curl -s https://aspen-orcamento.vercel.app/api/operational-status | jq .details

# Amostragem: 10 registros de cada entidade, comparar campos chave
node scripts/validate-migration-sample.mjs --sample-size 10
```

### 6. Ativar modo operacional

```bash
# No Vercel Dashboard -> Settings -> Environment Variables:
# CRM_OPERATIONAL_MODE = true
# Re-deploy
```

### 7. Verificação pós-ativação

```bash
# Confirmar que a API responde em modo core
curl -s https://aspen-orcamento.vercel.app/api/products?limit=1 | jq .source
# Deve retornar: "postgres"

# Navegar pelas páginas principais
# - Novo orçamento manual
# - Lista de clientes
# - Catálogo de produtos
# - Lista de orçamentos
```

## Rollback

```bash
# Vercel Dashboard -> CRM_OPERATIONAL_MODE = false -> Re-deploy
# Reativar token Frappe original
```

## Checklist de Verificação

- [ ] /api/products -> source: "postgres"
- [ ] /api/leads-clients -> source: "postgres"
- [ ] /api/quotations -> source: "postgres"
- [ ] /api/orcamento -> POST cria rascunho
- [ ] /api/pricing-lookup -> source: "postgres"
- [ ] /api/sales-orders -> 503
- [ ] /api/crm-deals -> 503
- [ ] /api/send-whatsapp -> 503
- [ ] Sidebar mostra apenas: Novo Orcamento, Orcamentos, Produtos, Clientes, Configuracoes
- [ ] Sidebar esconde: Auto, Pre-orcamentos, WhatsApp, Dashboard, Pedidos, CRM, Comunicacao
- [ ] #/auto redireciona para #/manual
- [ ] Configuracoes mostra secao de "Modo Operacional"
