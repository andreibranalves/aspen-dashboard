# Procedimento operacional PostgreSQL

O dashboard usa PostgreSQL como fonte de verdade para produtos, clientes, orçamentos, CRM, pedidos e atividade de catálogo.

## Pré-condições

- `npm run build:api` concluído.
- `npm run test:unit` concluído.
- `npm run lint` concluído.
- `npm run type-check` concluído.
- `npm run build` concluído.
- `node scripts/check-no-legacy-provider.mjs` concluído.
- Backup e restore são operações controladas fora deste repositório.

## Readiness

`GET /api/operational-status` verifica somente conectividade PostgreSQL e configurações locais obrigatórias.

A resposta não contém segredos, credenciais, dados de clientes ou informações de serviços externos.

A aplicação fica pronta quando o banco responde e `app_settings` contém validade, pagamento e template padrão válidos.

## Fluxo local

1. Execute as verificações automatizadas em uma cópia local.
2. Confirme que os três mapas de rotas são iguais.
3. Confirme que produtos, clientes, orçamentos, CRM, pedidos, atividade e telas de comunicação usam contratos locais.
4. Valide o envio WhatsApp somente com mocks da Evolution em testes.
5. Registre resultados e riscos no relatório de auditoria apropriado.

Nenhuma etapa deste documento executa deploy, alteração de ambiente, migração ou acesso a serviço remoto.
