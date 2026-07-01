# Design — WhatsApp Inbox CRM Match no Painel Comercial

## Resumo

Adicionar, na página `#/whatsapp-inbox`, um bloco no painel da direita que identifica se a conversa corresponde a um cadastro real em `#/leads` e exibe um resumo do registro encontrado.

O sistema deve tentar encontrar o melhor match para a conversa e salvar esse vínculo diretamente na conversa do WhatsApp, separado do vínculo de pré-orçamento já existente. Quando houver match confiável, o painel exibe nome, telefone, email, tipo do cadastro (`lead` ou `cliente`) e um botão pequeno para abrir a página do registro em `#/leads`.

## Objetivo

Melhorar o contexto comercial da inbox do WhatsApp, permitindo que o usuário veja rapidamente se o contato já está cadastrado e navegue direto para a página dele em `/leads`.

## Escopo

### Incluído

- Resolver match entre conversa do WhatsApp e cadastro real de `Lead`/`Customer`.
- Salvar o vínculo CRM na conversa para reuso posterior.
- Exibir no painel direito um card de "Cadastro encontrado".
- Adicionar botão para abrir o detalhe do cadastro em `#/leads/lead/:id` ou `#/leads/cliente/:id`.
- Tratar estados de carregamento, vazio, vínculo inválido e erro leve.

### Excluído

- Edição manual do vínculo pelo usuário.
- Tela para escolher entre múltiplos candidatos.
- Vincular automaticamente por nome fraco ou ambíguo.
- Alterações no fluxo de pré-orçamento existente.

## Decisões aprovadas

- O match deve procurar **apenas registros reais da página `/leads`** (Lead/Cliente no ERP).
- Em caso de empate, o sistema deve mostrar **apenas o melhor match**.
- A regra principal é **telefone primeiro**, depois email, com nome apenas como fallback controlado.
- O vínculo deve ser **definitivo e salvo na conversa**, não apenas resolvido em tempo real.

## Estado atual

Hoje `src/pages/WhatsAppInboxPage.tsx` mostra no painel comercial apenas dados da conversa (`telefone`, `status`, `updatedAt`, `linkedQuotationId`) e ações como extração e criação de pré-orçamento.

O modelo de conversa já possui `linkedLeadId`, mas esse campo hoje é usado pelo fluxo de pré-orçamento (`quote lead`) criado a partir do WhatsApp. Portanto, ele não deve ser reutilizado para apontar para o cadastro real do CRM/ERP, para evitar sobrecarga semântica e bugs de navegação.

## Proposta de arquitetura

### 1. Vínculo CRM separado na conversa

Adicionar novos campos persistidos na conversa do WhatsApp, distintos dos vínculos já existentes:

- `linkedCrmEntityId: string | null`
- `linkedCrmEntityType: 'lead' | 'cliente' | null`
- `linkedCrmMatchSource: 'phone' | 'email' | 'name' | null`

Esses campos representam o cadastro real encontrado na base de Leads/Clientes.

### 2. Resolução de match no backend

Ao carregar uma conversa para exibição no inbox, o backend deve:

1. verificar se já existe vínculo CRM salvo;
2. se existir, validar se o registro ainda existe;
3. se o vínculo for válido, retornar os dados atuais do cadastro;
4. se o vínculo não existir ou estiver inválido, tentar resolver um novo match;
5. se encontrar um match confiável, salvar o vínculo na conversa;
6. retornar ao frontend os dados resumidos do cadastro encontrado.

### 3. Exposição ao frontend

A API usada pelo inbox deve passar a devolver, junto da conversa selecionada ou do payload complementar, um bloco com dados do match CRM, por exemplo:

```ts
crmMatch?: {
  id: string;
  tipo: 'lead' | 'cliente';
  nome: string;
  telefone: string | null;
  email: string | null;
  matchSource: 'phone' | 'email' | 'name';
}
```

A implementação pode usar um endpoint novo específico ou estender o endpoint atual de conversa. A preferência é **estender o fluxo atual do WhatsApp** para evitar duplicação de conceitos e manter o lookup próximo da entidade `conversation`.

## Estratégia de matching

### Ordem de tentativa

1. **Telefone exato**
2. **Email exato**
3. **Nome** como fallback restrito

### Regras de confiança

#### Telefone

- Normalizar telefone para comparação por dígitos.
- Match por telefone exato pode ser salvo automaticamente.
- Se houver mais de um registro com o mesmo telefone, usar critério determinístico de desempate (ex.: mais recente) apenas se a ambiguidade for mínima; caso contrário, não vincular.

#### Email

- Match por email exato pode ser salvo automaticamente.
- Se houver mais de um registro com o mesmo email, aplicar a mesma política de ambiguidade do telefone.

#### Nome

- Nome só pode ser usado como fallback quando telefone e email não resolverem.
- Nome não deve gerar auto-vínculo quando for vazio, genérico, curto demais, ou ambíguo.
- Na prática, o nome deve funcionar como um fallback muito conservador. Se houver qualquer dúvida, não vincular.

### Melhor match

Como a decisão aprovada foi "mostrar o melhor match", o sistema deve retornar **um único candidato**. Se não houver confiança suficiente para escolher um único registro, o resultado deve ser "nenhum lead encontrado".

## Fluxo detalhado

### Carregamento da conversa

1. Usuário seleciona uma conversa em `#/whatsapp-inbox`.
2. Frontend carrega mensagens como hoje.
3. Frontend também solicita os dados comerciais enriquecidos da conversa.
4. Backend verifica ou resolve o vínculo CRM.
5. Frontend renderiza o bloco de cadastro encontrado.

### Conversa com vínculo salvo

1. Ler `linkedCrmEntityId` e `linkedCrmEntityType`.
2. Buscar o registro correspondente.
3. Se existir, retornar resumo atualizado.
4. Se não existir mais, limpar vínculo e seguir para nova tentativa de match.

### Conversa sem vínculo salvo

1. Tentar match por telefone.
2. Se falhar, tentar email.
3. Se falhar, avaliar nome com regra estrita.
4. Se houver match confiável, salvar vínculo na conversa.
5. Retornar resultado ao frontend.

## UI proposta

### Local

No `aside` do **Painel comercial** da `src/pages/WhatsAppInboxPage.tsx`, abaixo do bloco atual de resumo da conversa.

### Bloco novo

Título sugerido: **Cadastro encontrado**

Conteúdo:

- nome
- tipo (`Lead` ou `Cliente`)
- telefone
- email
- badge discreta com origem do match (`Telefone` ou `Email`; `Nome` só se realmente usado)
- botão pequeno **Abrir lead**

### Navegação

O botão deve usar a navegação já existente do app:

- `#/leads/lead/:id` quando `tipo === 'lead'`
- `#/leads/cliente/:id` quando `tipo === 'cliente'`

### Estados visuais

- **Carregando:** `Procurando cadastro…`
- **Encontrado:** exibe card e botão
- **Não encontrado:** `Nenhum lead encontrado`
- **Erro leve:** `Não foi possível consultar o cadastro agora`
- **Vínculo inválido:** não expor tecnicamente ao usuário; limpar vínculo, tentar novamente e cair em encontrado/vazio/erro

## Componentes e responsabilidades

### Backend

#### `api/_functions/lib/whatsapp-conversations-store.ts`

- Expandir o tipo `WhatsappConversation` para persistir os novos campos CRM.
- Ajustar normalização, leitura e atualização para preservar esses campos.

#### `api/_functions/whatsapp-conversations.ts`

- Estender a resposta da conversa ou criar ação complementar para resolver/retornar o `crmMatch`.
- Implementar validação de vínculo salvo.
- Implementar resolução e persistência do melhor match.

#### Integração com Leads/Clientes

- Reaproveitar acesso ao ERP já existente nas funções de `leads-clients` e `client-detail`.
- Buscar por `Lead` e `Customer` com os campos mínimos necessários para comparação e resumo.
- Evitar trazer payloads grandes ou detalhes completos desnecessários.

### Frontend

#### `src/lib/whatsappInboxApi.ts`

- Adicionar tipos para o payload de match CRM.
- Adicionar chamada para carregar os dados comerciais enriquecidos, se necessário.

#### `src/pages/WhatsAppInboxPage.tsx`

- Adicionar estado para o match CRM do item selecionado.
- Solicitar o match ao trocar a conversa selecionada.
- Renderizar o bloco `Cadastro encontrado` com navegação para `#/leads/...`.

## Dados retornados ao frontend

O frontend precisa apenas de um resumo. Não deve depender do payload completo de `client-detail`.

Payload mínimo recomendado:

```ts
interface WhatsappCrmMatch {
  id: string;
  tipo: 'lead' | 'cliente';
  nome: string;
  telefone: string | null;
  email: string | null;
  matchSource: 'phone' | 'email' | 'name';
}
```

## Tratamento de erros

- Falha no lookup CRM não deve quebrar a tela de inbox.
- O erro deve ficar isolado ao bloco de cadastro encontrado.
- Logs devem continuar estruturados no backend.
- Não expor mensagens cruas do ERP para o usuário final.
- Se a validação do vínculo salvo falhar por registro removido/inexistente, o vínculo deve ser limpo silenciosamente e reprocessado.

## Compatibilidade e migração

- Conversas já existentes continuarão válidas sem os novos campos.
- Os novos campos devem ser opcionais e assumir `null` por padrão.
- O fluxo atual de `linkedLeadId` (pré-orçamento) permanece intacto.

## Testes

### Backend

- resolve `Lead` por telefone exato;
- resolve `Lead`/`Customer` por email exato;
- não vincula quando não há resultado;
- não vincula quando o resultado por nome é fraco/ambíguo;
- retorna vínculo salvo válido sem refazer match desnecessariamente;
- limpa vínculo salvo inválido e tenta resolver novamente;
- persiste `linkedCrmEntityId`, `linkedCrmEntityType` e `linkedCrmMatchSource` corretamente.

### Frontend

- renderiza `Procurando cadastro…` durante carregamento;
- renderiza card quando há match;
- renderiza estado vazio quando não há match;
- renderiza erro leve sem quebrar o resto do painel;
- botão `Abrir lead` navega para a rota correta de detalhe.

## Critérios de sucesso

- Ao abrir uma conversa no WhatsApp Inbox, o painel comercial informa corretamente se o contato já existe em `/leads`.
- Quando houver cadastro encontrado com confiança, o usuário consegue abrir o detalhe em um clique.
- O vínculo CRM fica salvo na conversa para acessos futuros.
- O fluxo de pré-orçamento atual continua funcionando sem regressões.

## Abordagem recomendada para implementação

Implementar em duas etapas pequenas:

1. persistência + lookup backend + payload simples;
2. renderização do bloco no frontend + navegação + testes.

Essa divisão reduz risco, preserva o comportamento atual da inbox e mantém a mudança cirúrgica.
