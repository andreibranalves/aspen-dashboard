# Design: Limpeza semi-automática do Kanban CRM

Data: 2026-06-26

## Contexto

A coluna **Orcamento Enviado** do Kanban CRM acumula centenas de oportunidades, incluindo orçamentos enviados há meses e sem resposta. Isso dificulta enxergar oportunidades reais e recentes.

O objetivo desta primeira versão é limpar o Kanban sem apagar histórico e sem mover oportunidades ativas por engano.

## Decisão de produto

Adicionar uma limpeza semi-automática no Kanban para mover oportunidades frias de **Orcamento Enviado** para **Perdido**, sempre com revisão e confirmação do usuário.

Nada roda automaticamente em background. Nada deleta Lead, Quotation ou CRM Deal.

## Experiência no Kanban

Na página **CRM — Kanban**, acima do quadro, mostrar um banner apenas quando existirem candidatos à limpeza:

> Limpeza de pipeline disponível  
> Existem {count} orçamentos enviados há 30 dias ou mais sem pedido fechado e sem atualização nos últimos 7 dias.  
> Revisar e marcar como Perdido

Ao clicar em **Revisar e marcar como Perdido**, abrir uma revisão com lista de candidatos contendo:

- nome do lead;
- número do orçamento;
- idade do orçamento;
- última modificação do deal;
- valor do orçamento, se disponível;
- checkbox para incluir/remover da limpeza.

A ação final é **Marcar selecionados como Perdido**.

Após confirmação:

- deals selecionados mudam para **Perdido**;
- Kanban recarrega;
- banner atualiza ou desaparece;
- usuário vê resumo da operação.

Exemplo de resumo:

> 83 oportunidades marcadas como Perdido. 4 foram ignoradas porque mudaram recentemente.

## Regra de candidato

Um deal é candidato somente se cumprir todos os critérios:

1. `CRM Deal.status` é exatamente **Orcamento Enviado**.
2. Deal tem orçamento vinculado em `custom_quotation`.
3. Orçamento vinculado tem **30 dias ou mais**.
4. Orçamento não tem Sales Order vinculado.
5. Deal não foi modificado nos últimos **7 dias**.

A idade deve usar a data do orçamento, preferencialmente `Quotation.transaction_date`.

A proteção de 7 dias deve usar `CRM Deal.modified`.

## Registro da ação

Para manter a primeira versão simples:

- atualizar `CRM Deal.status` para **Perdido**;
- preencher/atualizar `next_step` com mensagem curta se o campo aceitar escrita no endpoint existente:
  - `Marcado como perdido por limpeza de pipeline: sem resposta após 30 dias.`

Se `next_step` não aceitar escrita no ERP, a primeira versão deve apenas atualizar o status. Não criar campo novo no ERP nesta versão.

## Backend

Adicionar endpoint de candidatos:

### `GET /api/crm-prune-candidates`

Retorna candidatos calculados no backend.

Resposta esperada:

```json
{
  "candidates": [
    {
      "deal_id": "CRM-DEAL-0001",
      "lead_name": "Cliente X",
      "quotation": "SAL-QTN-2026-0001",
      "quotation_date": "2026-05-10",
      "age_days": 47,
      "deal_modified": "2026-06-01",
      "grand_total": 1250
    }
  ],
  "meta": {
    "threshold_days": 30,
    "protect_recent_days": 7,
    "count": 1
  }
}
```

### `POST /api/crm-prune-candidates`

Recebe deals selecionados e tenta movê-los para **Perdido**.

Payload:

```json
{
  "deal_ids": ["CRM-DEAL-0001", "CRM-DEAL-0002"]
}
```

O backend deve revalidar a regra completa antes de atualizar cada deal. Se um deal não passar mais na regra, ele deve ser ignorado, não atualizado.

Resposta esperada:

```json
{
  "success": true,
  "updated": 83,
  "skipped": 4,
  "skipped_deals": [
    {
      "deal_id": "CRM-DEAL-0009",
      "reason": "Deal modificado recentemente"
    }
  ]
}
```

## Frontend

Na `src/pages/CrmKanbanPage.tsx`:

- buscar candidatos em paralelo ou logo após carregar o Kanban;
- mostrar banner quando `meta.count > 0`;
- abrir modal/lista de revisão;
- permitir selecionar/desselecionar candidatos;
- confirmar antes de enviar;
- chamar `POST /api/crm-prune-candidates`;
- recarregar Kanban e candidatos após sucesso;
- mostrar resumo de atualizados/ignorados.

A UI deve ser simples e seguir os componentes existentes (`Button`, `Input`/checkbox equivalente, estilos Tailwind do projeto).

## Segurança e consistência

- O frontend nunca decide sozinho quem pode ser movido.
- O backend revalida cada deal no momento do POST.
- Deals sem orçamento vinculado não entram.
- Deals com pedido fechado vinculado não entram.
- Deals modificados nos últimos 7 dias não entram.
- Nenhum registro é deletado.

## Fora de escopo nesta versão

- automação diária;
- deleção de leads/orçamentos;
- criação de status novo como Arquivado ou Inativo;
- configuração dinâmica de 30/7 dias;
- disparo automático de WhatsApp antes de mover;
- campos novos no ERPNext/Frappe CRM.

## Critérios de sucesso

- O Kanban mostra aviso quando há oportunidades frias.
- O usuário consegue revisar os candidatos antes de mover.
- A confirmação move apenas os selecionados válidos para **Perdido**.
- O Kanban fica mais limpo sem perda de histórico.
- Mudanças recentes são protegidas.
- O resultado da operação informa quantos foram atualizados e ignorados.
