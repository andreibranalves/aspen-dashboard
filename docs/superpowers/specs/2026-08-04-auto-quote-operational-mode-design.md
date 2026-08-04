# Auto Quote no Modo Operacional

**Data:** 2026-08-04

## Problema

A tela `/auto` (AutoQuotePage) não está acessível no modo operacional por dois motivos:

1. `OPERATIONAL_NAV_SECTIONS` no Sidebar não inclui link para `/auto`
2. Handler `POST /api/extract` retorna 503 em modo operacional

## Solução

### 1. Remover bloqueio do /api/extract

- **Arquivo:** `api/_functions/extract.ts` linha ~297
- **Ação:** Remover guard `if (isOperationalMode()) return 503...`
- **Risco:** Nenhum. O endpoint já valida `OPENROUTER_API_KEY` independentemente.

### 2. Adicionar /auto no sidebar operacional

- **Arquivo:** `src/components/layout/Sidebar.tsx` ~linha 75
- **Ação:** Adicionar `{ hash: '/auto', label: 'Auto', icon: Sparkles }` em `OPERATIONAL_NAV_SECTIONS`

### Pré-requisito

- `OPENROUTER_API_KEY` já configurada no `.env` ✓

## Impacto

- Nenhuma quebra de API existente
- Nenhuma mudança de schema
- Testes existentes continuam passando (nenhum testa o guard do extract)
