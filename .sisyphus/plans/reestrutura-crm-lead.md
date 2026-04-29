# Work Plan: CRM Lead Refactoring (`orcamento.js`)

## Objective
Refactor `orcamento.js` to implement a **Lead-First, Customer-Aware** flow. 
Stop polluting the Customer base with unverified prospects, fix the "Lucas - 1" deduplication bug, while safely preserving the history of *existing* Customers.

## Architecture & Data Flow (The Waterfall)
Para garantir que não vamos fragmentar o histórico de clientes que já compraram no passado, o fluxo não pode ser "Cego para Leads". Ele precisa ser inteligente:

1. **Waterfall Lookup (Deduplicação Estrita por Email):**
   - **Passo 1:** Busca `Contact` pelo email exato (`email_id = email`).
   - **Passo 2:** Se achar e tiver um `Customer` linkado -> O usuário já é cliente. Usa o fluxo antigo (Orçamento para o Customer).
   - **Passo 3:** Se NÃO achar Customer, busca `Lead` pelo email exato.
   - **Passo 4:** Se NÃO achar Lead, cria um novo `Lead`.
   - *Fim das buscas por `LIKE "Nome%"`.*

2. **Quotation Creation (Ajuste de Payload):**
   - Se for Customer: `quotation_to: "Customer"`, `party_name: customerId`.
   - Se for Lead: `quotation_to: "Lead"`, `party_name: leadId`.

3. **Manutenção do Contrato de Frontend (`index.html`):**
   - Para não quebrar as bolinhas verdes/vermelhas de "Cliente Novo/Antigo" na interface, o `orcamento.js` continuará retornando as chaves `customer_id` (que conterá o ID do Lead ou Customer) e `customer_new` (true se o Lead acabou de ser criado, false caso contrário).

## Execution Tasks

### Task 1: Refatorar Lógica de Lookup (orcamento.js)
- [x] Apagar a busca aproximada de Customer por nome (`customer_name like "%..."`).
- [x] Implementar a busca sequencial: Contact(Customer) -> Lead -> Criar Lead.

### Task 2: Adaptar Payloads de Quotation e CRM Deal
- [x] Tornar dinâmicos os campos `quotation_to` e `party_name` no payload da Quotation.
- [x] Garantir que o CRM Deal aceite a ligação correta (seja via Lead ou Customer).

### Task 3: Contrato de Retorno
- [x] Mapear a saída do `orcamento.js` para garantir que `customer_new` e `customer_id` sejam preenchidos corretamente para manter o `public/index.html` intacto.

## Final Verification Wave (QA Agents)
- [x] Cenário 1 (Novo Lead): Rodar `node test_local.mjs` com email inédito. Garantir que cria Lead e Quotation(Lead).
- [x] Cenário 2 (Deduplicação): Rodar de novo com o mesmo email. Garantir que não cria nada novo, reaproveita o Lead.
- [x] Cenário 3 (Cliente Existente): Rodar com email de um Customer que já comprou. Garantir que gera Quotation(Customer) e não cria Lead.
