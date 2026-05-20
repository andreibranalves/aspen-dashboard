# Plano 02 — Lead/Cliente Drawer

> **Origem:** derivado de `plans/prd-erpnext-app-operational-gap-roadmap.md`.
>
> **Dependência:** `plans/plano-01-base-ux-operacional.md`.
>
> **Para Hermes:** implementar somente após a base de UX estar disponível. Não converter Lead em Customer nesta fase. Não editar campos financeiros/fiscais avançados.

## Objetivo

Permitir que Andrei/equipe Aspen clique em um Lead ou Cliente na lista e veja um detalhe operacional enxuto sem abrir o ERPNext.

O foco é responder rapidamente:

- de onde veio o contato;
- quais dados estão faltando;
- se já existe orçamento/deal vinculado;
- como contatar a pessoa;
- quais dados básicos podem ser corrigidos com segurança.

## Resultado esperado

A página `LeadsPage.jsx` passa a ter um drawer lateral com contexto de Lead/Cliente, ações rápidas e edição segura de campos básicos.

## Escopo

### Inclui

1. Novo endpoint dedicado para detalhe de Lead/Customer, preferencialmente `client-detail.js`.
2. Busca sob demanda ao clicar em uma linha/card, sem pesar a listagem.
3. Drawer na `LeadsPage.jsx`.
4. Exibição de dados mínimos:
   - ID ERPNext;
   - tipo: Lead ou Cliente;
   - nome;
   - email;
   - telefone/mobile;
   - CNPJ, se Customer;
   - origem/fonte;
   - criação/modificação;
   - último orçamento vinculado, se encontrado;
   - deal vinculado/status, se encontrado;
   - endereço resumido, se encontrado.
5. Badges de qualidade:
   - sem telefone;
   - sem email;
   - sem origem;
   - sem CNPJ;
   - endereço incompleto.
6. Ações rápidas:
   - WhatsApp;
   - email;
   - criar orçamento para contato;
   - abrir orçamento recente;
   - abrir deal vinculado;
   - abrir no ERPNext.
7. Edição segura:
   - nome;
   - email;
   - telefone;
   - origem;
   - CNPJ;
   - endereço básico, se o backend tiver caminho seguro.

### Não inclui

- Conversão completa Lead → Customer.
- Owner/responsável.
- Território.
- Campos financeiros.
- Atividades/anexos/timeline completa.
- Automação de follow-up.
- Notas rápidas, salvo se houver destino já seguro e aprovado.

## Arquivos prováveis

- Criar: `api/_functions/client-detail.js`
- Modificar: `api/[...path].js`, somente se o roteamento atual não descobrir automaticamente o novo handler.
- Modificar: `src/pages/LeadsPage.jsx`
- Usar: `src/components/DetailDrawer.jsx`
- Usar: `src/components/QualityBadges.jsx`
- Usar: `src/components/ContextActions.jsx`
- Usar: `src/lib/erpLinks.js`
- Usar: `src/lib/api.js`
- Usar: `src/lib/clientMetadata.js`, se aplicável no frontend.
- Usar: `api/_functions/lib/erpnext.js`
- Usar: `api/_functions/lib/client-metadata.js`, se aplicável no backend.

## API proposta

### `GET /api/client-detail?doctype=Lead&name=CRM-LEAD-...`

ou:

### `GET /api/client-detail?doctype=Customer&name=CUST-...`

**Resposta sugerida:**

```json
{
  "success": true,
  "doctype": "Lead",
  "name": "CRM-LEAD-0001",
  "display_name": "Cliente Exemplo",
  "email": "cliente@email.com",
  "telefone": "11999999999",
  "origem": "Instagram",
  "cnpj": null,
  "creation": "2026-05-20 10:00:00",
  "modified": "2026-05-20 10:30:00",
  "erp_url": "https://.../app/lead/CRM-LEAD-0001",
  "address": {
    "summary": "Rua X, 123 — São Paulo/SP",
    "complete": true
  },
  "latest_quotation": {
    "name": "ORC-20261143",
    "status": "Open",
    "grand_total": 1234.56
  },
  "deal": {
    "name": "CRM-DEAL-0001",
    "status": "Orcamento Enviado",
    "custom_follow_up_stage": 0
  },
  "quality_flags": ["sem_cnpj"]
}
```

### `PUT /api/client-detail?doctype=Lead&name=CRM-LEAD-...`

Payload permitido:

```json
{
  "nome": "Cliente Exemplo",
  "email": "cliente@email.com",
  "telefone": "11999999999",
  "origem": "Instagram",
  "cnpj": "55458072000179",
  "endereco": {
    "cep": "00000000",
    "logradouro": "Rua X",
    "numero": "123",
    "bairro": "Centro",
    "cidade": "São Paulo",
    "uf": "SP"
  }
}
```

**Regras de segurança:**

- Validar `doctype` contra allowlist: `Lead`, `Customer`.
- Nunca aceitar doctype arbitrário.
- Atualizar apenas campos permitidos.
- Não expor erro bruto do ERPNext ao frontend.
- Se CNPJ existente divergir, retornar conflito claro e não sobrescrever.
- Origem deve ser validada contra origem conhecida/ERPNext quando aplicável.

## Tarefas de implementação

### Tarefa 1 — Auditar estado atual de `LeadsPage.jsx` e `leads-clients.js`

**Objetivo:** entender shape atual da lista antes de criar detalhe.

**Comandos/leituras:**

```bash
# usar ferramentas de leitura, não cat
```

Arquivos a ler:

- `src/pages/LeadsPage.jsx`
- `api/_functions/leads-clients.js`
- `api/_functions/lib/erpnext.js`
- `api/_functions/lib/client-metadata.js`

**Verificar:**

- nome dos campos retornados hoje;
- como a lista diferencia Lead vs Cliente;
- se já existe `origem` na lista;
- se `api/[...path].js` faz dispatch automático para novo arquivo.

### Tarefa 2 — Criar endpoint `client-detail.js` com GET

**Objetivo:** retornar detalhe enxuto de Lead/Customer.

**Requisitos:**

- Handler ESM seguindo padrão do projeto.
- Aceitar apenas `GET` inicialmente.
- Validar query params.
- Buscar documento principal via `erpGetDoc` ou `erpGetList` conforme helper atual.
- Buscar contato/endereço via `Contact`, `Address`, `Dynamic Link` se necessário e se simples.
- Buscar último orçamento por party/email quando seguro.
- Buscar Deal por email ou vínculo com quotation quando seguro.
- Retornar `quality_flags` calculadas no backend ou dados suficientes para o frontend calcular.

**Validação:**

```bash
node --check api/_functions/client-detail.js
npm run build
```

### Tarefa 3 — Adicionar PUT seguro ao endpoint

**Objetivo:** permitir correção de dados básicos.

**Campos permitidos:**

- Lead:
  - `lead_name`/`first_name` conforme padrão atual;
  - `email_id`;
  - `mobile_no`/`phone`;
  - `source` ou `utm_source`, conforme campo existente.
- Customer:
  - `customer_name`;
  - `tax_id` se vazio ou igual ao CNPJ normalizado;
  - contato/endereço apenas se caminho já for seguro.

**Não fazer:**

- Não converter Lead em Customer.
- Não criar múltiplos endereços duplicados sem critério.
- Não sobrescrever CNPJ divergente.

### Tarefa 4 — Integrar drawer em `LeadsPage.jsx`

**Objetivo:** clicar na linha/card abre detalhe sob demanda.

**Requisitos:**

- Estado local:
  - `selectedClient`
  - `clientDetail`
  - `clientLoading`
  - `clientError`
  - `clientSaving`
- Usar `apiGet`/`apiPut`.
- Manter listagem rápida: não carregar detalhes de todos os leads.
- Ao salvar, atualizar drawer e refletir campos básicos na lista, se simples.
- Mostrar erro amigável.

### Tarefa 5 — Adicionar ações contextuais

**Objetivo:** o drawer deve permitir agir sem abrir ERP para tudo.

**Ações:**

- WhatsApp, se houver telefone.
- Email, se houver email.
- Abrir orçamento recente, se houver.
- Abrir deal vinculado, se houver rota local ou link ERPNext.
- Abrir no ERPNext.
- Criar orçamento para este contato, se já existir fluxo/rota seguro; se não, deixar como link futuro fora do escopo.

### Tarefa 6 — Validar UX e regressões

**Comandos:**

```bash
npm run build
```

Se ambiente local estiver disponível:

```bash
npm run dev
# ou dual-server conforme referências locais
BASE_URL=http://localhost:5173 node scripts/playwright-test-responsive.mjs
```

**Validação manual mínima:**

- Abrir página Leads.
- Clicar em Lead.
- Drawer carrega.
- Fechar drawer.
- Clicar em Customer.
- Editar telefone/email/origem.
- Confirmar que lista não ficou lenta.
- Testar mobile 375px.

## Critérios de aceite

- Clicar em Lead/Cliente abre drawer em poucos segundos.
- Drawer mostra dados principais sem abrir ERPNext.
- Usuário consegue corrigir telefone/email/origem quando permitido.
- Botão `Abrir no ERPNext` funciona.
- Lista não carrega detalhe em massa.
- Campos avançados continuam fora do app.
- Build passa.
- Nenhum dado sensível é editável.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Endpoint ficar pesado | Buscar detalhes somente sob demanda e limitar históricos. |
| Link Lead/Customer → orçamento/deal incerto | Retornar `null` quando não houver match confiável. |
| CNPJ sobrescrito errado | Normalizar e bloquear divergência com 409. |
| Duplicar endereço | Nesta fase, preferir leitura; escrita de endereço só se caminho estiver claro. |
| UI virar formulário completo | Mostrar poucos campos e linkar ERPNext para avançado. |

## Ordem recomendada de commits

1. Endpoint GET:

```bash
git add api/_functions/client-detail.js api/[...path].js
git commit -m "feat: add client detail endpoint"
```

2. Drawer frontend leitura:

```bash
git add src/pages/LeadsPage.jsx
git commit -m "feat: add lead client detail drawer"
```

3. Edição segura:

```bash
git add api/_functions/client-detail.js src/pages/LeadsPage.jsx
git commit -m "feat: allow safe client contact edits"
```
