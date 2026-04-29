# Work Plan: Fix Lead Display Name (`fix-lead-display-name`)

## Objective
Ensure the clean name (e.g., "Andrei") is displayed in the Quotation PDF when the entity is a `Lead` (whose ID is `CRM-LEAD-YYYY-XXXXX`).

## Architecture & Data Flow
Quando o alvo é um `Lead`, o ERPNext não preenche o campo `customer_name` da Quotation. Portanto, o `view.js` tenta buscar `customer_name` e recebe vazio, falhando em fazer a substituição do ID pelo nome limpo.
A solução é fazer o `view.js` buscar também o campo `quotation_to`. Se for 'Lead', ele deve fazer uma chamada rápida à API para pegar o `first_name` do Lead e usar isso na substituição do HTML.

## Execution Tasks

### Task 1: Update Fetch Logic in `view.js`
- [x] Mudar a query da Quotation para buscar os campos: `["customer_name", "party_name", "quotation_to"]`.

### Task 2: Resolve Clean Name for Leads
- [x] Adicionar lógica: se `quotation_to === 'Lead'`, fazer um `fetch` na rota `/api/resource/Lead/${party_name}` para buscar os campos `["first_name", "lead_name"]`.
- [x] Definir a variável `cleanName` como o `first_name` (ou `lead_name`) do Lead. Caso contrário (se for Customer), usar o `customer_name`.

### Task 3: Apply HTML Regex Replacement
- [x] Garantir que o regex substitua o `party_name` (ex: `CRM-LEAD-...`) pelo `cleanName` resolvido na Task 2, se eles forem diferentes.

## Final Verification Wave (QA Agents)
- [x] Executar o `test_local.mjs` com um novo Lead e capturar o ID da Quotation.
- [x] Fazer uma requisição simulada via `curl` ou `fetch` para `http://localhost:8888/api/view?q=<ID>` e fazer um `grep` para garantir que o texto `Nome: CRM-LEAD` desapareceu e foi substituído pelo nome correto.
